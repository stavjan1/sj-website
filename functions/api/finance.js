// Cloudflare Pages Function — private cash-flow data for the owner's finance
// dashboard (תזרים מזומנים), inspired by the Financy/open-banking setup.
//
//   GET  /api/finance             — the finance record + income derived from
//                                   the admin's own ZEREM invoices (KV blob)
//   PUT  /api/finance {data}      — save the finance record (manual entries,
//                                   accounts, recurring charges, settings)
//
// Admin-only (adminGate). Data model, all additive:
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

import { adminGate, jsonResponse, ADMIN_EMAIL } from './_tiers.js';

const KEY = 'finance:admin';
const MAX_BYTES = 2 * 1024 * 1024;

function emptyRecord() {
    return { accounts: [], entries: [], recurring: [], settings: {}, lastUpdated: 0 };
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const gate = await adminGate(request);
    if (!gate.ok) return jsonResponse({ error: { message: gate.message } }, gate.status);
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) לא מוגדר.' } }, 501);

    let record;
    try { record = JSON.parse(await env.SJ_DATA.get(KEY) || 'null') || emptyRecord(); }
    catch { record = emptyRecord(); }

    // Income side for free: the owner's own ZEREM invoices live in the user blob.
    let invoiceIncome = [];
    try {
        const blob = JSON.parse(await env.SJ_DATA.get(`user:${ADMIN_EMAIL}`) || 'null');
        invoiceIncome = (blob && Array.isArray(blob.invoices) ? blob.invoices : [])
            .filter(inv => inv && Number(inv.total) > 0)
            .map(inv => ({
                id: 'inv_' + (inv.id || inv.docNumber || Math.random().toString(36).slice(2)),
                date: inv.createdAt ? new Date(inv.createdAt).toISOString().slice(0, 10) : null,
                amount: Number(inv.total) || 0,
                desc: (inv.docLabel || 'מסמך') + (inv.customer && inv.customer.name ? ' — ' + inv.customer.name : ''),
                category: 'הכנסות',
                source: 'zerem',
                paid: !!inv.paid,
            }))
            .filter(e => e.date);
    } catch { /* blob unreadable — dashboard still works from manual data */ }

    return jsonResponse({ data: record, invoiceIncome });
}

export async function onRequestPut(context) { return savePut(context); }
export async function onRequestPost(context) { return savePut(context); }

async function savePut(context) {
    const { request, env } = context;
    const gate = await adminGate(request);
    if (!gate.ok) return jsonResponse({ error: { message: gate.message } }, gate.status);
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) לא מוגדר.' } }, 501);

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
        if (existing && (existing.accounts.length || existing.entries.length || existing.recurring.length)) {
            return jsonResponse({ ok: true, skipped: 'empty-over-nonempty' });
        }
    }

    await env.SJ_DATA.put(KEY, raw);
    return jsonResponse({ ok: true, updatedAt: record.lastUpdated });
}
