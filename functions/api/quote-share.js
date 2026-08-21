// Cloudflare Pages Function — POST/GET /api/quote-share
// A shareable web link for a quote: instead of (or alongside) a PDF file,
// the client opens a permanent link and sees the quote in the browser.
// This is the seed of the "client archive" — every shared quote gets a
// permanent token; a per-client archive page can group them later.
//
// POST (owner only — verified Google token): body { data: {...quote fields} }
//   → stores under KV key `share:<token>` and returns { token }.
// GET ?t=<token> (public): returns { data } for the viewer page (/q/).

import { ADMIN_EMAIL, verifyGoogleEmail, loadTierConfig, getTierForEmail } from './_tiers.js';

const MAX_PAYLOAD = 300 * 1024; // logo included only if small; no watermark
const MAX_ITEMS = 200;

// Inline base64 images only, matched as a COMPLETE string. The viewer (/q/)
// renders these into an <img src>, so a value that merely STARTS with a valid
// data-URL prefix but continues with a quote would break out of the attribute.
// Validated here too so hostile data never even reaches storage.
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/i;

const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const img = (v) => (DATA_IMAGE.test(String(v || '')) ? String(v) : '');

// Server-side shape allowlist. The client builds a well-formed payload, but the
// client is not a trust boundary — anyone can POST here directly with curl, so
// the stored record is rebuilt field by field with clamped types and lengths.
// Unknown fields are dropped rather than persisted.
function sanitizeQuote(d) {
  const biz = (d && typeof d.business === 'object' && d.business) || {};
  const sig = (d && typeof d.signature === 'object' && d.signature) || null;
  const out = {
    clientName: str(d.clientName, 200),
    clientSub: str(d.clientSub, 200),
    quoteNumber: str(d.quoteNumber, 60),
    date: str(d.date, 60),
    subject: str(d.subject, 300),
    vatLabel: str(d.vatLabel, 120),
    summary: str(d.summary, 5000),
    finalPrice: Number(d.finalPrice) || 0,
    showItemizedPrices: d.showItemizedPrices === true,
    logo: img(d.logo),
    business: {
      name: str(biz.name, 120),
      owner: str(biz.owner, 120),
      phone: str(biz.phone, 40),
      email: str(biz.email, 120),
    },
    items: (Array.isArray(d.items) ? d.items : []).slice(0, MAX_ITEMS).map((it) => ({
      title: str(it && it.title, 300),
      description: str(it && it.description, 2000),
      price: Number(it && it.price) || 0,
    })).filter((it) => it.title || it.description),
  };
  if (sig) {
    const sigImg = img(sig.img);
    if (sigImg) out.signature = { img: sigImg, name: str(sig.name, 120), date: str(sig.date, 60) };
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (!env.SJ_DATA) return json({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);

  if (method === 'GET') {
    const token = new URL(request.url).searchParams.get('t') || '';
    if (!/^[a-z0-9]{8,20}$/i.test(token)) return json({ error: { message: 'קישור לא תקין.' } }, 400);
    const stored = await env.SJ_DATA.get('share:' + token);
    if (!stored) return json({ error: { message: 'ההצעה לא נמצאה, ייתכן שהקישור שגוי.' } }, 404);
    // Public endpoint: never expose the owner's Google account email (internal
    // bookkeeping only) to whoever holds the link.
    const data = safeParse(stored);
    if (data && typeof data === 'object') delete data.owner;
    return json({ data });
  }

  if (method === 'POST') {
    // Only a signed-in (verified) user can create share links.
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: { message: 'שיתוף בקישור זמין למשתמשי Google בלבד.' } }, 401);
    const email = await verifyGoogleEmail(token);
    if (!email) return json({ error: { message: 'הזדהות Google לא תקפה.' } }, 401);

    // Plan gate, enforced SERVER-SIDE. The client checks tierAllows('shareLink')
    // too, but that's a UI courtesy — without this check any free account could
    // curl the endpoint and mint permanent, un-TTL'd public pages on our domain.
    const isAdmin = email.toLowerCase() === ADMIN_EMAIL;
    if (!isAdmin) {
      const tier = await getTierForEmail(env, email);
      const config = await loadTierConfig(env);
      if (!(config[tier] || config.free).shareLink) {
        return json({ error: { message: 'קישור ללקוח זמין במסלול Pro/עסקי.', code: 'TIER' } }, 403);
      }
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }
    const data = body && body.data;
    if (!data || typeof data !== 'object') return json({ error: { message: 'אין נתוני הצעה.' } }, 400);

    const payload = JSON.stringify({ ...sanitizeQuote(data), owner: email, createdAt: Date.now() });
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
