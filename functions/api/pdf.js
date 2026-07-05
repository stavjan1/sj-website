// Cloudflare Pages Function — POST /api/pdf  ("may I export a PDF?").
//
// PDF generation is client-side, so a per-month export cap can only be ENFORCED
// for a signed-in user: the count is keyed to their verified Google email in KV
// and survives clearing the browser / switching devices. Guests have no
// identity → they're blocked entirely (the client does that; this is defense in
// depth). Pro/Business/Admin are unlimited.
//
// De-duped by quoteId: re-exporting or revising the SAME quote never burns
// another slot — only distinct quotes count toward the monthly allowance.

import {
  ADMIN_EMAIL, loadTierConfig, getTierForEmail,
  verifyGoogleEmail, bearerToken, monthKey, jsonResponse,
} from './_tiers.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = bearerToken(request);
  const email = token ? await verifyGoogleEmail(token) : null;
  if (!email) {
    // No verified identity → guest. Cannot meter, so cannot allow.
    return jsonResponse({ allow: false, reason: 'guest' });
  }

  const tier = await getTierForEmail(env, email);
  const config = await loadTierConfig(env);
  const limit = (config[tier] || config.free).quotesPerMonth;

  // Unlimited plans (pro/business/admin, or an admin-set -1) — always allow.
  if (email.toLowerCase() === ADMIN_EMAIL || limit === -1) {
    return jsonResponse({ allow: true, unlimited: true });
  }
  // KV not bound (local/dev) → don't block a real user over missing infra.
  if (!env.SJ_DATA) return jsonResponse({ allow: true, unlimited: false });

  let body = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }
  const quoteId = String(body.quoteId || '').slice(0, 80);
  const mo = monthKey();
  const counterKey = `pdfmo:${email.toLowerCase()}:${mo}`;

  // Re-export of a quote already counted this month → free (no extra charge).
  if (quoteId) {
    const seenKey = `pdfseen:${email.toLowerCase()}:${mo}:${quoteId}`;
    if (await env.SJ_DATA.get(seenKey)) {
      const used = parseInt((await env.SJ_DATA.get(counterKey)) || '0', 10);
      return jsonResponse({ allow: true, used, limit, repeat: true });
    }
  }

  const used = parseInt((await env.SJ_DATA.get(counterKey)) || '0', 10);
  if (used >= limit) {
    return jsonResponse({ allow: false, reason: 'quota', used, limit });
  }

  // Charge one slot and remember this quote so revisions don't re-charge.
  const next = used + 1;
  const ttl = 60 * 60 * 24 * 40; // ~40 days — the key dies after its month
  context.waitUntil(env.SJ_DATA.put(counterKey, String(next), { expirationTtl: ttl }));
  if (quoteId) {
    context.waitUntil(env.SJ_DATA.put(
      `pdfseen:${email.toLowerCase()}:${mo}:${quoteId}`, '1', { expirationTtl: ttl }));
  }
  return jsonResponse({ allow: true, used: next, limit });
}
