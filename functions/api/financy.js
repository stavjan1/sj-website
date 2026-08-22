// Cloudflare Pages Function — Financy (Open-Finance.ai) bank connector for PRO.
//
//   GET  /api/financy                    → { connected, lastSync, lastError }
//   POST /api/financy { action:'saveKey', key }   → store the user's Financy API key
//   POST /api/financy { action:'sync' }           → pull accounts + transactions into
//                                                   the user's finance record
//   POST /api/financy { action:'disconnect' }
//
// The key is the user's own credential for THEIR Financy account (read-only
// open-banking data). It lives in the user's finance record in KV, never in
// a response. Sync writes accounts (bank + cards, with balances) and entries
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
    return { connected: !!fz.apiKey, lastSync: fz.lastSync || null, lastError: fz.lastError || null };
}

// ── Financy adapter ────────────────────────────────────────────────────────
// Filled in against the documented API; until then sync reports what it needs.
import { financySync } from './_financy.js';

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

    if (body.action === 'saveKey') {
        const key = String(body.key || '').trim();
        if (key.length < 8 || key.length > 512) return jsonResponse({ error: { message: 'מפתח לא תקין.' } }, 400);
        fz.apiKey = key;
        fz.connectedAt = Date.now();
        fz.lastError = null;
        await saveRecord(env, gate.email, rec);
        return jsonResponse({ ok: true, message: 'המפתח נשמר. עכשיו "סנכרן עכשיו".', ...publicStatus(rec) });
    }

    if (body.action === 'disconnect') {
        delete rec.settings.financy;
        rec.accounts = (rec.accounts || []).filter(a => a.source !== 'financy');
        rec.entries = (rec.entries || []).filter(e => e.source !== 'financy');
        await saveRecord(env, gate.email, rec);
        return jsonResponse({ ok: true, message: 'החיבור נותק והנתונים מהבנקים הוסרו.', ...publicStatus(rec) });
    }

    if (body.action === 'sync') {
        if (!fz.apiKey) return jsonResponse({ error: { message: 'אין מפתח Financy שמור.' } }, 400);
        try {
            const result = await financySync(fz.apiKey, rec);
            fz.lastSync = Date.now();
            fz.lastError = null;
            await saveRecord(env, gate.email, rec);
            return jsonResponse({ ok: true, message: result.message, ...publicStatus(rec) });
        } catch (e) {
            fz.lastError = String(e && e.message || e).slice(0, 160);
            await saveRecord(env, gate.email, rec);
            return jsonResponse({ error: { message: fz.lastError } }, 502);
        }
    }

    return jsonResponse({ error: { message: 'פעולה לא מוכרת.' } }, 400);
}
