// Cloudflare Pages Function — anonymous pricing benchmark ("עבודה כזו תומחרה ב-X").
//
// Captures LABOR-ONLY prices at PDF-export time and aggregates them per job
// type, so users can see what similar work is typically priced at. Privacy by
// design: NO client names/addresses/phones ever touch this — only
// { profession, jobType, labor, contributor-label?, month }. Aggregate only,
// shown with a minimum sample size, median + range (not a lying single mean).
//
// Display is OFF until the admin flips config:statsLive — the pipe collects
// silently from day one so there's real data by the time it goes live.
//
//   POST /api/stats            { profession, jobType, labor, quoteId, named?, items? } → record (rate-limited)
//   GET  /api/stats?market=1&prof= → per-ITEM market prices (median per line item)
//   GET  /api/stats?job=&prof= → public benchmark for one bucket (only when live)
//   GET  /api/stats?admin=1    → admin: full aggregate dashboard + live flag
//   POST /api/stats            { setLive: true|false }  (admin) → toggle display

import { adminGate, rateLimit, monthKey, jsonResponse } from './_tiers.js';

const MIN_SAMPLES = 5;        // never show an average built on fewer than this
const SAMPLES_CAP = 1000;     // rolling window kept per bucket
const LABOR_MIN = 50;         // sanity bounds — ignore obvious junk/typos
const LABOR_MAX = 100000;
// Per-item collection: the same privacy rule as labor — a line's NAME and its
// price, nothing else. Buckets are capped hard because the key is built from
// user text: an unbounded name space would mean unbounded KV keys.
const ITEM_SAMPLES_CAP = 400;   // rolling samples kept per item name
const ITEM_NAME_MAX = 60;
const ITEM_PRICE_MIN = 1;
const ITEM_PRICE_MAX = 200000;
const ITEMS_PER_QUOTE = 40;     // ignore the tail of an absurdly long quote
const ITEM_BUCKETS_CAP = 4000;  // safety ceiling on distinct item names per profession

const JOB_TYPES = ['panel', 'points', 'charger', 'solar', 'inspection', 'fault', 'infra', 'other'];
// Closed list, mirroring PROFESSIONS in sale/app.js. This write path is PUBLIC,
// and the bucket key is built from it — accepting free text meant an attacker
// could mint an unbounded number of KV buckets, and the admin dashboard does one
// KV read per bucket, so a few thousand junk professions would blow the Worker
// subrequest limit and break the dashboard for good. Anything unknown → general.
const PROFESSIONS = [
  'electrician', 'plumber', 'hvac', 'contractor', 'renovator', 'general',
  'solar_installer', 'charger_installer',
];

function normProfession(v) {
  const p = String(v || 'general').toLowerCase().slice(0, 30);
  return PROFESSIONS.includes(p) ? p : 'general';
}

