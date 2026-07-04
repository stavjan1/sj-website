// Cloudflare Pages Function — POST/GET /api/quote-share
// A shareable web link for a quote: instead of (or alongside) a PDF file,
// the client opens a permanent link and sees the quote in the browser.
// This is the seed of the "client archive" — every shared quote gets a
// permanent token; a per-client archive page can group them later.
//
// POST (owner only — verified Google token): body { data: {...quote fields} }
//   → stores under KV key `share:<token>` and returns { token }.
// GET ?t=<token> (public): returns { data } for the viewer page (/q/).

const MAX_PAYLOAD = 300 * 1024; // logo included only if small; no watermark

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (!env.SJ_DATA) return json({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);

  if (method === 'GET') {
    const token = new URL(request.url).searchParams.get('t') || '';
    if (!/^[a-z0-9]{8,20}$/i.test(token)) return json({ error: { message: 'קישור לא תקין.' } }, 400);
    const stored = await env.SJ_DATA.get('share:' + token);
    if (!stored) return json({ error: { message: 'ההצעה לא נמצאה — ייתכן שהקישור שגוי.' } }, 404);
    return json({ data: safeParse(stored) });
  }

  if (method === 'POST') {
    // Only a signed-in (verified) user can create share links.
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: { message: 'שיתוף בקישור זמין למשתמשי Google בלבד.' } }, 401);
    const email = await verifyGoogleEmail(token);
    if (!email) return json({ error: { message: 'הזדהות Google לא תקפה.' } }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }
    const data = body && body.data;
    if (!data || typeof data !== 'object') return json({ error: { message: 'אין נתוני הצעה.' } }, 400);

    const payload = JSON.stringify({ ...data, owner: email, createdAt: Date.now() });
    if (payload.length > MAX_PAYLOAD) {
      return json({ error: { message: 'ההצעה גדולה מדי לשיתוף בקישור (נסה בלי לוגו כבד).' } }, 413);
    }

    const shareToken = randomToken(10);
    await env.SJ_DATA.put('share:' + shareToken, payload); // permanent — no TTL
    return json({ ok: true, token: shareToken });
  }

  return json({ error: { message: 'מתודה לא נתמכת.' } }, 405);
}

function randomToken(len) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // no lookalikes
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += chars[b % chars.length];
  return out;
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
