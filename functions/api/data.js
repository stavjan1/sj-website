// Cloudflare Pages Function — per-user cloud storage for the /sale quote tool.
//
// Identity = a verified Google account. The browser sends the Google OAuth
// access token; this function verifies it with Google, derives the email, and
// uses it as the KV key. No password/secret is ever stored here.
//
// Storage = a Workers KV namespace bound as `SJ_DATA`. Add it (free) in
// Cloudflare Pages → Settings → Functions → KV namespace bindings, variable
// name `SJ_DATA`. Until it's bound, every call returns 501 and the client
// silently falls back to local-only storage, so the app keeps working.
//
// Free KV tier: 1 GB storage, 100k reads/day, 1k writes/day. The client
// debounces writes to stay well within budget.
//
// Move 2 (tiers): free-plan users may save up to N NEW quotes to the cloud per
// calendar month (default 5, admin-tunable via `config:tiers`). A sync that
// would push a 6th new quote is rejected with code QUOTA_QUOTES — the client
// keeps everything locally (PDF export still works) and shows the upgrade
// screen. Counted by history-entry IDs that don't exist in the stored blob.

import { loadTierConfig, getTierForEmail, monthKey, verifyGoogleEmail } from './_tiers.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (!env.SJ_DATA) {
    // Binding not configured yet — tell the client to stay local-only.
    return json({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  }

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: { message: 'חסר אסימון הזדהות.' } }, 401);

  const email = await verifyGoogleEmail(token);
  if (!email) return json({ error: { message: 'הזדהות Google לא תקפה.' } }, 401);

  const key = 'user:' + email.toLowerCase();

  if (method === 'GET') {
    const stored = await env.SJ_DATA.get(key);
    return json({ data: stored ? safeParse(stored) : null });
  }

  if (method === 'PUT' || method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: { message: 'גוף בקשה לא תקין.' } }, 400); }
    const incoming = body && body.data;
    if (!incoming || typeof incoming !== 'object') {
      return json({ error: { message: 'אין נתונים לשמירה.' } }, 400);
    }

    const existingRaw = await env.SJ_DATA.get(key);
    const existing = existingRaw ? safeParse(existingRaw) : null;

    // SAFETY: never let a fully-empty payload overwrite an existing non-empty
    // record. Protects against a blank local load wiping the cloud copy.
    if (isEmptyDb(incoming) && existing && !isEmptyDb(existing)) {
      return json({ ok: true, skipped: 'empty-over-nonempty' });
    }

    // The full backup ALWAYS saves (settings, projects, catalog, history) — the
    // cloud is the source of truth across devices, so we never reject a sync.
    const payload = JSON.stringify({ ...incoming, lastUpdated: incoming.lastUpdated || Date.now() });
    // KV value hard limit is 25 MB; cap far below that to stay sane.
    if (payload.length > 5 * 1024 * 1024) {
      return json({ error: { message: 'הנתונים גדולים מדי לאחסון בענן.' } }, 413);
    }
    await env.SJ_DATA.put(key, payload);

    // ---- Free-plan monthly cloud-quote counter (SOFT — never blocks the save) ----
    // Count quotes that are genuinely new to the cloud this sync. Re-syncing an
    // existing library (new device, guest→Google upgrade, cleared KV) must NOT
    // count old quotes as new, so we compare against the just-saved snapshot's
    // predecessor. When over the monthly allowance we still save everything and
    // only flag `quotaSoftExceeded` so the client can show a gentle upgrade nudge.
    let quotaSoftExceeded = false;
    const tier = await getTierForEmail(env, email);
    const config = await loadTierConfig(env);
    const limit = (config[tier] || config.free).quotesPerMonth;
    if (limit !== -1) {
      const existingIds = new Set(
        (existing && Array.isArray(existing.history) ? existing.history : [])
          .map((q) => q && q.id).filter(Boolean));
      const newQuotes = (Array.isArray(incoming.history) ? incoming.history : [])
        .filter((q) => q && q.id && !existingIds.has(q.id));
      // Only count as "new this month" when the cloud already had a library
      // (existing non-empty). A first/rebuild sync seeds the baseline for free.
      const hadCloudLibrary = existing && Array.isArray(existing.history) && existing.history.length > 0;
      if (newQuotes.length > 0 && hadCloudLibrary) {
        const moKey = `quotesmo:${email.toLowerCase()}:${monthKey()}`;
        const used = parseInt((await env.SJ_DATA.get(moKey)) || '0', 10);
        const next = used + newQuotes.length;
        quotaSoftExceeded = next > limit;
        // ~40 days TTL — the key dies naturally after its month ends.
        context.waitUntil(env.SJ_DATA.put(moKey, String(next), { expirationTtl: 60 * 60 * 24 * 40 }));
      }
    }

    return json({ ok: true, updatedAt: Date.now(), quotaSoftExceeded });
  }

  return json({ error: { message: 'מתודה לא נתמכת.' } }, 405);
}


function isEmptyDb(db) {
  if (!db) return true;
  const len = (k) => (Array.isArray(db[k]) ? db[k].length : 0);
  return len('history') === 0 && len('projects') === 0 && len('trash') === 0 && len('catalog') === 0;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors() },
  });
}
