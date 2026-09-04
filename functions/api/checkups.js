// Cloudflare Pages Function — per-user cloud storage for the periodic-checkup
// reminders tool (/checkups). Same identity model as data.js: the browser sends
// a Google token, we verify it and derive the email, KV key `checkups:<email>`.
// Works for ANY Google account — each user sees only their own client list.

import { verifyGoogleEmail, bearerToken } from './_tiers.js';
import { json as reply, corsHeaders, preflight, safeParse } from './_http.js';

const METHODS = 'GET, PUT, POST, OPTIONS';
const CORS = corsHeaders(METHODS);
const json = (obj, status) => reply(obj, status, CORS);

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return preflight(request, METHODS);
  }

  if (!env.SJ_DATA) {
    return json({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  }

  const token = bearerToken(request);
  if (!token) return json({ error: { message: 'חסר אסימון הזדהות.' } }, 401);

  const email = await verifyGoogleEmail(token);
  if (!email) return json({ error: { message: 'הזדהות Google לא תקפה.' } }, 401);

  const key = 'checkups:' + email.toLowerCase();

  if (method === 'GET') {
    const stored = await env.SJ_DATA.get(key);
    return json({ data: stored ? safeParse(stored) : null });
  }

  if (method === 'PUT' || method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: { message: 'גוף בקשה לא תקין.' } }, 400); }
    const incoming = body && body.data;
    if (!incoming || !Array.isArray(incoming.clients)) {
      return json({ error: { message: 'אין נתונים לשמירה.' } }, 400);
    }

    // SAFETY: an empty list never overwrites a non-empty one (same guard as
    // data.js — protects against a blank device wiping the cloud copy).
    const existingRaw = await env.SJ_DATA.get(key);
    const existing = existingRaw ? safeParse(existingRaw) : null;
    if (incoming.clients.length === 0 &&
        existing && Array.isArray(existing.clients) && existing.clients.length > 0) {
      return json({ ok: true, skipped: 'empty-over-nonempty' });
    }

    const payload = JSON.stringify({ clients: incoming.clients, lastUpdated: Date.now() });
    if (payload.length > 1024 * 1024) {
      return json({ error: { message: 'הנתונים גדולים מדי לאחסון בענן.' } }, 413);
    }
    await env.SJ_DATA.put(key, payload);
    return json({ ok: true, updatedAt: Date.now() });
  }

  return json({ error: { message: 'מתודה לא נתמכת.' } }, 405);
}
