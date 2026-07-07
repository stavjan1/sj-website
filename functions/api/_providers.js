// Invoicing provider abstraction — the "connect your own provider" foundation.
//
// Each user can pick which invoicing provider ZEREM produces documents through
// and store their own credentials. SmartBee is adapter #1 (live); the others are
// registered with their credential shape but not wired to a create-document
// adapter yet (status 'soon') — adding one is: implement its adapter + mapping.
//
// Per-user config lives in KV as `billing:<email>` = { provider, credentials{} }.
// Credentials never leave the server in GET responses (only a hasCredentials flag).

// UI/metadata registry. `fields` describe the credential inputs the client renders
// for that provider. `status`: 'active' = wired; 'soon' = chooseable, not yet live.
export const PROVIDERS = {
  smartbee: {
    id: 'smartbee', name: 'SmartBee', status: 'active',
    note: 'ברירת המחדל של זרם. אם יש לך טוקן אישי מ-SmartBee הדבק אותו; אחרת נשתמש בחשבון המערכת.',
    fields: [{ key: 'token', label: 'providerUserToken (אישי, לא חובה)', optional: true }],
  },
  greeninvoice: {
    id: 'greeninvoice', name: 'Green Invoice (morning)', status: 'active',
    note: 'חיבור עצמי: הדבק API Key + Secret מהגדרות המפתחים ב-morning (הגדרות → כלי מפתחים).',
    fields: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'apiSecret', label: 'API Secret' },
      { key: 'sandbox', label: 'מצב בדיקות (Sandbox)', type: 'checkbox', optional: true },
    ],
  },
  icount: {
    id: 'icount', name: 'iCount', status: 'active',
    note: 'חיבור עצמי: מזהה חברה (cid) + משתמש וסיסמה. מומלץ ליצור משתמש API ייעודי ב-iCount (הגדרות → משתמשים) ולא את הכניסה הראשית.',
    fields: [
      { key: 'cid', label: 'מזהה חברה (cid)' },
      { key: 'user', label: 'שם משתמש (API)' },
      { key: 'pass', label: 'סיסמה' },
    ],
  },
};

export const DEFAULT_PROVIDER = 'smartbee';

export function providerMeta(id) { return PROVIDERS[id] || null; }
export function isProviderActive(id) { const p = PROVIDERS[id]; return !!(p && p.status === 'active'); }

// Public metadata for the client (no secrets) — the provider cards + fields.
export function publicProviderList() {
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, status: p.status, note: p.note, fields: p.fields }));
}

// The calling user's billing config from KV (falls back to the default provider).
export async function getUserBilling(env, email) {
  const fallback = { provider: DEFAULT_PROVIDER, credentials: {} };
  if (!env.SJ_DATA || !email) return fallback;
  try {
    const raw = await env.SJ_DATA.get('billing:' + email.toLowerCase());
    if (!raw) return fallback;
    const cfg = JSON.parse(raw);
    return { provider: PROVIDERS[cfg.provider] ? cfg.provider : DEFAULT_PROVIDER, credentials: cfg.credentials || {} };
  } catch {
    return fallback;
  }
}

export async function saveUserBilling(env, email, provider, credentials) {
  if (!env.SJ_DATA || !email) return false;
  if (!PROVIDERS[provider]) return false;
  const clean = {};
  const meta = PROVIDERS[provider];
  (meta.fields || []).forEach((f) => { if (credentials && credentials[f.key]) clean[f.key] = String(credentials[f.key]).slice(0, 2000); });
  await env.SJ_DATA.put('billing:' + email.toLowerCase(), JSON.stringify({ provider, credentials: clean }));
  return true;
}
