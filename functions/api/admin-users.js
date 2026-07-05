// Cloudflare Pages Function — admin registered-users list (admin only).
//
//   GET /api/admin-users            → [{ email, projects, history, lastUpdated, tier }]
//   GET /api/admin-users?user=<em>  → { email, tier, projects:[{name,status,created,amount}] }
//
// Enumerates the `user:<email>` KV records written by /api/data. Admin-gated by
// the verified Google email (never trust a client flag). Returns only lightweight
// summaries — enough to see who's using the system and what they're working on,
// without shipping every user's full quote blob to the browser.

import {
  ADMIN_EMAIL, verifyGoogleEmail, bearerToken, jsonResponse, getTierForEmail,
} from './_tiers.js';

const USER_PREFIX = 'user:';

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function projectAmount(p) {
  const qd = (p && p.quoteData) || {};
  return Number(qd.finalPrice || qd.total || 0) || 0;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const email = await verifyGoogleEmail(bearerToken(request));
  if (!email || email.toLowerCase() !== ADMIN_EMAIL) {
    return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
  }
  if (!env.SJ_DATA) {
    return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('user');

  // --- One user's projects (on accordion expand) ---
  if (target) {
    const raw = await env.SJ_DATA.get(USER_PREFIX + target.toLowerCase());
    const db = raw ? safeParse(raw) : null;
    const projects = (db && Array.isArray(db.projects) ? db.projects : []).map((p) => ({
      id: p.id,
      name: p.name || '—',
      status: p.status || 'טיוטה',
      created: p.created || null,
      amount: projectAmount(p),
    }));
    const tier = await getTierForEmail(env, target);
    return jsonResponse({ ok: true, email: target, tier, projects });
  }

  // --- All users (summaries) ---
  const users = [];
  let cursor;
  do {
    const res = await env.SJ_DATA.list({ prefix: USER_PREFIX, cursor, limit: 1000 });
    cursor = res.list_complete ? null : res.cursor;
    for (const k of res.keys) {
      const em = k.name.slice(USER_PREFIX.length);
      const raw = await env.SJ_DATA.get(k.name);
      const db = raw ? safeParse(raw) : null;
      users.push({
        email: em,
        projects: db && Array.isArray(db.projects) ? db.projects.length : 0,
        history: db && Array.isArray(db.history) ? db.history.length : 0,
        lastUpdated: (db && db.lastUpdated) || null,
      });
    }
  } while (cursor && users.length < 500);

  // Most recently active first.
  users.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
  return jsonResponse({ ok: true, count: users.length, users });
}
