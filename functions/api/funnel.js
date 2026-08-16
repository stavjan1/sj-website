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
    if (!gate.ok) return gate.response; // carries the proper Hebrew 401/403 body
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);

    // Read cap + parallel chunks: the Workers free plan allows ~50 subrequests
    // per invocation, and each blob is one KV get. 40 newest-listed users per
    // call keeps headroom for the pdfmo list below; `capped` tells the UI.
    const list = await env.SJ_DATA.list({ prefix: 'user:', limit: 40 });
    const users = [];
    const blobs = [];
    for (let i = 0; i < list.keys.length; i += 10) {
        const chunk = list.keys.slice(i, i + 10);
        const got = await Promise.all(chunk.map(k => env.SJ_DATA.get(k.name).catch(() => null)));
        chunk.forEach((k, j) => blobs.push([k.name, got[j]]));
    }
    for (const [name, raw] of blobs) {
        let blob = null;
        try { blob = JSON.parse(raw || 'null'); } catch { }
        if (!blob) continue;
        const email = name.slice(5);
        const projects = Array.isArray(blob.projects) ? blob.projects : [];
        const history = Array.isArray(blob.history) ? blob.history : [];
        // Count only what the USER typed — every project is seeded with one
        // model greeting per chat, which would inflate the funnel to 100%.
        const userMsgs = (arr) => Array.isArray(arr) ? arr.filter(m => m && m.role === 'user').length : 0;
        let chatMsgs = 0, planned = 0;
        projects.forEach(p => {
            const plan = userMsgs(p.planChatHistory);
            const price = userMsgs(p.chatHistory);
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
        oneMessageOnly: users.filter(u => u.chatMsgs > 0 && u.chatMsgs <= 2).length, // real typed messages only
        capped: list.list_complete === false || list.keys.length >= 40,
    };

    users.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    return jsonResponse({ funnel, users: users.slice(0, 100) });
}
