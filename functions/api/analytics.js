// Cloudflare Pages Function — first-party traffic counters.
//
// TRAFFIC — our own pageview counters, per site, per day. First-party, no
//      cookies, no third party, nothing that can be blocked by an ad blocker.
//      Aggregate only: a day holds a total, a per-path map, a coarse referrer
//      map and a capped list of hashed visitor ids for a unique count. No IPs,
//      no user agents, no paths with query strings — a counter, not a log.
//
// Clarity is NOT handled here — functions/api/clarity.js already owns that
// pipeline (admin-stored token, 6h cache, Actions puller for history).
//
//   POST /api/analytics  { s:'site'|'zerem'|'app', p:'/path', r:'referrer-host' }
//   GET  /api/analytics?admin=1&days=30            → traffic for every property
//
// Owner/bot exclusion: the browser beacon refuses to fire for Stav's own
// devices and for automation (see trackPageview in app.js / site js), and the
// server drops known bot user agents into a separate counter rather than the
// real one — an excluded hit is still counted somewhere, never silently lost.

import { adminGate, rateLimit, dayKey, jsonResponse } from './_tiers.js';

// The AI pools the ledger in _ai.js writes under. Listed rather than scanned:
// Pages KV list() is paginated and slow, and this set changes about once a year.
const AI_POOLS = ['gemini:primary', 'gemini:backup', 'gemini:paid', 'grok', 'cloudflare', 'all'];

// Three properties, because they answer three different questions: the office
// site sells engineering, the זרם page sells the product, and the app itself is
// people using it. Days before the split carry app traffic inside 'zerem'.
const SITES = ['site', 'zerem', 'app'];
const UNIQ_CAP = 4000;          // hashed ids kept per day — a counter, not an audience
const PATH_CAP = 200;           // distinct paths tracked per day
// Every counted hit costs one KV write, and this namespace also holds the
// users' cloud backups and the daily AI quotas. A traffic spike must never be
// able to starve those, so counting stops at a ceiling and says so rather than
// eating the write budget. Well above any realistic day for this site.
const DAILY_HIT_CAP = 3000;

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

  // Admin: set the daily ceiling per AI pool, so "used" can become a percentage.
  // Same endpoint rather than a new one — it already carries the admin gate.
  if (new URL(request.url).searchParams.get('caps') === '1') {
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
    const caps = {};
    for (const [k, v] of Object.entries(body.caps || {})) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) caps[String(k).slice(0, 40)] = Math.min(10000000, n);
    }
    await env.SJ_DATA.put('config:aiCaps', JSON.stringify(caps));
    return jsonResponse({ ok: true, caps });
  }

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

  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);

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

  const wantSummary = url.searchParams.get('summary') === '1';
  const summary = {};
  if (wantSummary) {
    // One cold month across all three sites per request, not twelve each.
    const budget = coldMonthBudget(1);
    for (const site of SITES) summary[site] = await visitorSummary(env, site, budget);
  }

  return jsonResponse({
    ok: true, days, sites: out,
    summary: wantSummary ? summary : null,
    insights: await weeklyInsights(env),
    ai: await aiUsage(env, dates),
  });
}

// ---------------------------------------------------------------------------
// Visitor summary — "how many came in today / this week / this month / this
// year", plus a bar per month. The counter it answers is a turnstile count:
// each day's unique-visitor number, added up. Someone who returns tomorrow is
// counted twice, and that is deliberate rather than a weaker form of a unique
// count — visitorHash rotates daily by construction (no identifier is stored),
// so counting a person once across a month is not something this data CAN do.
// A shopping-mall entry counter answers exactly this question, and the labels
// in the panel say "כניסות" for that reason.
//
// All windows are built on the same UTC day keys the beacon writes under, so a
// period is always exactly the days that were counted — never a re-slice that
// could double-count or drop a day at the boundary.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;
const CHART_MONTHS = 12;
// Every day inside the current AND previous month, plus this week and last
// week, fits in one 70-day batch — so a summary costs one parallel read of
// bounded size, whatever today's date is.
const RECENT_DAYS = 70;

const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

