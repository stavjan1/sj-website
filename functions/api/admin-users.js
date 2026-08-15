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
  ADMIN_EMAIL, adminGate, jsonResponse, getTierForEmail,
} from './_tiers.js';
import { sendMailTracked } from './_mail.js';

const USER_PREFIX = 'user:';

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function projectAmount(p) {
  const qd = (p && p.quoteData) || {};
  return Number(qd.finalPrice || qd.total || 0) || 0;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
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
        firstSeen: (db && db.firstSeen) || null,
      });
    }
  } while (cursor && users.length < 500);

  // Most recently active first.
  users.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

  // Delivery state of the signup notification. Shown next to the counter so a
  // broken key is visible where it matters — the old notification failed
  // silently for months while the UI claimed it was working.
  let mail = null;
  try { mail = safeParse((await env.SJ_DATA.get('mail:last:signup')) || 'null'); } catch { /* optional */ }
  const mailConfigured = !!(env.RESEND_API_KEY);

  return jsonResponse({ ok: true, count: users.length, users, mail, mailConfigured });
}


// POST /api/admin-users  { test: 'mail' }  → send a real test email to the admin
//
// Exists because the only honest way to know outbound mail works is to send
// one. Verifying that needed a second Google account and a signup; this makes
// it a button, and it exercises the exact path a real signup takes —
// sendMailTracked, same channel key, same recording — so a pass here means a
// signup would have arrived too.
export async function onRequestPost(context) {
  const { request, env } = context;

  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  if (body.test !== 'mail') return jsonResponse({ error: { message: 'בקשה לא מוכרת.' } }, 400);

  if (!env.RESEND_API_KEY) {
    return jsonResponse({
      ok: false,
      reason: 'לא הוגדר RESEND_API_KEY במשתני הסביבה של Cloudflare — בלעדיו לא נשלח דבר.',
    });
  }

  const result = await sendMailTracked(env, 'signup', {
    to: ADMIN_EMAIL,
    subject: '⚡ בדיקת מייל מזרם',
    text: `זו הודעת בדיקה שנשלחה מפאנל הניהול של זרם.

אם היא הגיעה — ההתראה על נרשם חדש תגיע גם היא, דרך אותו נתיב בדיוק.`,
  });

  return jsonResponse({
    ok: !!result.ok,
    reason: result.ok ? null : (result.error || result.skipped || 'שגיאה לא ידועה'),
  });
}
