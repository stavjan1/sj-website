// Cloudflare Pages Function — first-party traffic counters + Clarity insights.
//
// Two separate things live here because the admin screen shows them side by
// side, and neither is worth its own endpoint:
//
//   1. TRAFFIC — our own pageview counters, per site, per day. First-party, no
//      cookies, no third party, nothing that can be blocked by an ad blocker.
//      Aggregate only: a day holds a total, a per-path map, a coarse referrer
//      map and a capped list of hashed visitor ids for a unique count. No IPs,
//      no user agents, no paths with query strings — a counter, not a log.
//
//   2. CLARITY — Microsoft Clarity's Data Export API, proxied server-side so
//      the token never reaches a browser. Clarity only serves the last 3 days
//      and caps us at 10 calls per project per day, so every fetch is cached
//      and snapshotted into KV: the snapshots are what give Stav a trend line
//      longer than Clarity itself will hand out.
//
//   POST /api/analytics  { s:'site'|'zerem', p:'/path', r:'referrer-host' }
//   GET  /api/analytics?admin=1&days=30            → traffic for both sites
//   GET  /api/analytics?admin=1&clarity=1          → Clarity insights + history
//
// Owner/bot exclusion: the browser beacon refuses to fire for Stav's own
// devices and for automation (see trackPageview in app.js / site js), and the
// server drops known bot user agents into a separate counter rather than the
// real one — an excluded hit is still counted somewhere, never silently lost.

import { ADMIN_EMAIL, verifyGoogleEmail, bearerToken, rateLimit, dayKey, jsonResponse } from './_tiers.js';

const SITES = ['site', 'zerem'];
const UNIQ_CAP = 4000;          // hashed ids kept per day — a counter, not an audience
const PATH_CAP = 200;           // distinct paths tracked per day
// Every counted hit costs one KV write, and this namespace also holds the
// users' cloud backups and the daily AI quotas. A traffic spike must never be
// able to starve those, so counting stops at a ceiling and says so rather than
// eating the write budget. Well above any realistic day for this site.
const DAILY_HIT_CAP = 3000;
const HISTORY_DAYS = 180;
const CLARITY_TTL_MS = 6 * 60 * 60 * 1000;  // 4 calls/day max — Clarity allows 10
const CLARITY_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|phantom|puppeteer|playwright|selenium|lighthouse|curl|wget|python-requests|axios|monitoring|uptime|pingdom|gtmetrix|ahrefs|semrush|mj12|dotbot|petal|bytespider|gptbot|claudebot|ccbot|perplexity|applebot/i;

function dayHitsKey(site, day) { return `hits:${site}:${day}`; }

function safeParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

// Stable per-day visitor id with no stored identifier: hash(ip + ua + day) and
// keep only the first 8 hex chars. Rotates daily by construction, so it counts
// today's uniques and cannot follow anyone to tomorrow.
async function visitorHash(request, day) {
  const raw = [
    request.headers.get('cf-connecting-ip') || '',
    request.headers.get('user-agent') || '',
    day,
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest).slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Paths are normalised hard: no query strings (they carry ids), lowercase, and
// a length cap. An unrecognised shape collapses to "/other".
function cleanPath(raw) {
  let p = String(raw || '/').split('?')[0].split('#')[0].toLowerCase().trim();
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 60) p = p.slice(0, 60);
  return /^[a-z0-9/_\-.]*$/.test(p) ? (p || '/') : '/other';
}

