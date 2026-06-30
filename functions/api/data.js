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

    // SAFETY: never let a fully-empty payload overwrite an existing non-empty
    // record. Protects against a blank local load wiping the cloud copy.
    const incomingEmpty = isEmptyDb(incoming);
    if (incomingEmpty) {
      const existing = await env.SJ_DATA.get(key);
      if (existing && !isEmptyDb(safeParse(existing))) {
        return json({ ok: true, skipped: 'empty-over-nonempty' });
      }
    }

    const payload = JSON.stringify({ ...incoming, lastUpdated: incoming.lastUpdated || Date.now() });
    // KV value hard limit is 25 MB; cap far below that to stay sane.
    if (payload.length > 5 * 1024 * 1024) {
      return json({ error: { message: 'הנתונים גדולים מדי לאחסון בענן.' } }, 413);
    }
    await env.SJ_DATA.put(key, payload);
    return json({ ok: true, updatedAt: Date.now() });
  }

  return json({ error: { message: 'מתודה לא נתמכת.' } }, 405);
}

// Verify the access token directly with Google and return the account email.
async function verifyGoogleEmail(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return null;
    const info = await res.json();
    return info && info.email ? info.email : null;
  } catch {
    return null;
  }
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
