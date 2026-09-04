// Cloudflare Pages Function — private cash-flow data for the owner's finance
// dashboard (תזרים מזומנים), inspired by the Financy/open-banking setup.
//
//   GET  /api/finance             — the finance record + income derived from
//                                   the admin's own ZEREM invoices (KV blob)
//   PUT  /api/finance {data}      — save the finance record (manual entries,
//                                   accounts, recurring charges, settings)
//
// PRO-gated (proGate). Data model, all additive:
//   finance:admin = {
//     accounts:  [{ id, name, kind:'bank'|'card'|'cash', balance:Number, asOf:'YYYY-MM-DD' }],
//     entries:   [{ id, date:'YYYY-MM-DD', amount:Number (+income/-expense),
//                   desc, category, source:'manual'|'csv'|'sumit' }],
//     recurring: [{ id, name, amount:Number, dayOfMonth:1-28, category }],
//     settings:  { financy: { configured:false } },   // open-banking connector, phase 2
//     lastUpdated:Number
//   }
// Bank passwords/credentials never touch this system. When Financy (open
// banking, read-only) is registered, its keys will live in env vars — not KV.

import { proGate, jsonResponse, financeKey, readFinanceRecord } from './_tiers.js';

// PRO feature: every paying account (pro/business) plus the owner gets its OWN
// record; the owner's key stays 'finance:admin' so nothing he entered moves.
// The key (lower-cased, with the legacy raw-address fallback on read) and the
// PRO gate are shared with financy.js through _tiers.js — one record per
// account, whichever of the two routes touches it.
const PRO_DENIED = { message: 'תזרים מזומנים הוא תכונת PRO.', code: 'pro-required' };
const MAX_BYTES = 2 * 1024 * 1024;

function emptyRecord() {
    return { accounts: [], entries: [], recurring: [], settings: {}, lastUpdated: 0 };
}

export async function onRequestGet(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) לא מוגדר.' } }, 501);
    const gate = await proGate(env, request, PRO_DENIED);
    if (!gate.ok) return gate.response;
    const KEY = financeKey(gate.email);

    let record;
    try { record = JSON.parse(await readFinanceRecord(env, gate.email) || 'null') || emptyRecord(); }
    catch { record = emptyRecord(); }

    // Income side for free: the owner's own ZEREM invoices live in the user blob.
    let invoiceIncome = [];
    try {
        // data.js writes this key lower-cased. Reading it raw meant this lookup
        // silently found nothing for any address that was not already lowercase,
        // and the invoice income simply came back empty with no error.
        const blob = JSON.parse(await env.SJ_DATA.get(`user:${String(gate.email).toLowerCase()}`) || 'null');
        const invoices = blob && Array.isArray(blob.invoices) ? blob.invoices : [];
        for (const inv of invoices) {
            // Per-invoice guard: one malformed createdAt must not drop ALL income.
            try {
                if (!inv || !(Number(inv.total) > 0)) continue;
                const d = new Date(inv.createdAt);
                if (isNaN(d.getTime())) continue;
                // Same rule as the app's acctDueDate: שוטף = end of the issue month, +N days.
                const TERMS = { cash: null, net0: 0, net30: 30, net60: 60, net90: 90 };
                const days = TERMS[inv.terms] === undefined ? 30 : TERMS[inv.terms];
                let due = d;
                if (days !== null) { due = new Date(d.getFullYear(), d.getMonth() + 1, 0); due.setDate(due.getDate() + days); }
                invoiceIncome.push({
                    dueDate: due.toISOString().slice(0, 10),
                    terms: inv.terms || 'net30',
                    id: 'inv_' + (inv.id || inv.docNumber || invoiceIncome.length),
                    date: d.toISOString().slice(0, 10),
                    amount: Number(inv.total) || 0,
                    desc: (inv.docLabel || 'מסמך') + (inv.customer && inv.customer.name ? ', ' + inv.customer.name : ''),
                    category: 'הכנסות',
                    source: 'zerem',
                    paid: !!inv.paid,
                });
            } catch { /* skip this invoice only */ }
        }
    } catch { /* blob unreadable — dashboard still works from manual data */ }

    return jsonResponse({ data: redactFinancy(record), invoiceIncome });
}