// Referrers are reduced to a host — enough to see where traffic comes from,
// not enough to reconstruct anyone's browsing.
function cleanRef(raw) {
  const r = String(raw || '').trim().toLowerCase();
  if (!r) return 'direct';
  const host = r.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!host || host.includes('sj-eng.co.il')) return 'direct';
  return /^[a-z0-9.\-]{1,50}$/.test(host) ? host : 'other';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  // Analytics must never be the reason a page breaks: every failure path here
  // answers 200 with a skip reason.
  if (!env.SJ_DATA) return jsonResponse({ ok: false, skipped: 'no-kv' }, 200);
  if (!(await rateLimit(env, request, 'hit', 60))) return jsonResponse({ ok: false, skipped: 'rate' }, 200);

  const body = await request.json().catch(() => null);
  if (!body) return jsonResponse({ ok: false, skipped: 'bad-json' }, 200);

  const site = SITES.includes(body.s) ? body.s : null;
  if (!site) return jsonResponse({ ok: false, skipped: 'bad-site' }, 200);

  const day = dayKey();
  const ua = request.headers.get('user-agent') || '';

  // Bots are counted separately rather than dropped — a number that is missing
  // and a number that is zero look identical, and only one of them is honest.
  if (BOT_RE.test(ua)) {
    const k = `hits:${site}:bots:${day}`;
    const n = parseInt((await env.SJ_DATA.get(k)) || '0', 10);
    context.waitUntil(env.SJ_DATA.put(k, String(n + 1), { expirationTtl: 60 * 60 * 24 * 400 }));
    return jsonResponse({ ok: true, counted: 'bot' });
  }

  const key = dayHitsKey(site, day);
  const rec = safeParse(await env.SJ_DATA.get(key), null) || { total: 0, pages: {}, refs: {}, uniq: [] };

  // Ceiling reached: stop writing for the rest of the day. The record already
  // says `capped`, so the dashboard reports "3,000+" instead of quietly
  // under-counting — and the backups keep their write budget.
  if (rec.total >= DAILY_HIT_CAP) return jsonResponse({ ok: true, counted: 'capped' });

  rec.total += 1;
  if (rec.total >= DAILY_HIT_CAP) rec.capped = true;

  const path = cleanPath(body.p);
  if (rec.pages[path] != null || Object.keys(rec.pages).length < PATH_CAP) {
    rec.pages[path] = (rec.pages[path] || 0) + 1;
  }

  const ref = cleanRef(body.r);
  if (rec.refs[ref] != null || Object.keys(rec.refs).length < 60) {
    rec.refs[ref] = (rec.refs[ref] || 0) + 1;
  }

  const vh = await visitorHash(request, day);
  if (rec.uniq.length < UNIQ_CAP && !rec.uniq.includes(vh)) rec.uniq.push(vh);

  // KV has no transactions. At this traffic a lost concurrent increment is a
  // rounding error, and the alternative (a Durable Object) costs money for a
  // number nobody makes decisions on at single-hit precision.
  await env.SJ_DATA.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 400 });
  return jsonResponse({ ok: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const email = await verifyGoogleEmail(bearerToken(request));
  if (!email || email.toLowerCase() !== ADMIN_EMAIL) {
    return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
  }
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);

  if (url.searchParams.get('clarity')) return clarityInsights(context);

  const days = Math.min(180, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)));
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(dayKey(new Date(Date.now() - i * 86400000)));
  }

  const out = {};
  for (const site of SITES) {
    const series = [];
    const pages = {};
    const refs = {};
    let total = 0, uniques = 0, bots = 0, cappedDays = 0;
    for (const d of dates) {
      const rec = safeParse(await env.SJ_DATA.get(dayHitsKey(site, d)), null);
      const botN = parseInt((await env.SJ_DATA.get(`hits:${site}:bots:${d}`)) || '0', 10);
      if (rec && rec.capped) cappedDays++;
      const t = rec ? rec.total : 0;
      const u = rec ? rec.uniq.length : 0;
      series.push({ date: d, views: t, visitors: u, bots: botN });
      total += t; uniques += u; bots += botN;
      if (rec) {
        Object.entries(rec.pages || {}).forEach(([p, n]) => { pages[p] = (pages[p] || 0) + n; });
        Object.entries(rec.refs || {}).forEach(([r, n]) => { refs[r] = (refs[r] || 0) + n; });
      }
    }
    const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => ({ k, v }));
    out[site] = { series, total, uniques, bots, cappedDays, topPages: top(pages), topRefs: top(refs) };
  }

  return jsonResponse({ ok: true, days, sites: out, insights: await weeklyInsights(env) });
}

