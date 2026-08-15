// Cloudflare Pages Function — product-usage funnel for the admin panel.
//
//   GET /api/funnel  (admin) → who actually uses ZEREM and how deep they go:
//   sign-up → opened a project → talked to the AI → produced a quote → PDF.
//
// Reads the user:* blobs (launch-scale: capped at 200 list entries) plus this
// month's pdfmo/quotesmo counters. Aggregates + a per-user activity table so
// retention is visible ("do people throw it away after one message?").

import { adminGate, jsonResponse, monthKey } from './_tiers.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const gate = await adminGate(request);
    if (!gate.ok) return jsonResponse({ error: { message: gate.message } }, gate.status);
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);

    const list = await env.SJ_DATA.list({ prefix: 'user:', limit: 200 });
    const users = [];
    for (const key of list.keys) {
        let blob = null;
        try { blob = JSON.parse(await env.SJ_DATA.get(key.name) || 'null'); } catch { }
        if (!blob) continue;
        const email = key.name.slice(5);
        const projects = Array.isArray(blob.projects) ? blob.projects : [];
        const history = Array.isArray(blob.history) ? blob.history : [];
        let chatMsgs = 0, planned = 0;
        projects.forEach(p => {
            const plan = Array.isArray(p.planChatHistory) ? p.planChatHistory.length : 0;
            const price = Array.isArray(p.chatHistory) ? p.chatHistory.length : 0;
            chatMsgs += plan + price;
            if (plan > 0) planned++;
        });
        users.push({
            email,
            firstSeen: blob.firstSeen || null,
            lastUpdated: blob.lastUpdated || null,
            projects: projects.length,
            projectsPlanned: planned,
            chatMsgs,
            quotes: history.length,
            catalogItems: Array.isArray(blob.catalog) ? blob.catalog.length : 0,
        });
    }

    // PDF exporters this month (server-metered, verified emails).
    const mo = monthKey(new Date());
    const pdfList = await env.SJ_DATA.list({ prefix: 'pdfmo:', limit: 500 });
    const pdfThisMonth = pdfList.keys.filter(k => k.name.endsWith(':' + mo)).length;

    const funnel = {
        signedUp: users.length,
        openedProject: users.filter(u => u.projects > 0).length,
        talkedToAI: users.filter(u => u.chatMsgs > 0).length,
        producedQuote: users.filter(u => u.quotes > 0).length,
        pdfThisMonth,
        activeLast7d: users.filter(u => u.lastUpdated && (Date.now() - u.lastUpdated) < 7 * 864e5).length,
        oneMessageOnly: users.filter(u => u.chatMsgs > 0 && u.chatMsgs <= 2).length,
        capped: list.list_complete === false,
    };

    users.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    return jsonResponse({ funnel, users: users.slice(0, 100) });
}
