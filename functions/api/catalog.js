// Cloudflare Pages Function — GET/PUT /api/catalog
// The SHARED system price catalog: curated by the admin, served to every user.
// Each user's personal catalog overrides matching items locally (client-side
// merge) — the system catalog is the market baseline, personal prices win.
//
// Storage: the same Workers KV namespace as /api/data (binding `SJ_DATA`),
// under the reserved key `system:catalog` (user data lives under `user:<email>`,
// so the namespaces can't collide). Until KV is bound, GET returns an empty
// catalog and the app simply works without a system baseline.

const ADMIN_EMAIL = 'stavjan19989@gmail.com';
const KEY = 'system:catalog';
const MAX_ITEMS = 1000;

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  if (method === 'GET') {
    if (!env.SJ_DATA) return json({ items: [], updatedAt: 0 });
    const stored = await env.SJ_DATA.get(KEY);
    const data = stored ? safeParse(stored) : null;
    return json({
      items: (data && Array.isArray(data.items)) ? data.items : [],
      updatedAt: (data && data.updatedAt) || 0,
    });
  }

  if (method === 'PUT' || method === 'POST') {
    if (!env.SJ_DATA) return json({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);

    // Admin only: the publisher must be signed in as the admin Google account.
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: { message: 'חסר אסימון הזדהות.' } }, 401);
    const email = await verifyGoogleEmail(token);
    if (!email || email.toLowerCase() !== ADMIN_EMAIL) {
      return json({ error: { message: 'רק מנהל המערכת יכול לפרסם את מאגר המערכת.' } }, 403);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: { message: 'גוף בקשה לא תקין.' } }, 400); }
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((it) => ({
        name: String(it && it.name != null ? it.name : '').trim().slice(0, 120),
        price: Number(it && it.price),
        unit: String(it && it.unit != null ? it.unit : '').trim().slice(0, 30),
      }))
      .filter((it) => it.name && Number.isFinite(it.price))
      .slice(0, MAX_ITEMS);

    const payload = { items, updatedAt: Date.now(), publishedBy: email };
    await env.SJ_DATA.put(KEY, JSON.stringify(payload));
    return json({ ok: true, count: items.length, updatedAt: payload.updatedAt });
  }

  return json({ error: { message: 'מתודה לא נתמכת.' } }, 405);
}

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