// The weekly read, computed on view instead of by a scheduled job. A cron that
// writes conclusions into storage is a conclusion that is stale the moment
// anything changes; this is never stale, needs no token, and cannot silently
// stop running. Everything here is arithmetic — no AI, nothing to hallucinate.
async function weeklyInsights(env) {
  const dayAt = (i) => dayKey(new Date(Date.now() - i * 86400000));
  const readWeek = async (site, offset) => {
    let views = 0, visitors = 0;
    const pages = {}, refs = {};
    for (let i = offset; i < offset + 7; i++) {
      const rec = safeParse(await env.SJ_DATA.get(dayHitsKey(site, dayAt(i))), null);
      if (!rec) continue;
      views += rec.total || 0;
      visitors += (rec.uniq || []).length;
      Object.entries(rec.pages || {}).forEach(([p, n]) => { pages[p] = (pages[p] || 0) + n; });
      Object.entries(rec.refs || {}).forEach(([r, n]) => { refs[r] = (refs[r] || 0) + n; });
    }
    return { views, visitors, pages, refs };
  };

  const notes = [];
  for (const site of SITES) {
    const label = site === 'site' ? 'האתר' : 'זרם';
    const cur = await readWeek(site, 0);
    const prev = await readWeek(site, 7);

    if (!cur.views && !prev.views) { notes.push(`${label}: אין עדיין נתוני תנועה — המונה נאסף מהיום שהועלה.`); continue; }

    if (prev.views > 0) {
      const pct = Math.round(((cur.views - prev.views) / prev.views) * 100);
      const dir = pct > 0 ? 'עלייה' : pct < 0 ? 'ירידה' : 'ללא שינוי';
      notes.push(`${label}: ${cur.views.toLocaleString('he-IL')} צפיות השבוע מול ${prev.views.toLocaleString('he-IL')} בשבוע שעבר — ${dir}${pct ? ' של ' + Math.abs(pct) + '%' : ''}.`);
    } else {
      notes.push(`${label}: ${cur.views.toLocaleString('he-IL')} צפיות השבוע (שבוע ראשון עם נתונים).`);
    }

    // Biggest page mover — the one page whose traffic actually changed.
    let bestPage = null, bestDelta = 0;
    for (const p of new Set([...Object.keys(cur.pages), ...Object.keys(prev.pages)])) {
      const d = (cur.pages[p] || 0) - (prev.pages[p] || 0);
      if (Math.abs(d) > Math.abs(bestDelta)) { bestDelta = d; bestPage = p; }
    }
    if (bestPage && Math.abs(bestDelta) >= 3) {
      notes.push(`${label}: ${bestDelta > 0 ? 'הדף שעלה הכי הרבה' : 'הדף שירד הכי הרבה'} — ${bestPage} (${bestDelta > 0 ? '+' : ''}${bestDelta}).`);
    }

    // A referrer that appeared out of nowhere is usually someone sharing a link.
    const fresh = Object.keys(cur.refs).filter(r => r !== 'direct' && !prev.refs[r] && cur.refs[r] >= 2);
    if (fresh.length) notes.push(`${label}: מקור תנועה חדש השבוע — ${fresh.slice(0, 3).join(', ')}.`);

    // Silence is worth naming: a live site with a dead day usually means the
    // beacon broke, not that nobody came.
    const dead = [];
    for (let i = 0; i < 7; i++) {
      const rec = safeParse(await env.SJ_DATA.get(dayHitsKey(site, dayAt(i))), null);
      if (!rec || !rec.total) dead.push(dayAt(i));
    }
    if (cur.views > 0 && dead.length >= 3) notes.push(`${label}: ${dead.length} ימים בלי אף צפייה השבוע — שווה לוודא שהמדידה עובדת.`);
  }

  // Clarity friction: is the site getting more or less annoying to use?
  const hist = safeParse(await env.SJ_DATA.get('clarity:history'), []) || [];
  if (hist.length >= 2) {
    const sum = (h) => Object.values(h.friction || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const recent = hist.slice(-3).reduce((a, h) => a + sum(h), 0);
    const older = hist.slice(-7, -3).reduce((a, h) => a + sum(h), 0);
    if (older > 0) {
      const pct = Math.round(((recent - older) / older) * 100);
      if (Math.abs(pct) >= 15) {
        notes.push(pct > 0
          ? `מפות חום: סימני תסכול (קליקים בזעם/מתים) עלו בכ-${pct}% — שווה להסתכל בהקלטות.`
          : `מפות חום: סימני תסכול ירדו בכ-${Math.abs(pct)}%.`);
      }
    }
  }

  return notes;
}

// --- Clarity ---------------------------------------------------------------
// Reduces Clarity's dimension-sliced payload to the handful of numbers that
// actually change what Stav does: how many real sessions, and where people are
// getting stuck (rage clicks, dead clicks, script errors, excessive scroll).
function reduceClarity(payload) {
  const out = { sessions: 0, bots: 0, pages: [], friction: {} };
  const rows = Array.isArray(payload) ? payload : [];
  for (const metric of rows) {
    const name = String(metric.metricName || '');
    const info = Array.isArray(metric.information) ? metric.information : [];
    if (name === 'Traffic') {
      for (const r of info) {
        out.sessions += parseInt(r.totalSessionCount || '0', 10) || 0;
        out.bots += parseInt(r.totalBotSessionCount || '0', 10) || 0;
      }
    } else if (name === 'PopularPages' || name === 'Popular Pages') {
      out.pages = info.slice(0, 12).map(r => ({
        url: r.Url || r.URL || r.url || r.PageTitle || '—',
        views: parseInt(r.visitsCount || r.totalSessionCount || '0', 10) || 0,
      }));
    } else {
      // Friction metrics arrive one metric per entry with a count field whose
      // exact name varies by metric — sum whatever numeric field is present.
      let sum = 0;
      for (const r of info) {
        for (const [k, v] of Object.entries(r)) {
          if (/count|sessions|subtotal/i.test(k)) { const n = parseInt(v, 10); if (Number.isFinite(n)) sum += n; }
        }
      }
      if (sum > 0) out.friction[name] = sum;
    }
  }
  return out;
}

async function clarityInsights(context) {
  const { env } = context;
  const token = env.CLARITY_API_TOKEN;
  const cached = safeParse(await env.SJ_DATA.get('clarity:cache'), null);
  const history = safeParse(await env.SJ_DATA.get('clarity:history'), []) || [];

  if (!token) {
    return jsonResponse({
      ok: true, configured: false, history,
      note: 'לא הוגדר CLARITY_API_TOKEN במשתני הסביבה של Cloudflare.',
    });
  }
  if (cached && Date.now() - cached.ts < CLARITY_TTL_MS) {
    return jsonResponse({ ok: true, configured: true, cached: true, fetchedAt: cached.ts, data: cached.data, history });
  }

  let res;
  try {
    res = await fetch(`${CLARITY_URL}?numOfDays=3`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return jsonResponse({ ok: false, configured: true, error: 'לא הצלחנו להגיע ל-Clarity.', history, data: cached ? cached.data : null });
  }
  if (!res.ok) {
    // 429 is the daily cap — serve the last good snapshot rather than nothing.
    return jsonResponse({
      ok: false, configured: true, status: res.status, history,
      error: res.status === 429 ? 'מכסת Clarity ליום נוצלה — מוצג המידע האחרון שנשמר.' : `Clarity החזיר שגיאה ${res.status}.`,
      data: cached ? cached.data : null,
    });
  }

  const data = reduceClarity(await res.json().catch(() => []));
  const ts = Date.now();
  await env.SJ_DATA.put('clarity:cache', JSON.stringify({ ts, data }));

  // One snapshot per day builds the trend Clarity's 3-day window cannot.
  const today = dayKey();
  const trimmed = history.filter(h => h.date !== today).slice(-HISTORY_DAYS);
  trimmed.push({ date: today, sessions: data.sessions, bots: data.bots, friction: data.friction });
  await env.SJ_DATA.put('clarity:history', JSON.stringify(trimmed));

  return jsonResponse({ ok: true, configured: true, cached: false, fetchedAt: ts, data, history: trimmed });
}
