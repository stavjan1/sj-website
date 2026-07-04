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
    aiDaily: 20, projects: 3, quotesPerMonth: 5, catalogItems: 10,
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

// Verify a Google OAuth access token → account email (null if invalid).
export async function verifyGoogleEmail(token) {
  if (!token) return null;
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
