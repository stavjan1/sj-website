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
//   POST /api/stats            { profession, jobType, labor, quoteId, named? } → record (rate-limited)
//   GET  /api/stats?job=&prof= → public benchmark for one bucket (only when live)
//   GET  /api/stats?admin=1    → admin: full aggregate dashboard + live flag
//   POST /api/stats            { setLive: true|false }  (admin) → toggle display

import { ADMIN_EMAIL, verifyGoogleEmail, bearerToken, rateLimit, monthKey, jsonResponse } from './_tiers.js';

const MIN_SAMPLES = 5;        // never show an average built on fewer than this
const SAMPLES_CAP = 1000;     // rolling window kept per bucket
const LABOR_MIN = 50;         // sanity bounds — ignore obvious junk/typos
const LABOR_MAX = 100000;
const JOB_TYPES = ['panel', 'points', 'charger', 'solar', 'inspection', 'fault', 'infra', 'other'];

function bucketKey(prof, job) {
  const p = JOB_TYPES.includes(job) ? job : 'other';
  return `stats:samples:${String(prof || 'general').toLowerCase()}:${p}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SJ_DATA) return jsonResponse({ ok: false, skipped: 'no-kv' }, 200);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }

  // Admin: toggle the public display flag.
  if (typeof body.setLive === 'boolean') {
    const email = await verifyGoogleEmail(bearerToken(request));
    if (!email || email.toLowerCase() !== ADMIN_EMAIL) return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
    await env.SJ_DATA.put('config:statsLive', body.setLive ? '1' : '0');
    return jsonResponse({ ok: true, live: body.setLive });
  }

  // Record a sample — rate-limited (unauthenticated write path).
  if (!(await rateLimit(env, request, 'stats', 20))) {
    return jsonResponse({ ok: false, skipped: 'rate' }, 200);
  }

  const labor = Number(body.labor);
  if (!Number.isFinite(labor) || labor < LABOR_MIN || labor > LABOR_MAX) {
    return jsonResponse({ ok: false, skipped: 'out-of-bounds' }, 200); // silent — never breaks the export
  }
  const prof = String(body.profession || 'general').toLowerCase().slice(0, 30);
  const job = JOB_TYPES.includes(body.jobType) ? body.jobType : 'other';

  // Dedup: count a quote once (re-exports/edits don't re-inflate the stats).
  const quoteId = String(body.quoteId || '').slice(0, 60);
  if (quoteId) {
    const seenKey = `stats:seen:${quoteId}`;
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
    const email = await verifyGoogleEmail(bearerToken(request));
    if (!email || email.toLowerCase() !== ADMIN_EMAIL) return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
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