// Pure, and exported so the date math can be tested away from KV. Israeli week
// starts on Sunday, which getUTCDay() already numbers 0.
export function periodWindows(todayIso) {
  const t = Date.parse(todayIso + 'T00:00:00Z');
  const today = new Date(t);
  const range = (from, to) => {
    const out = [];
    for (let x = from; x <= to; x += DAY_MS) out.push(isoDay(x));
    return out;
  };

  const weekStart = t - today.getUTCDay() * DAY_MS;
  const monthStart = Date.parse(todayIso.slice(0, 8) + '01T00:00:00Z');

  // Previous month, up to the same day of the month — clamped, so the 31st of
  // a 31-day month compares against all 30 days of a 30-day one instead of
  // silently spilling into this month.
  const prevMonthEnd = monthStart - DAY_MS;
  const prevMonthLen = new Date(prevMonthEnd).getUTCDate();
  const prevMonthStart = prevMonthEnd - (prevMonthLen - 1) * DAY_MS;
  const sameDayOfMonth = Math.min(today.getUTCDate(), prevMonthLen);

  const months = [];
  for (let i = CHART_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const year = todayIso.slice(0, 4);

  return {
    today: { days: [todayIso], prevDays: [isoDay(t - 7 * DAY_MS)] },
    week: { days: range(weekStart, t), prevDays: range(weekStart - 7 * DAY_MS, t - 7 * DAY_MS) },
    month: {
      days: range(monthStart, t),
      prevDays: range(prevMonthStart, prevMonthStart + (sameDayOfMonth - 1) * DAY_MS),
    },
    months,
    yearMonths: months.filter((m) => m.startsWith(year)),
  };
}

export function daysOfMonth(ym, maxDay) {
  const start = Date.parse(ym + '-01T00:00:00Z');
  const len = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const out = [];
  for (let i = 0; i < len; i++) {
    const d = isoDay(start + i * DAY_MS);
    if (maxDay && d > maxDay) break;
    out.push(d);
  }
  return out;
}

function dayTotals(raw) {
  const rec = safeParse(raw, null);
  return { views: rec ? (rec.total || 0) : 0, visitors: rec ? (rec.uniq || []).length : 0, capped: !!(rec && rec.capped) };
}

function addUp(dayKeys, map) {
  return dayKeys.reduce((acc, d) => {
    const v = map.get(d) || { views: 0, visitors: 0 };
    return { views: acc.views + v.views, visitors: acc.visitors + v.visitors };
  }, { views: 0, visitors: 0 });
}

// Percent change, or null when there is nothing to compare against. A previous
// period of zero has no percentage — "+∞%" is not information.
function delta(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function period(days, prevDays, map) {
  const cur = addUp(days, map);
  const prev = addUp(prevDays, map);
  return { visitors: cur.visitors, views: cur.views, prev, delta: delta(cur.visitors, prev.visitors) };
}

// A finished month never changes, so it is computed once from its days and
// then kept as a rollup. The current month is always recomputed — it is still
// moving, and a cached "today" is worse than no number at all.
async function monthTotals(env, site, ym, todayIso, recent, budget) {
  const currentYm = todayIso.slice(0, 7);
  const key = `roll:${site}:${ym}`;
  if (ym !== currentYm) {
    const cached = safeParse(await env.SJ_DATA.get(key), null);
    if (cached) return cached;
  }

  const days = daysOfMonth(ym, todayIso);
  const missing = days.filter((d) => !recent.has(d));
  if (missing.length) {
    // Building one cold month costs a read per day of it, and this screen wants
    // twelve months across three sites. Doing all of them in a single request
    // is what killed this endpoint: several hundred KV reads, the Function ran
    // past its limits, and Cloudflare answered with an HTML error page — which
    // arrived in the panel as
    //     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
    // and read, to the only person looking at it, as "the dashboard is broken".
    //
    // So: one cold month per request. The others report whatever is already
    // rolled up and are marked pending, and a few refreshes finish the set for
    // good — a finished month is written once and never recomputed.
    if (!budget.take()) return { views: 0, visitors: 0, pending: true };
    const raw = await Promise.all(missing.map((d) => env.SJ_DATA.get(dayHitsKey(site, d))));
    missing.forEach((d, i) => recent.set(d, dayTotals(raw[i])));
  }
  const total = addUp(days, recent);

  // Only a month that could still have daily records behind it is worth
  // freezing: the day keys expire after 400 days, and a rollup of zeros
  // written from expired data would outlive the truth it lost.
  if (ym !== currentYm && Date.now() - Date.parse(ym + '-01T00:00:00Z') < 380 * DAY_MS) {
    await env.SJ_DATA.put(key, JSON.stringify(total), { expirationTtl: 60 * 60 * 24 * 800 });
  }
  return total;
}

// How many cold months one request is allowed to build, across every site.
// Shared rather than per-site, because the limit that was being exceeded is a
// property of the request, not of a site.
function coldMonthBudget(n) {
  let left = n;
  return { take: () => (left > 0 ? (left--, true) : false) };
}

async function visitorSummary(env, site, budget) {
  const todayIso = dayKey();
  const w = periodWindows(todayIso);

  const recentKeys = [];
  for (let i = RECENT_DAYS - 1; i >= 0; i--) recentKeys.push(isoDay(Date.now() - i * DAY_MS));
  const raw = await Promise.all(recentKeys.map((d) => env.SJ_DATA.get(dayHitsKey(site, d))));
  const map = new Map();
  recentKeys.forEach((d, i) => map.set(d, dayTotals(raw[i])));

  // Sequentially on purpose, even though it is slower: monthTotals mutates the
  // shared day map and spends from a shared budget, and running twelve of those
  // concurrently would have them racing over both.
  const months = [];
  for (const ym of w.months) months.push({ ym, ...(await monthTotals(env, site, ym, todayIso, map, budget)) });
  const year = w.yearMonths.reduce((acc, ym) => {
    const m = months.find((x) => x.ym === ym) || { views: 0, visitors: 0 };
    return { views: acc.views + m.views, visitors: acc.visitors + m.visitors };
  }, { views: 0, visitors: 0 });

  return {
    today: period(w.today.days, w.today.prevDays, map),
    week: period(w.week.days, w.week.prevDays, map),
    month: period(w.month.days, w.month.prevDays, map),
    year,
    months,
    // A capped day under-reports, and the panel says so rather than showing a
    // number that quietly stopped counting at the ceiling.
    cappedDays: w.month.days.filter((d) => (map.get(d) || {}).capped).length,
  };
}

// The AI pools, per day: how much each one served and when one went quiet.
//
// The percentage needs a ceiling, and only the account holder knows what his
// plan allows — so caps are configured (config:aiCaps) rather than guessed. An
// unset cap reports null and the panel shows a count instead of a made-up
// percentage; a wrong number here would be worse than no number.
async function aiUsage(env, dates) {
  const caps = safeParse(await env.SJ_DATA.get('config:aiCaps'), {}) || {};
  const pools = {};
  const series = [];
  const events = [];

  // KV has no prefix scan on Pages KV without list(), which is paginated and
  // slow; the label set is small and known, so the keys are read directly.
  //
  // In one batch, not one at a time. Thirty days across seven pools was 210
  // reads issued strictly in sequence, and this runs on BOTH admin requests —
  // it was the largest single cost on a screen that had started returning
  // Cloudflare's HTML error page instead of JSON. Same reads, same results,
  // one round of waiting instead of two hundred.
  const cells = [];
  for (const d of dates) for (const label of AI_POOLS) cells.push({ d, label });
  const rawCells = await Promise.all(cells.map((c) => env.SJ_DATA.get(`aiuse:${c.d}:${c.label}`)));
  const cellAt = new Map();
  cells.forEach((c, i) => cellAt.set(c.d + '|' + c.label, safeParse(rawCells[i], null)));

  for (const d of dates) {
    const day = { date: d, pools: {} };
    for (const label of AI_POOLS) {
      const rec = cellAt.get(d + '|' + label);
      if (!rec) continue;
      const used = (rec.ok || 0) + (rec.quota || 0) + (rec.fail || 0);
      day.pools[label] = { ok: rec.ok || 0, quota: rec.quota || 0, fail: rec.fail || 0, used, models: rec.models || {} };
      const agg = pools[label] || (pools[label] = { ok: 0, quota: 0, fail: 0, used: 0, models: {}, daysExhausted: 0 });
      agg.ok += rec.ok || 0; agg.quota += rec.quota || 0; agg.fail += rec.fail || 0; agg.used += used;
      if (rec.quota) agg.daysExhausted++;
      Object.entries(rec.models || {}).forEach(([m, n]) => { agg.models[m] = (agg.models[m] || 0) + n; });
    }
    series.push(day);
  }

  // Events are only worth reading for the recent window — that is where a
  // "why did it get slow yesterday" question actually gets answered.
  const eventDays = dates.slice(-7);
  const rawEvents = await Promise.all(eventDays.map((d) => env.SJ_DATA.get(`aiuse:events:${d}`)));
  eventDays.forEach((d, i) => {
    const list = safeParse(rawEvents[i], []) || [];
    if (Array.isArray(list)) events.push(...list.map((e) => ({ ...e, date: d })));
  });

  const today = dates[dates.length - 1];
  const todayRow = series.find((s) => s.date === today) || { pools: {} };
  const todayPools = {};
  for (const label of AI_POOLS) {
    const cap = Number(caps[label]) > 0 ? Number(caps[label]) : null;
    const used = (todayRow.pools[label] || {}).used || 0;
    todayPools[label] = {
      used,
      cap,
      pct: cap ? Math.min(100, Math.round((used / cap) * 100)) : null,
      exhausted: !!((todayRow.pools[label] || {}).quota),
    };
  }

  return {
    pools: AI_POOLS, caps, totals: pools, series, today: todayPools,
    pressure: await aiPressure(env, series, caps),
    events: events.slice(-40).reverse(),
  };
}

// How close to the ceiling this thing runs, which is the only AI number worth
// looking at day to day. An average would hide exactly the days that matter, so
// this counts the days that crossed each line instead, and keeps the all-time
// record in KV so it survives past the window being viewed.
//
// The record is written only when it is actually beaten, which is rare — the
// write budget is a real constraint here.
const AI_PRESSURE_LINES = [50, 70, 90];

async function aiPressure(env, series, caps) {
  const dayPct = [];
  for (const row of series) {
    let used = 0, cap = 0;
    for (const [label, rec] of Object.entries(row.pools || {})) {
      const c = Number(caps[label]) > 0 ? Number(caps[label]) : 0;
      if (!c) continue;                    // no ceiling declared → no percentage
      used += rec.used || 0;
      cap += c;
    }
    if (cap > 0) dayPct.push({ date: row.date, pct: Math.round((used / cap) * 100), used, cap });
  }

  const over = {};
  for (const line of AI_PRESSURE_LINES) over[line] = dayPct.filter((d) => d.pct >= line).length;
  const exhaustedDays = series.filter((row) =>
    Object.values(row.pools || {}).some((r) => (r.quota || 0) > 0)).length;

  const windowPeak = dayPct.reduce((best, d) => (!best || d.pct > best.pct ? d : best), null);

  let record = safeParse(await env.SJ_DATA.get('stats:aiPeak'), null);
  if (windowPeak && (!record || windowPeak.pct > record.pct)) {
    record = { pct: windowPeak.pct, date: windowPeak.date, used: windowPeak.used, cap: windowPeak.cap };
    try { await env.SJ_DATA.put('stats:aiPeak', JSON.stringify(record)); } catch { /* budget */ }
  }

  const todayPct = dayPct.length ? dayPct[dayPct.length - 1] : null;
  return { days: dayPct, daysMeasured: dayPct.length, today: todayPct, windowPeak, record, over, exhaustedDays, lines: AI_PRESSURE_LINES };
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

    if (!cur.views && !prev.views) { notes.push(`${label}: אין עדיין נתוני תנועה, המונה נאסף מהיום שהועלה.`); continue; }

    if (prev.views > 0) {
      const pct = Math.round(((cur.views - prev.views) / prev.views) * 100);
      const dir = pct > 0 ? 'עלייה' : pct < 0 ? 'ירידה' : 'ללא שינוי';
      notes.push(`${label}: ${cur.views.toLocaleString('he-IL')} צפיות השבוע מול ${prev.views.toLocaleString('he-IL')} בשבוע שעבר, ${dir}${pct ? ' של ' + Math.abs(pct) + '%' : ''}.`);
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
      notes.push(`${label}: ${bestDelta > 0 ? 'הדף שעלה הכי הרבה' : 'הדף שירד הכי הרבה'}, ${bestPage} (${bestDelta > 0 ? '+' : ''}${bestDelta}).`);
    }

    // A referrer that appeared out of nowhere is usually someone sharing a link.
    const fresh = Object.keys(cur.refs).filter(r => r !== 'direct' && !prev.refs[r] && cur.refs[r] >= 2);
    if (fresh.length) notes.push(`${label}: מקור תנועה חדש השבוע, ${fresh.slice(0, 3).join(', ')}.`);

    // Silence is worth naming: a live site with a dead day usually means the
    // beacon broke, not that nobody came.
    const dead = [];
    for (let i = 0; i < 7; i++) {
      const rec = safeParse(await env.SJ_DATA.get(dayHitsKey(site, dayAt(i))), null);
      if (!rec || !rec.total) dead.push(dayAt(i));
    }
    if (cur.views > 0 && dead.length >= 3) notes.push(`${label}: ${dead.length} ימים בלי אף צפייה השבוע, שווה לוודא שהמדידה עובדת.`);
  }

  return notes;
}
