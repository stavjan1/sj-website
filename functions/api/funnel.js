// Cloudflare Pages Function — product-usage funnel for the admin panel.
//
//   GET /api/funnel  (admin) → who actually uses ZEREM and how deep they go:
//   sign-up → opened a project → talked to the AI → produced a quote → PDF.
//
// Reads the user:* blobs (launch-scale: capped at 200 list entries) plus this
// month's pdfmo/quotesmo counters. Aggregates + a per-user activity table so
// retention is visible ("do people throw it away after one message?").

import { adminGate, jsonResponse, monthKey } from './_tiers.js';
import { listAnonVisitors } from './_anon.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response; // carries the proper Hebrew 401/403 body
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);

    // Read cap + parallel chunks: the Workers free plan allows ~50 subrequests
    // per invocation, and each blob is one KV get. 40 users per call keeps
    // headroom for the pdfmo list below, and `capped` tells the UI — which now
    // actually prints it, having ignored the flag since it was added.
    //
    // NOT "newest". KV list() returns keys in lexicographic order, so this is
    // the alphabetically-first 40 email addresses. It is a sample, and not even
    // a random one — which is exactly why the caller has to be told.
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
        // A handoff turn is the app pressing a button on the user's behalf, and
        // a hidden turn is a prompt he never saw. Counting either as
        // "conversation" makes every drop-off number look better than it is —
        // which is the one thing this screen exists not to do.
        const userMsgs = (arr) => Array.isArray(arr)
            ? arr.filter(m => m && m.role === 'user' && !m.handoff && !m.hidden).length : 0;
        // How far the work itself got, which is the question the funnel's user
        // counts cannot answer: a person can have ten projects and none of them
        // past the first conversation.
        const stageOf = (p) => p.stage
            || ((p.chatHistory || []).some(m => m && m.role === 'user') ? 'pricing' : 'planning');
        let chatMsgs = 0, planned = 0, atPricing = 0, atDraft = 0;
        projects.forEach(p => {
            const plan = userMsgs(p.planChatHistory);
            const price = userMsgs(p.chatHistory);
            chatMsgs += plan + price;
            if (plan > 0) planned++;
            const st = stageOf(p);
            if (st === 'pricing' || st === 'draft') atPricing++;
            if (st === 'draft') atDraft++;
        });
        users.push({
            email,
            firstSeen: blob.firstSeen || null,
            lastUpdated: blob.lastUpdated || null,
            projects: projects.length,
            projectsPlanned: planned,
            projectsPricing: atPricing,
            projectsDraft: atDraft,
            chatMsgs,
            quotes: history.length,
            catalogItems: Array.isArray(blob.catalog) ? blob.catalog.length : 0,
        });
    }

    // The people who never signed in — the bulk of a launch day, and until now
    // completely absent from this screen. Kept as their own rows rather than
    // merged into the totals: "one signed-up user" and "forty strangers who
    // asked one question each" are different facts, and averaging them would
    // hide both.
    const anon = await listAnonVisitors(env, 200);
    const anonUsers = anon.visitors.map((v) => ({
        email: v.label,          // "אנונימי 3" — a rank, not an identity
        anon: true,
        firstSeen: v.firstSeen,
        lastUpdated: v.lastSeen,
        projects: 0,
        projectsPlanned: 0,
        chatMsgs: v.msgs || 0,
        quotes: 0,
        catalogItems: 0,
    }));

    // PDF exporters this month (server-metered, verified emails).
    const mo = monthKey(new Date());
    const pdfList = await env.SJ_DATA.list({ prefix: 'pdfmo:', limit: 500 });
    const pdfThisMonth = pdfList.keys.filter(k => k.name.endsWith(':' + mo)).length;

    const funnel = {
        signedUp: users.length,
        openedProject: users.filter(u => u.projects > 0).length,
        talkedToAI: users.filter(u => u.chatMsgs > 0).length,
        // The two steps between "talked" and "produced a quote", which were
        // invisible: the funnel showed a cliff and no way to see where on it
        // people let go.
        reachedPricing: users.filter(u => (u.projectsPricing || 0) > 0).length,
        reachedDraft: users.filter(u => (u.projectsDraft || 0) > 0).length,
        producedQuote: users.filter(u => u.quotes > 0).length,
        pdfThisMonth,
        activeLast7d: users.filter(u => u.lastUpdated && (Date.now() - u.lastUpdated) < 7 * 864e5).length,
        oneMessageOnly: users.filter(u => u.chatMsgs > 0 && u.chatMsgs <= 2).length, // real typed messages only
        capped: list.list_complete === false || list.keys.length >= 40,
        anonVisitors: anonUsers.length,
        anonMsgs: anonUsers.reduce((s, u) => s + u.chatMsgs, 0),
        anonCapped: anon.capped,
    };

    users.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    // Signed-up users first, then the anonymous ones in their own stable order.
    // Sorting the two groups together by activity would move "אנונימי 3" up and
    // down the table on every refresh — the exact instability the numbering
    // exists to prevent, reintroduced at the last step.
    return jsonResponse({ funnel, users: users.slice(0, 100).concat(anonUsers) });
}
