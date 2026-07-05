// SmartBee invoicing API — shared server helpers (test environment).
//
// Master credentials live in Cloudflare env (never in code):
//   SMARTBEE_CLIENT_ID   — the API ClientId
//   SMARTBEE_PASSWORD    — the API password
//   SMARTBEE_TOKEN       — the master providerUserToken (Stav's own business,
//                          used for the pilot; per-user tokens come later via
//                          /Users/loginToken once Eddy confirms the flow)
//
// Flow (from the v1 OpenAPI spec): POST /Login/authenticate {clientId,password}
// → JWT (Bearer). Documents are created async on a queue: POST /Documents/create
// → { apiMessageId }, then GET /Documents/{apiMessageId} for status.

export const SB_BASE = 'https://test.smartbee.co.il/api/v1';

// The ₪ ceiling for a single document until מספר-הקצאה handling is wired in.
export const SB_MAX_DOC = 5000;

// Authenticate → JWT. Cached in KV (`smartbee:jwt`) until ~expiry so we don't
// re-auth on every call. Returns { token } or { error, status, detail }.
export async function smartbeeAuth(env) {
  const clientId = env.SMARTBEE_CLIENT_ID;
  const password = env.SMARTBEE_PASSWORD;
  if (!clientId || !password) {
    return { error: 'חסרות הגדרות SmartBee בשרת (SMARTBEE_CLIENT_ID / SMARTBEE_PASSWORD).' };
  }
  // Reuse a still-valid cached JWT.
  if (env.SJ_DATA) {
    try {
      const cached = JSON.parse((await env.SJ_DATA.get('smartbee:jwt')) || 'null');
      if (cached && cached.token && cached.exp && Date.now() < cached.exp - 60000) {
        return { token: cached.token, cached: true };
      }
    } catch { /* fall through and re-auth */ }
  }
  let res, data;
  try {
    res = await fetch(SB_BASE + '/Login/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ clientId, password }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { error: 'תקלת רשת מול SmartBee: ' + (e && e.message ? e.message : e) };
  }
  if (!res.ok) return { error: `הזדהות SmartBee נכשלה (${res.status})`, status: res.status, detail: data };

  // The token field name isn't pinned in the extracted spec — try the usual ones.
  const token = data.token || data.jwt || data.accessToken || data.access_token ||
    (data.data && (data.data.token || data.data.jwt));
  if (!token) return { error: 'הזדהות SmartBee לא החזירה token', detail: data };

  let exp = Date.now() + 50 * 60 * 1000; // default ~50m if we can't read the JWT
  try { const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.exp) exp = p.exp * 1000; } catch { /* keep default */ }
  if (env.SJ_DATA) { try { await env.SJ_DATA.put('smartbee:jwt', JSON.stringify({ token, exp }), { expirationTtl: 3600 }); } catch { /* non-fatal */ } }
  return { token, exp };
}

// Authenticated call to a SmartBee endpoint. Returns { ok, status, data }.
export async function smartbeeCall(env, method, path, body) {
  const auth = await smartbeeAuth(env);
  if (auth.error) return { ok: false, status: 0, error: auth.error, detail: auth.detail };
  let res, data;
  try {
    res = await fetch(SB_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer ' + auth.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, status: 0, error: 'תקלת רשת מול SmartBee: ' + (e && e.message ? e.message : e) };
  }
  return { ok: res.ok, status: res.status, data };
}

// Map an internal vatOption to SmartBee's enum.
export function sbVatOption(vatType) {
  if (vatType === 'exempt' || vatType === 'free') return 'Free';
  if (vatType === 'include') return 'Include';
  return 'NotInclude'; // default: prices are pre-VAT
}
