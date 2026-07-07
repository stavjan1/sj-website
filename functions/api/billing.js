// Cloudflare Pages Function — per-user invoicing-provider config.
//
//   GET  /api/billing  → { providers:[…metadata…], current:{ provider, hasCredentials } }
//   POST /api/billing  { provider, credentials{} } → save the user's choice
//
// Each signed-in user manages their OWN provider selection (which invoicing
// service ZEREM produces documents through) and credentials. Secrets are never
// returned to the client — GET reports only whether credentials are stored.

import { verifyGoogleEmail, bearerToken, jsonResponse } from './_tiers.js';
import { publicProviderList, getUserBilling, saveUserBilling, PROVIDERS } from './_providers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const email = await verifyGoogleEmail(bearerToken(request));
  if (!email) return jsonResponse({ error: { message: 'נדרשת התחברות.' } }, 401);
  const cfg = await getUserBilling(env, email);
  return jsonResponse({
    providers: publicProviderList(),
    current: { provider: cfg.provider, hasCredentials: Object.keys(cfg.credentials || {}).length > 0 },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const email = await verifyGoogleEmail(bearerToken(request));
  if (!email) return jsonResponse({ error: { message: 'נדרשת התחברות.' } }, 401);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }
  const provider = body && body.provider;
  if (!PROVIDERS[provider]) return jsonResponse({ error: { message: 'ספק לא מוכר.' } }, 400);

  const ok = await saveUserBilling(env, email, provider, body.credentials || {});
  if (!ok) return jsonResponse({ error: { message: 'שמירה נכשלה.' } }, 500);
  return jsonResponse({ ok: true, provider });
}
