// Shared tier/limits logic for the ZEREM freemium plans (Move 2).
//
// Tiers: guest → free → pro → business (+ admin, unlimited).
// The defaults below are the product spec; an admin can override any number
// at runtime by saving a JSON object to KV key `config:tiers` (via /api/tier),
// so price/limit tuning never needs a redeploy.
//
// Per-user tier assignment lives in KV as `tier:<email>` = "free"|"pro"|"business"
// (missing key = free). Guests (no verified Google token) are always "guest".

export const ADMIN_EMAIL = 'stavjan19989@gmail.com';

// -1 means unlimited. Keys:
//   aiDaily        — AI requests per day (server-enforced in /api/chat)
//   projects       — max simultaneous projects (client-enforced)
//   quotesPerMonth — quotes newly saved to cloud per calendar month (/api/data)
//   catalogItems   — personal price-catalog size (client-enforced)
//   reports        — field reports feature
//   reminders      — follow-up reminders feature
//   shareLink      — public share-link for quotes
//   advancedModel  — access to the "advanced ⚡" model class
//   pdfCredit      — whether PDFs carry the "הופק באמצעות זרם" credit line
export const TIER_DEFAULTS = {
  guest: {
    aiDaily: 10, projects: 1, quotesPerMonth: 0, catalogItems: 10,
    reports: false, reminders: false, shareLink: false, advancedModel: false, pdfCredit: true,
  },
  free: {
    // quotesPerMonth = distinct PDF exports allowed per month (monthly-renewing,
    // server-enforced per Google account; guests can't export at all).
    aiDaily: 20, projects: 3, quotesPerMonth: 3, catalogItems: 10,
    reports: false, reminders: false, shareLink: false, advancedModel: false, pdfCredit: true,
  },
  pro: {
    aiDaily: 150, projects: -1, quotesPerMonth: -1, catalogItems: 1000,
    reports: true, reminders: true, shareLink: true, advancedModel: true, pdfCredit: false,
  },
  business: {
    aiDaily: 300, projects: -1, quotesPerMonth: -1, catalogItems: 2000,
    reports: true, reminders: true, shareLink: true, advancedModel: true, pdfCredit: false,
  },
  admin: {
    aiDaily: -1, projects: -1, quotesPerMonth: -1, catalogItems: 5000,
    reports: true, reminders: true, shareLink: true, advancedModel: true, pdfCredit: false,
  },
};

export const TIER_NAMES = ['guest', 'free', 'pro', 'business'];

// Model classes the client is allowed to ask for. Real model names never leave
// the server — the client only speaks "basic" / "advanced".
export const MODEL_CLASS = {
  basic: { provider: 'gemini', model: 'gemini-2.5-flash' },
  advanced: { provider: 'gemini', model: 'gemini-2.5-pro' },
};

// Merge the admin-editable KV config over the shipped defaults.
export async function loadTierConfig(env) {
  const merged = JSON.parse(JSON.stringify(TIER_DEFAULTS));
  if (!env.SJ_DATA) return merged;
  try {
    const raw = await env.SJ_DATA.get('config:tiers');
    if (raw) {
      const custom = JSON.parse(raw);
      for (const t of Object.keys(custom || {})) {
        if (merged[t] && custom[t] && typeof custom[t] === 'object') {
          Object.assign(merged[t], custom[t]);
        }
      }
    }
  } catch { /* bad config JSON → defaults win */ }
  return merged;
}

// Resolve a (possibly null) verified email to a tier name.
export async function getTierForEmail(env, email) {
  if (!email) return 'guest';
  if (email.toLowerCase() === ADMIN_EMAIL) return 'admin';
  if (!env.SJ_DATA) return 'free';
  try {
    const t = await env.SJ_DATA.get('tier:' + email.toLowerCase());
    return t && TIER_DEFAULTS[t] ? t : 'free';
  } catch {
    return 'free';
  }
}

// Our Google OAuth client id (public). Used to validate the audience of ID
// tokens so a token minted for another app can't be replayed here.
export const GOOGLE_CLIENT_ID = '4351198135-oltod8jremuq7pgn2e5bad4ahkupufkp.apps.googleusercontent.com';

// Verify a Google credential → account email (null if invalid). Accepts BOTH:
//  • an ID token (JWT, header.payload.signature — what silent FedCM auth yields)
//    verified via the tokeninfo endpoint with an audience check, and
//  • a legacy OAuth access token (ya29…, from the interactive login) via userinfo.
export async function verifyGoogleEmail(token) {
  if (!token) return null;
  // A JWT has exactly three dot-separated segments; access tokens do not.
  if (token.split('.').length === 3) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
      if (!res.ok) return null;
      const info = await res.json();
      // Signature/expiry are validated by the endpoint; we check the audience
      // and that the email is verified.
      if (info && info.email && info.aud === GOOGLE_CLIENT_ID && info.email_verified !== 'false') {
        return info.email;
      }
      return null;
    } catch {
      return null;
    }
  }
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

export function bearerToken(request) {
  return (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

export function monthKey(d) {
  return (d || new Date()).toISOString().slice(0, 7); // "2026-07"
}

export function dayKey(d) {
  return (d || new Date()).toISOString().slice(0, 10); // "2026-07-04"
}

export function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Lightweight per-IP rate limiter (KV-backed). Returns true when the caller is
// allowed, false when over the limit. Fails OPEN if KV isn't bound (dev). Used
// to protect the unauthenticated AI/email endpoints (/scrape, /lead) from cost
// abuse — /chat already has its own per-tier daily quota.
export async function rateLimit(env, request, bucket, maxPerMinute) {
  if (!env.SJ_DATA) return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const minute = Math.floor(Date.now() / 60000);
  const key = `rl:${bucket}:${ip}:${minute}`;
  try {
    const used = parseInt((await env.SJ_DATA.get(key)) || '0', 10);
    if (used >= maxPerMinute) return false;
    // TTL 120s covers the whole minute window plus clock skew.
    await env.SJ_DATA.put(key, String(used + 1), { expirationTtl: 120 });
    return true;
  } catch {
    return true; // never let the limiter itself take the endpoint down
  }
}

// SSRF guard: reject URLs that resolve to loopback/link-local/private ranges or
// non-web schemes, so /api/scrape can't be turned into a server-side fetch of
// internal services or cloud metadata endpoints.
export function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  // Named-host blocklist.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  if (host === 'metadata' || host.endsWith('.metadata.google.internal')) return false;
  // Any IPv6 literal (incl. [::1], [::ffff:127.0.0.1]) — reject outright.
  if (host.startsWith('[') || host.includes(':')) return false;
  // If the host has a letter it's a domain name — real suppliers are named
  // sites (arkha.co.il …). If it has NO letter it's an IP in SOME encoding, and
  // the ONLY form we accept is a strict, public dotted-quad. This closes every
  // smuggled-loopback trick at once: 127.1, 2130706433, 0x7f000001, 0177.0.0.1,
  // 127.0.1 — none are a clean 4-octet decimal, so all are rejected.
  if (!/[a-z]/i.test(host)) {
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const oct = m.slice(1);
    if (oct.some((s) => s.length > 1 && s[0] === '0')) return false; // octal-ambiguous
    const o = oct.map((n) => parseInt(n, 10));
    if (o.some((n) => n > 255)) return false;
    const [a, b] = o;
    if (a === 0 || a === 127 || a === 10 || a >= 224) return false; // loopback / private-A / multicast+reserved
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT (100.64/10)
  }
  return true;
}
