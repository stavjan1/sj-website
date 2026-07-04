// Cloudflare Pages Function — admin-only tier management (Move 2).
// No payments yet: Stav assigns plans by hand after a WhatsApp deal.
//
// All calls require the ADMIN's Google token.
//   GET  /api/tier?email=x@y.com     → { email, tier }
//   GET  /api/tier?config=1          → { config } (effective merged config)
//   POST /api/tier {email, tier}     → set a user's tier ("free" removes the key)
//   POST /api/tier {config: {...}}   → save limit overrides to KV `config:tiers`

import {
  ADMIN_EMAIL, TIER_DEFAULTS, TIER_NAMES, loadTierConfig,
  verifyGoogleEmail, bearerToken, jsonResponse,
} from './_tiers.js';

async function requireAdmin(request) {
  const email = await verifyGoogleEmail(bearerToken(request));
  return email && email.toLowerCase() === ADMIN_EMAIL ? email : null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request))) return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);

  const url = new URL(request.url);
  if (url.searchParams.get('config')) {
    return jsonResponse({ config: await loadTierConfig(env), defaults: TIER_DEFAULTS });
  }
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return jsonResponse({ error: { message: 'חסר אימייל.' } }, 400);
  const tier = (await env.SJ_DATA.get('tier:' + email)) || 'free';
  return jsonResponse({ email, tier });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request))) return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }

  // Save limit overrides (only known tiers/keys are kept).
  if (body.config && typeof body.config === 'object') {
    const clean = {};
    for (const t of Object.keys(TIER_DEFAULTS)) {
      if (body.config[t] && typeof body.config[t] === 'object') {
        clean[t] = {};
        for (const k of Object.keys(TIER_DEFAULTS[t])) {
          if (k in body.config[t]) clean[t][k] = body.config[t][k];
        }
      }
    }
    await env.SJ_DATA.put('config:tiers', JSON.stringify(clean));
    return jsonResponse({ ok: true, config: await loadTierConfig(env) });
  }

  // Assign a user's tier.
  const email = (body.email || '').trim().toLowerCase();
  const tier = (body.tier || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return jsonResponse({ error: { message: 'אימייל לא תקין.' } }, 400);
  if (!TIER_NAMES.includes(tier)) {
    return jsonResponse({ error: { message: 'מסלול לא מוכר. אפשרויות: ' + TIER_NAMES.join(', ') } }, 400);
  }
  if (tier === 'free' || tier === 'guest') {
    await env.SJ_DATA.delete('tier:' + email); // free is the default — no key needed
  } else {
    await env.SJ_DATA.put('tier:' + email, tier);
  }
  return jsonResponse({ ok: true, email, tier: tier === 'guest' ? 'free' : tier });
}
