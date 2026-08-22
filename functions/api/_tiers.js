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
    // 10 → 25 (21.8.2026) → 100 (22.8.2026), both at Stav's request. This is
    // the quota every anonymous visitor gets, counted per IP per day, so it is
    // a cost lever as much as a limit: the per-minute burst guard in chat.js
    // still caps abuse, but the daily ceiling is what bounds a bad day. Easy to
    // walk back, and without a deploy: set `config:tiers` in KV.
    aiDaily: 100, projects: 1, quotesPerMonth: 0, catalogItems: 10,
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
// The shipped defaults. Changing which model serves customers used to require a
// deploy, which is why the app sat two generations behind without anyone
// deciding to: nobody wants to redeploy on a hunch. `config:models` in KV
// overrides these, so the switch is an admin action taken AFTER the trap suite
// has been run against the candidate — evidence first, then one click.
// 2026-08-21: gemini-2.5-flash began returning 404 "no longer available to new
// users", and because 404 was not a retriable status the pricing chat answered
// every question with a Google error string instead of falling back. Google's
// own message named gemini-3.6-flash as the replacement, so that is what this
// is — the version Google pointed at, not a guess at the newest number.
export const MODEL_CLASS = {
  basic: { provider: 'gemini', model: 'gemini-3.6-flash' },
  advanced: { provider: 'gemini', model: 'gemini-2.5-pro' },
};

export async function loadModelClass(env) {
  const merged = JSON.parse(JSON.stringify(MODEL_CLASS));
  if (!env || !env.SJ_DATA) return merged;
  try {
    const raw = await env.SJ_DATA.get('config:models');
    if (!raw) return merged;
    const cfg = JSON.parse(raw);
    for (const cls of ['basic', 'advanced']) {
      if (cfg[cls] && typeof cfg[cls].model === 'string') {
        merged[cls].model = cfg[cls].model;
        if (typeof cfg[cls].provider === 'string') merged[cls].provider = cfg[cls].provider;
      }
    }
  } catch { /* a broken override must never take the AI down */ }
  return merged;
}

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

// Is this a Google ID token (JWT)? A JWT is exactly 3 dot-separated segments
// AND its first segment base64url-decodes to a header object with `alg`. This
// is critical: OAuth access tokens (ya29.a0Af…) can ALSO contain two dots, so a
// naive segment count misclassifies them as JWTs and routes them to id_token
// verification, which rejects them → the caller is wrongly treated as a guest
// (broke auth + cloud sync intermittently).
function looksLikeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const hdr = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    return !!(hdr && (hdr.alg || hdr.typ === 'JWT'));
  } catch {
    return false; // first segment isn't a JSON header → not a JWT (e.g. ya29…)
  }
}

// Verify a Google credential → account email (null if invalid). Accepts BOTH:
//  • an ID token (JWT, header.payload.signature — what silent FedCM auth yields)
//    verified via the tokeninfo endpoint with an audience check, and
//  • a legacy OAuth access token (ya29…, from the interactive login) via userinfo.
export async function verifyGoogleEmail(token) {
  if (!token) return null;
  if (looksLikeJwt(token)) {
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
  // Opaque OAuth access token (ya29…). CRITICAL: verify the AUDIENCE, not just
  // that the token is valid for *some* Google app. /userinfo alone happily
  // accepts a token minted by ANY OAuth client, so a token leaked from an
  // unrelated site the user signed into could be replayed here — including
  // against the admin gates (token substitution / confused deputy). tokeninfo
  // returns `aud`, so we can bind the token to OUR client id before trusting it.
  try {
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
    if (!res.ok) return null;
    const info = await res.json();
    if (!info || info.aud !== GOOGLE_CLIENT_ID) return null;   // minted for another app → reject
    if (info.email_verified === 'false' || info.email_verified === false) return null;
    if (info.email) return info.email;
    // Audience is confirmed but this token carries no email claim — fetch it.
    const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!ui.ok) return null;
    const profile = await ui.json();
    return profile && profile.email ? profile.email : null;
  } catch {
    return null;
  }
}

export function bearerToken(request) {
  return (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

// The admin gate, with the two failures kept apart.
//
// They were one answer before — "אין הרשאה", 403 — for both "your token
// expired" and "you are not the admin". A Google access token lives an hour,
// so the everyday case is the first one, and it read on screen as the second:
// the owner of the account being told he has no permission on his own admin
// panel, with nothing suggesting that signing in again would fix it. 401 means
// "prove who you are again" and the client silently re-mints on it; 403 means
// "we know who you are, and it isn't you".
//
// Returns { ok: true, email } on success. On failure it hands back a ready
// `response` plus the raw `status`/`body`, so an endpoint that serialises its
// own replies (catalog.js adds CORS headers) can re-wrap instead of losing them.
export async function adminGate(request) {
  const email = await verifyGoogleEmail(bearerToken(request));
  const deny = (status, body) => ({ ok: false, status, body, response: jsonResponse(body, status) });
  if (!email) {
    return deny(401, { error: { message: 'ההתחברות פגה, התחבר שוב לגוגל.', code: 'auth-expired' } });
  }
  if (email.toLowerCase() !== ADMIN_EMAIL) {
    return deny(403, { error: { message: 'אין הרשאה.' } });
  }
  return { ok: true, email };
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
