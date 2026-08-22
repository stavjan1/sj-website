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

import { verifyGoogleEmail, bearerToken, getTierForEmail, jsonResponse, ADMIN_EMAIL } from './_tiers.js';

// PRO feature: every paying account (pro/business) plus the owner gets its OWN
// record; the owner's key stays 'finance:admin' so nothing he entered moves.
const PRO_TIERS = ['pro', 'business', 'admin'];
function keyFor(email) { return email === ADMIN_EMAIL ? 'finance:admin' : `finance:${email}`; }
async function proGate(env, request) {
    const email = await verifyGoogleEmail(bearerToken(request));
    if (!email) return { ok: false, response: jsonResponse({ error: { message: 'נדרשת התחברות.', code: 'auth-expired' } }, 401) };
    const tier = await getTierForEmail(env, email);
    if (!PRO_TIERS.includes(tier)) return { ok: false, response: jsonResponse({ error: { message: 'תזרים מזומנים הוא תכונת PRO.', code: 'pro-required' } }, 403) };
    return { ok: true, email, tier };
}
const MAX_BYTES = 2 * 1024 * 1024;

function emptyRecord() {
    return { accounts: [], entries: [], recurring: [], settings: {}, lastUpdated: 0 };
}

export async function onRequestGet(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) לא מוגדר.' } }, 501);
    const gate = await proGate(env, request);
    if (!gate.ok) return gate.response;
    const KEY = keyFor(gate.email);

    let record;
    try { record = JSON.parse(await env.SJ_DATA.get(KEY) || 'null') || emptyRecord(); }
    catch { record = emptyRecord(); }

    // Income side for free: the owner's own ZEREM invoices live in the user blob.
    let invoiceIncome = [];
    try {
        const blob = JSON.parse(await env.SJ_DATA.get(`user:${gate.email}`) || 'null');
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

    return jsonResponse({ data: record, invoiceIncome });
}

export async function onRequestPut(context) { return savePut(context); }
export async function onRequestPost(context) { return savePut(context); }

async function savePut(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) לא מוגדר.' } }, 501);
    const gate = await proGate(env, request);
    if (!gate.ok) return gate.response;
    const KEY = keyFor(gate.email);

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

    const raw = JSON.stringify(record);
    if (raw.length > MAX_BYTES) return jsonResponse({ error: { message: 'הנתונים גדולים מדי (מעל 2MB).' } }, 413);

    // Same guard family as /api/data: an all-empty save never overwrites real data.
    if (!record.accounts.length && !record.entries.length && !record.recurring.length) {
        let existing = null;
        try { existing = JSON.parse(await env.SJ_DATA.get(KEY) || 'null'); } catch { }
        const len = (v) => Array.isArray(v) ? v.length : 0;
        if (existing && (len(existing.accounts) || len(existing.entries) || len(existing.recurring))) {
            return jsonResponse({ ok: true, skipped: 'empty-over-nonempty' });
        }
    }

    await env.SJ_DATA.put(KEY, raw);
    return jsonResponse({ ok: true, updatedAt: record.lastUpdated });
}
