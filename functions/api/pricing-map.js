// Admin editor API for the field pricing knowledge map (the "DB" behind the
// pricing chats). GET returns the active map (+whether it's a KV override);
// POST saves a new map to KV `pricing:map` (empty body.map = revert to the
// built-in default). Admin-only — the map is injected into every pricing chat,
// so letting anyone edit it would be prompt-injection-as-a-service.

import { ADMIN_EMAIL, verifyGoogleEmail, bearerToken, jsonResponse } from './_tiers.js';
import { DEFAULT_PRICING_MAP, getPricingMap } from './_pricing_map.js';

async function requireAdmin(request) {
  const email = await verifyGoogleEmail(bearerToken(request));
  return !!email && email.toLowerCase() === ADMIN_EMAIL;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request))) return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
  let custom = null;
  try { custom = env.SJ_DATA ? await env.SJ_DATA.get('pricing:map') : null; } catch {}
  return jsonResponse({ map: await getPricingMap(env), isCustom: !!(custom && custom.trim()), defaultMap: DEFAULT_PRICING_MAP });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await requireAdmin(request))) return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מחובר.' } }, 501);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }
  const map = typeof body.map === 'string' ? body.map.trim() : '';
  if (!map) {
    await env.SJ_DATA.delete('pricing:map');           // revert to built-in default
    return jsonResponse({ ok: true, isCustom: false });
  }
  await env.SJ_DATA.put('pricing:map', map.slice(0, 20000)); // sane size cap
  return jsonResponse({ ok: true, isCustom: true });
}
