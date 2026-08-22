// Cloudflare Pages Function — /api/feedback
//
// "Was that price right?" asked of the one person who knows: the electrician
// holding the quote, at the moment he reads it.
//
// The design point that matters is that "בול" is NOT a no-op. A verdict only
// means something against a denominator — three complaints out of five quotes
// is an emergency, three out of three hundred is noise — so agreement is
// recorded exactly as carefully as disagreement. The alert fires only for
// "ממש לא"; everything else accumulates quietly until a RATE says something.
//
// That split is the whole idea: one bad answer is a bug, a drift of "slightly
// high" across a job type is a mispriced anchor. They need different reactions,
// so they get different paths.
//
//   POST /api/feedback   { verdict, price, jobType?, quoteId?, note? }
//   GET  /api/feedback   (admin) → recent verdicts + rates per job type

import { adminGate, rateLimit, verifyGoogleEmail, bearerToken } from './_tiers.js';

const VERDICTS = {
  way_off:  { he: 'ממש לא',              alert: true,  weight: -2 },
  bit_high: { he: 'הגיוני אבל קצת גבוה', alert: false, weight: -1 },
  spot_on:  { he: 'נראה לי בול',          alert: false, weight:  0 },
  bit_low:  { he: 'הגיוני אבל קצת נמוך',  alert: false, weight:  1 },
};

const KEEP_DAYS = 400;
const LIST_LIMIT = 200;

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (method === 'POST') return submit(context);
  if (method === 'GET') return report(context);
  return json({ error: { message: 'מתודה לא נתמכת.' } }, 405);
}

async function submit({ request, env }) {
  if (!(await rateLimit(env, request, 'feedback', 20))) {
    return json({ error: { message: 'יותר מדי משובים בזמן קצר.' } }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }

  const verdict = String(body.verdict || '');
  if (!VERDICTS[verdict]) return json({ error: { message: 'ערך משוב לא מוכר.' } }, 400);

  // Who said it, when we already know — verified from the token the browser was
  // already sending, never taken from the request body. A client-supplied
  // "this is who I am" would let anyone file a complaint under someone else's
  // name, in a store that decides whether a price gets re-examined.
  //
  // A guest stays a guest. This is not a place to start identifying people who
  // have not signed in: the verdict is just as usable without a name on it.
  let by = '';
  try {
    const token = bearerToken(request);
    if (token) by = (await verifyGoogleEmail(token)) || '';
  } catch { /* an unverifiable token is simply an anonymous verdict */ }

  const entry = {
    verdict,
    price: Number(body.price) || 0,
    jobType: String(body.jobType || '').slice(0, 40),
    quoteId: String(body.quoteId || '').slice(0, 60),
    by,
    // Free text is the most valuable field and the least structured. Clamped
    // hard: it is displayed back in an admin screen, so it must stay data.
    note: String(body.note || '').slice(0, 500),
    at: new Date().toISOString(),
  };

  // Storage is best-effort by design. A feedback widget that can break the app
  // it is attached to is worse than no widget.
  if (env.SJ_DATA) {
    try {
      const key = `feedback:${entry.at}:${Math.random().toString(36).slice(2, 8)}`;
      await env.SJ_DATA.put(key, JSON.stringify(entry),
        { expirationTtl: 60 * 60 * 24 * KEEP_DAYS });
    } catch { /* never fail the caller over telemetry */ }
  }

  if (VERDICTS[verdict].alert) await alertAdmin(env, entry);

  return json({ ok: true });
}

// Only "ממש לא" reaches Stav in the moment, and it goes to Telegram rather than
// email because email needs reading and a phone notification does not. If the
// bot is not configured this quietly does nothing — the verdict is still stored,
// so nothing is lost, it just waits to be read.
async function alertAdmin(env, entry) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALLOWED_CHATS) return;
  const chat = String(env.TELEGRAM_ALLOWED_CHATS).split(',')[0].trim();
  if (!chat) return;
  const text = [
    '🔴 משוב תמחור: "ממש לא"',
    entry.jobType ? `סוג עבודה: ${entry.jobType}` : null,
    entry.price ? `המחיר שניתן: ${entry.price} ₪` : null,
    entry.by ? `מי: ${entry.by}` : null,
    entry.note ? `הערה: ${entry.note}` : null,
    entry.quoteId ? `הצעה: ${entry.quoteId}` : null,
  ].filter(Boolean).join('\n');
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
  } catch { /* an alert that fails must not fail the submission */ }
}

async function report({ request, env }) {
  const gate = await adminGate(request);
  if (!gate.ok) return json(gate.body, gate.status);
  if (!env.SJ_DATA) return json({ entries: [], rates: {}, total: 0 });

  const listed = await env.SJ_DATA.list({ prefix: 'feedback:', limit: 1000 });
  const keys = listed.keys.map((k) => k.name).sort().reverse().slice(0, LIST_LIMIT);
  const entries = [];
  for (const k of keys) {
    try {
      const v = JSON.parse(await env.SJ_DATA.get(k));
      if (v && v.verdict) entries.push(v);
    } catch { /* skip a corrupt row rather than fail the report */ }
  }

  // Rates per job type, because that is the number that means something. A raw
  // count of complaints says nothing without how many quotes went out.
  const byJob = {};
  for (const e of entries) {
    const j = e.jobType || 'לא ידוע';
    const b = byJob[j] || (byJob[j] = { total: 0, way_off: 0, bit_high: 0, bit_low: 0, spot_on: 0, bias: 0 });
    b.total += 1;
    b[e.verdict] += 1;
    b.bias += VERDICTS[e.verdict].weight;
  }
  for (const b of Object.values(byJob)) {
    // Negative bias = quoting high, positive = quoting low. Averaged so job
    // types with different volumes stay comparable.
    b.bias = Number((b.bias / b.total).toFixed(2));
    b.wrongRate = Number((b.way_off / b.total).toFixed(2));
  }

  return json({ total: entries.length, rates: byJob, entries: entries.slice(0, 50) });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors() },
  });
}

export { VERDICTS };
