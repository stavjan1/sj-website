// Cloudflare Pages Function — "who am I and what does my plan allow?".
//
// GET /api/me  (optional Authorization: Bearer <google access token>)
// → { tier, limits: {...}, usage: { aiToday, quotesThisMonth } }
//
// The client calls this once on boot/login and drives every gate in the UI
// from the answer, so limits are tuned server-side (KV `config:tiers`)
// without shipping a new app version.

import {
  loadTierConfig, getTierForEmail, verifyGoogleEmail,
  bearerToken, monthKey, dayKey, jsonResponse,
} from './_tiers.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const token = bearerToken(request);
  const email = token ? await verifyGoogleEmail(token) : null;
  const tier = await getTierForEmail(env, email);
  const config = await loadTierConfig(env);
  const limits = config[tier] || config.free;

  // Current usage — best effort (KV may not be bound in local testing).
  let aiToday = 0;
  let quotesThisMonth = 0;
  if (env.SJ_DATA) {
    try {
      const id = email
        ? 'u:' + email.toLowerCase()
        : 'ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown');
      aiToday = parseInt((await env.SJ_DATA.get(`quota:${id}:${dayKey()}`)) || '0', 10);
      if (email) {
        quotesThisMonth = parseInt(
          (await env.SJ_DATA.get(`quotesmo:${email.toLowerCase()}:${monthKey()}`)) || '0', 10);
      }
    } catch { /* usage stays 0 */ }
  }

  return jsonResponse({
    tier,
    email: email || null,
    limits,
    usage: { aiToday, quotesThisMonth },
  });
}