// One item name → one bucket. Normalised so "נקודת מאור" and "נקודת  מאור "
// land in the same place, and so the key can never carry KV-hostile characters.
function normItemName(v) {
  return String(v || '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/["'`|:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ITEM_NAME_MAX);
}
function itemKey(prof, name) {
  return `stats:items:${normProfession(prof)}:${normItemName(name)}`;
}

function bucketKey(prof, job) {
  const p = JOB_TYPES.includes(job) ? job : 'other';
  return `stats:samples:${normProfession(prof)}:${p}`;
}

// Who sent this, as far as an endpoint with no accounts can tell: the same
// address the rate limiter counts, through SHA-256 and truncated. Enough to
// keep two senders apart, not enough to be an address.
async function senderScope(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sj-stats:' + ip));
    return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'anon';   // no subtle crypto → one shared scope, which is where we were
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SJ_DATA) return jsonResponse({ ok: false, skipped: 'no-kv' }, 200);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }

  // Rate-limit BEFORE any branch that makes an outbound Google call, so an
  // unauthenticated flood of {"setLive":true} can't be amplified into one
  // upstream token-verification request per hit.
  if (!(await rateLimit(env, request, 'stats', 20))) {
    return jsonResponse({ ok: false, skipped: 'rate' }, 200);
  }

  // Admin: toggle the public display flag.
  if (typeof body.setLive === 'boolean') {
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response;
    await env.SJ_DATA.put('config:statsLive', body.setLive ? '1' : '0');
    return jsonResponse({ ok: true, live: body.setLive });
  }

  const labor = Number(body.labor);
  if (!Number.isFinite(labor) || labor < LABOR_MIN || labor > LABOR_MAX) {
    return jsonResponse({ ok: false, skipped: 'out-of-bounds' }, 200); // silent — never breaks the export
  }
  const prof = normProfession(body.profession);
  const job = JOB_TYPES.includes(body.jobType) ? body.jobType : 'other';

  // Dedup: count a quote once (re-exports/edits don't re-inflate the stats).
  //
  // Scoped to the sender, not global. The quote id is chosen by the caller on an
  // endpoint that requires no account, so a global key let anyone claim any id
  // in advance and have the real submission silently dropped as a duplicate —
  // a way to suppress somebody else's sample without touching their data. The
  // scope is the same identity the rate limiter already uses, hashed, because
  // this pipeline is anonymous on purpose and storing raw addresses beside
  // pricing samples would quietly stop it being so.
  const quoteId = String(body.quoteId || '').slice(0, 60);
  if (quoteId) {
    const who = await senderScope(request);
    const seenKey = `stats:seen:${who}:${quoteId}`;
    if (await env.SJ_DATA.get(seenKey)) return jsonResponse({ ok: true, deduped: true });
    context.waitUntil(env.SJ_DATA.put(seenKey, '1', { expirationTtl: 60 * 60 * 24 * 400 }));
  }

  // Contributor label: named users get a coarse, non-identifying credit
  // (business name only — never the client). Default anonymous.
  let by = null;
  if (body.named && typeof body.named === 'string') by = body.named.trim().slice(0, 40) || null;

  const key = bucketKey(prof, job);
  let arr = [];
  try { arr = JSON.parse((await env.SJ_DATA.get(key)) || '[]'); } catch { arr = []; }
  arr.push({ p: Math.round(labor), t: Date.now(), by });
  if (arr.length > SAMPLES_CAP) arr = arr.slice(arr.length - SAMPLES_CAP);
  await env.SJ_DATA.put(key, JSON.stringify(arr));

  // Line items: what the quote actually charged per component. Written in the
  // background so a slow write never delays the export, and deduped by the same
  // quoteId gate above (a re-export contributes nothing twice).
  if (Array.isArray(body.items) && body.items.length) {
    context.waitUntil((async () => {
      const seen = new Set();
      for (const raw of body.items.slice(0, ITEMS_PER_QUOTE)) {
        const name = normItemName(raw && raw.name);
        const price = Math.round(Number(raw && raw.price));
        if (name.length < 2 || seen.has(name)) continue;
        if (!Number.isFinite(price) || price < ITEM_PRICE_MIN || price > ITEM_PRICE_MAX) continue;
        seen.add(name);
        const k = itemKey(prof, name);
        let list = [];
        try { list = JSON.parse((await env.SJ_DATA.get(k)) || '[]'); } catch { list = []; }
        if (!list.length) {
          // A brand-new bucket: only allow it while the profession is under its ceiling.
          const existing = await env.SJ_DATA.list({ prefix: `stats:items:${prof}:`, limit: ITEM_BUCKETS_CAP });
          if (existing.keys.length >= ITEM_BUCKETS_CAP) continue;
        }
        list.push({ p: price, t: Date.now(), u: raw && raw.unit ? String(raw.unit).slice(0, 12) : null });
        if (list.length > ITEM_SAMPLES_CAP) list = list.slice(list.length - ITEM_SAMPLES_CAP);
        await env.SJ_DATA.put(k, JSON.stringify(list));
      }
    })());
  }

  // Global usage counters (pride/insight — aggregate, no PII).
  context.waitUntil((async () => {
    for (const k of ['stats:count:total', `stats:count:${monthKey()}`]) {
      const n = parseInt((await env.SJ_DATA.get(k)) || '0', 10);
      await env.SJ_DATA.put(k, String(n + 1));
    }
  })());

  return jsonResponse({ ok: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.SJ_DATA) return jsonResponse({ live: false, buckets: [] });
  const url = new URL(request.url);

  // Admin dashboard — aggregate only, zero client PII.
  if (url.searchParams.get('admin')) {
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response;
    const list = await env.SJ_DATA.list({ prefix: 'stats:samples:' });
    const buckets = [];
    for (const k of list.keys) {
      let arr = [];
      try { arr = JSON.parse((await env.SJ_DATA.get(k.name)) || '[]'); } catch { arr = []; }
      const parts = k.name.replace('stats:samples:', '').split(':');
      buckets.push({ profession: parts[0], jobType: parts[1], ...summarize(arr), named: arr.filter(s => s.by).length });
    }
    buckets.sort((a, b) => b.count - a.count);
    return jsonResponse({
      live: (await env.SJ_DATA.get('config:statsLive')) === '1',
      total: parseInt((await env.SJ_DATA.get('stats:count:total')) || '0', 10),
      thisMonth: parseInt((await env.SJ_DATA.get(`stats:count:${monthKey()}`)) || '0', 10),
      minSamples: MIN_SAMPLES,
      buckets,
    });
  }

  // The market list: every item name this profession has priced, with its
  // median and sample count. Admin sees it always; everyone else only once the
  // display flag is live (same rule as the labor benchmark).
  if (url.searchParams.get('market')) {
    const liveFlag = (await env.SJ_DATA.get('config:statsLive')) === '1';
    let isAdmin = false;
    if (!liveFlag) {
      const gate = await adminGate(request);
      isAdmin = gate.ok;
      if (!isAdmin) return jsonResponse({ live: false, items: [] });
    }
    const prof = normProfession(url.searchParams.get('prof'));
    const list = await env.SJ_DATA.list({ prefix: `stats:items:${prof}:`, limit: 1000 });
    const names = list.keys.map(k => k.name);
    const items = [];
    // Read in parallel chunks: one KV get per name would serialise 1000 round trips.
    for (let i = 0; i < names.length; i += 25) {
      const chunk = names.slice(i, i + 25);
      const got = await Promise.all(chunk.map(n => env.SJ_DATA.get(n).catch(() => null)));
      chunk.forEach((n, j) => {
        let arr = [];
        try { arr = JSON.parse(got[j] || '[]'); } catch { arr = []; }
        if (!arr.length) return;
        const sum = summarize(arr);
        const units = arr.map(x => x.u).filter(Boolean);
        items.push({
          name: n.slice(`stats:items:${prof}:`.length),
          count: sum.count, median: sum.median, low: sum.low, high: sum.high,
          unit: units.length ? units[units.length - 1] : null,
          lastAt: arr[arr.length - 1].t || null,
        });
      });
    }
    items.sort((a, b) => b.count - a.count);
    return jsonResponse({ live: true, minSamples: MIN_SAMPLES, prof, items });
  }

  // Public benchmark for one bucket — only when the admin has gone live.
  const live = (await env.SJ_DATA.get('config:statsLive')) === '1';
  if (!live) return jsonResponse({ live: false });
  const prof = url.searchParams.get('prof') || 'general';
  const job = url.searchParams.get('job') || 'other';
  let arr = [];
  try { arr = JSON.parse((await env.SJ_DATA.get(bucketKey(prof, job))) || '[]'); } catch { arr = []; }
  const s = summarize(arr);
  if (s.count < MIN_SAMPLES) return jsonResponse({ live: true, enough: false });
  return jsonResponse({ live: true, enough: true, count: s.count, median: s.median, low: s.low, high: s.high });
}

// Median + interquartile range (robust to the odd typo/outlier).
function summarize(arr) {
  const vals = (arr || []).map(s => Number(s.p)).filter(Number.isFinite).sort((a, b) => a - b);
  const n = vals.length;
  if (n === 0) return { count: 0, median: 0, low: 0, high: 0 };
  const q = (frac) => vals[Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))))];
  return { count: n, median: q(0.5), low: q(0.25), high: q(0.75) };
}