// The Financy credentials never leave the server.
//
// financy.js stores the user's clientId, clientSecret, userId and the minted
// bearer token inside settings.financy, and builds a publicStatus() helper
// precisely so they are not echoed — then this endpoint returned the whole raw
// record, secret and live token included. It is the user's own credential going
// to the user's own browser over TLS, so nobody else's data is exposed; but it
// is a read credential for his BANK, sitting in a page response where any XSS,
// any browser extension and any intermediate cache can reach it. billing.js
// answers the same class of question with `hasCredentials: true`.
//
// The client only ever reads connected / dataDate / lastSync / lastError, so
// nothing on screen changes.
const FINANCY_SECRETS = ['clientSecret', 'token', 'tokenExp'];
function redactFinancy(record) {
    const fz = record && record.settings && record.settings.financy;
    if (!fz || typeof fz !== 'object') return record;
    const safe = { ...fz };
    for (const k of FINANCY_SECRETS) delete safe[k];
    safe.hasCredentials = !!(fz.clientId && fz.clientSecret && fz.userId);
    return { ...record, settings: { ...record.settings, financy: safe } };
}

// ...which means a save cannot be allowed to write the redacted copy back.
// The browser PUTs the whole blob, so without this the first save after any load
// would erase the credentials it was never sent.
function keepFinancySecrets(incoming, existing) {
    const prev = existing && existing.settings && existing.settings.financy;
    if (!prev) return incoming;
    const next = (incoming.settings && incoming.settings.financy) || {};
    const merged = { ...next };
    for (const k of FINANCY_SECRETS) {
        if (merged[k] === undefined && prev[k] !== undefined) merged[k] = prev[k];
    }
    return { ...incoming, settings: { ...incoming.settings, financy: merged } };
}

export async function onRequestPut(context) { return savePut(context); }
export async function onRequestPost(context) { return savePut(context); }

async function savePut(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) לא מוגדר.' } }, 501);
    const gate = await proGate(env, request, PRO_DENIED);
    if (!gate.ok) return gate.response;
    const KEY = financeKey(gate.email);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }
    const data = body && body.data;
    if (!data || typeof data !== 'object') return jsonResponse({ error: { message: 'חסר data.' } }, 400);

    const record = {
        accounts: Array.isArray(data.accounts) ? data.accounts.slice(0, 30) : [],
        entries: Array.isArray(data.entries) ? data.entries.slice(0, 5000) : [],
        recurring: Array.isArray(data.recurring) ? data.recurring.slice(0, 100) : [],
        settings: (data.settings && typeof data.settings === 'object') ? data.settings : {},
        lastUpdated: Date.now(),
    };

    // Re-attach anything the browser was never given. Must happen before the
    // size check and before the write.
    let prevRec = null;
    try { prevRec = JSON.parse(await readFinanceRecord(env, gate.email) || 'null'); } catch { }
    const merged = keepFinancySecrets(record, prevRec);
    const raw = JSON.stringify(merged);
    if (raw.length > MAX_BYTES) return jsonResponse({ error: { message: 'הנתונים גדולים מדי (מעל 2MB).' } }, 413);

    // Same guard family as /api/data: an all-empty save never overwrites real data.
    if (!record.accounts.length && !record.entries.length && !record.recurring.length) {
        let existing = null;
        try { existing = JSON.parse(await readFinanceRecord(env, gate.email) || 'null'); } catch { }
        const len = (v) => Array.isArray(v) ? v.length : 0;
        if (existing && (len(existing.accounts) || len(existing.entries) || len(existing.recurring))) {
            return jsonResponse({ ok: true, skipped: 'empty-over-nonempty' });
        }
    }

    await env.SJ_DATA.put(KEY, raw);
    return jsonResponse({ ok: true, updatedAt: record.lastUpdated });
}
