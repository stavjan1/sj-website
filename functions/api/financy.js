// Cloudflare Pages Function — Financy (Open-Finance.ai) bank connector for PRO.
//
//   GET  /api/financy                    → { connected, lastSync, lastError }
//   POST /api/financy { action:'saveCreds', userId, clientId, clientSecret }
//   POST /api/financy { action:'sync' }      → pull accounts + transactions into the record
//   POST /api/financy { action:'refresh' }   → ask Financy to re-fetch the banks (20 credits)
//   POST /api/financy { action:'disconnect' }
//
// The credentials are the user's own (Financy Settings → גישה ל-API, Starter
// plan). They live in the user's finance record in KV and are never echoed. Sync writes accounts (bank + cards, with balances) and entries
// (transactions, de-duplicated by external id) — manual data is left alone.

import { verifyGoogleEmail, bearerToken, getTierForEmail, jsonResponse, ADMIN_EMAIL, rateLimit } from './_tiers.js';

const PRO_TIERS = ['pro', 'business', 'admin'];
const keyFor = (email) => email === ADMIN_EMAIL ? 'finance:admin' : `finance:${email}`;

async function proGate(env, request) {
    const email = await verifyGoogleEmail(bearerToken(request));
    if (!email) return { ok: false, response: jsonResponse({ error: { message: 'נדרשת התחברות.', code: 'auth-expired' } }, 401) };
    const tier = await getTierForEmail(env, email);
    if (!PRO_TIERS.includes(tier)) return { ok: false, response: jsonResponse({ error: { message: 'חיבור בנקים הוא תכונת PRO.' } }, 403) };
    return { ok: true, email };
}

async function loadRecord(env, email) {
    try { return JSON.parse(await env.SJ_DATA.get(keyFor(email)) || 'null') || { accounts: [], entries: [], recurring: [], settings: {} }; }
    catch { return { accounts: [], entries: [], recurring: [], settings: {} }; }
}
function saveRecord(env, email, rec) {
    rec.lastUpdated = Date.now();
    return env.SJ_DATA.put(keyFor(email), JSON.stringify(rec));
}
function publicStatus(rec) {
    const fz = (rec.settings && rec.settings.financy) || {};
    return { connected: !!(fz.clientId && fz.clientSecret && fz.userId), lastSync: fz.lastSync || null, dataDate: fz.dataDate || null, lastError: fz.lastError || null };
}

// ── Financy adapter ────────────────────────────────────────────────────────
// The adapter is written and shipped: functions/api/_financy.js. Credentials are
// each user's own, entered in the UI — there is no env var to set and nothing
// waiting on a registration.
import { financySync, financyRefresh } from './_financy.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);
    const gate = await proGate(env, request);
    if (!gate.ok) return gate.response;
    const rec = await loadRecord(env, gate.email);
    return jsonResponse(publicStatus(rec));
}

export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);
    const gate = await proGate(env, request);
    if (!gate.ok) return gate.response;
    if (!(await rateLimit(env, request, 'financy', 20))) return jsonResponse({ error: { message: 'יותר מדי בקשות, נסו בעוד דקה.' } }, 429);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }
    const rec = await loadRecord(env, gate.email);
    rec.settings = rec.settings || {};
    const fz = rec.settings.financy = rec.settings.financy || {};

    if (body.action === 'saveCreds') {
        const clean = (v) => String(v || '').trim();
        const userId = clean(body.userId), clientId = clean(body.clientId), clientSecret = clean(body.clientSecret);
        if (!userId || !clientId || clientSecret.length < 8 || [userId, clientId, clientSecret].some(v => v.length > 512)) {
            return jsonResponse({ error: { message: 'חסרים פרטים: User ID, Client ID ו-Client Secret (מהגדרות Financy → גישה ל-API).' } }, 400);
        }
        Object.assign(fz, { userId, clientId, clientSecret, token: null, tokenExp: 0, connectedAt: Date.now(), lastError: null });
        await saveRecord(env, gate.email, rec);
        return jsonResponse({ ok: true, message: 'הפרטים נשמרו. עכשיו "סנכרן עכשיו".', ...publicStatus(rec) });
    }

    if (body.action === 'disconnect') {
        delete rec.settings.financy;
        rec.accounts = (rec.accounts || []).filter(a => a.source !== 'financy');
        rec.entries = (rec.entries || []).filter(e => e.source !== 'financy');
        await saveRecord(env, gate.email, rec);
        return jsonResponse({ ok: true, message: 'החיבור נותק והנתונים מהבנקים הוסרו.', ...publicStatus(rec) });
    }

    if (body.action === 'sync') {
        if (!(fz.clientId && fz.clientSecret && fz.userId)) return jsonResponse({ error: { message: 'אין פרטי Financy שמורים.' } }, 400);
        try {
            const result = await financySync(fz, rec);
            fz.lastSync = Date.now();
            if (result.dataDate) fz.dataDate = result.dataDate;
            if (!fz.lastError) fz.lastError = null;
            await saveRecord(env, gate.email, rec);
            return jsonResponse({ ok: true, message: result.message, ...publicStatus(rec) });
        } catch (e) {
            fz.lastError = String(e && e.message || e).slice(0, 160);
            await saveRecord(env, gate.email, rec);
            return jsonResponse({ error: { message: fz.lastError } }, 502);
        }
    }

    if (body.action === 'refresh') {
        if (!(fz.clientId && fz.clientSecret && fz.userId)) return jsonResponse({ error: { message: 'אין פרטי Financy שמורים.' } }, 400);
        try {
            const message = await financyRefresh(fz);
            await saveRecord(env, gate.email, rec); // the minted token is cached in the record
            return jsonResponse({ ok: true, message, ...publicStatus(rec) });
        } catch (e) {
            return jsonResponse({ error: { message: String(e && e.message || e).slice(0, 160) } }, 502);
        }
    }

    return jsonResponse({ error: { message: 'פעולה לא מוכרת.' } }, 400);
}
