// Cloudflare Pages Function — every conversation, across every user (admin only).
//
//   GET /api/admin-convos                     → the feed: newest threads first
//   GET /api/admin-convos?user=<em>&id=<pid>  → one thread, in full
//
// Stav, 28/08: "אני רוצה שיהיה לי גישה לראות את כל השיחות של כל משתמש. כדי
// ללמוד. הAI בווצאפ זה ככה וגם פה זה חשוב." The point is not surveillance, it
// is that the pricing agent can only be tuned against the questions people
// actually ask — and those questions are in here, not in a spec.
//
// WHAT THIS RETURNS IS OTHER PEOPLE'S BUSINESS. Customer names, phone numbers,
// addresses and prices. Three rules follow from that, and they are enforced
// here rather than left to the caller:
//   1. The gate is the verified Google email, checked server-side against
//      ADMIN_EMAIL. A client flag is never trusted; there is no query
//      parameter, header or body field that can widen access.
//   2. The FEED carries previews — a title and two excerpts of 160 characters.
//      Reading a whole conversation is a second, deliberate request naming one
//      user and one thread. Note honestly: for a short "ask" thread, two turns
//      IS the conversation, so the preview and the record are close to the same
//      thing. The distinction is real for jobs and thin for questions.
//   3. Nothing is written. This function has no PUT, POST or DELETE.
//
// Cost: one KV list plus one read per user, the same shape as /api/admin-users,
// which already runs on every admin panel open. Bounded by MAX_USERS and
// MAX_THREADS so a growing user base cannot turn one panel visit into a
// five-figure read bill.

import { adminGate, jsonResponse } from './_tiers.js';

const USER_PREFIX = 'user:';
// 150, not 500. Measured: one refresh costs one list plus one read per user,
// and the daily budget is 100,000 reads SHARED WITH THE WHOLE PRODUCT. At 500
// users a stuck Enter key on the refresh button — ~30 repeats a second — spends
// 37% of the day's reads in three seconds, and when the budget runs out
// /api/data returns 500 to every electrician and the pricing agent stops
// answering until midnight UTC. This is the cheap half of the fix; the other
// half is the loading guard on the client.
const MAX_USERS = 150;
const MAX_THREADS = 300;    // the feed is for reading, not for archiving
const PREVIEW = 160;

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// The text of one turn. The client stores Gemini's shape — { role, parts:[{text}] }
// — and older records sometimes carry a bare string.
// The agent is instructed to append a ```json block to every answer, and the
// prompt tells it in as many words that the block is not shown to the user. The
// client strips it in visibleChatText (sale/chat.js) — but the FULL answer is
// what gets stored, so a reader that does not strip it shows the operator
// machinery the user was never shown. Same cut, same place, one function.
function turnText(m) {
  if (!m) return '';
  let s = '';
  if (typeof m === 'string') s = m;
  else if (typeof m.text === 'string') s = m.text;
  else s = (Array.isArray(m.parts) ? m.parts : [])
      .map((p) => (p && typeof p.text === 'string' ? p.text : '')).join(' ');
  const fence = s.indexOf('```');
  return (fence !== -1 ? s.slice(0, fence) : s).trim();
}

// System scaffolding is not conversation: the prompt blocks the app injects are
// marked hidden, and reading them back tells you nothing about the user.
function visibleTurns(thread) {
  return (Array.isArray(thread) ? thread : []).filter((m) => m && !m.hidden);
}

// Same rule the app itself uses, so the admin sees the thread under the name
// the user sees. A project keeps the label "פרויקט חדש" until the agent titles
// it, and a list of those is not a list.
function threadTitle(p) {
  if (p.name && p.name !== 'פרויקט חדש' && !p.autoName) return String(p.name).slice(0, 80);
  const firstUser = visibleTurns(p.planChatHistory).find((m) => m.role === 'user');
  const said = turnText(firstUser).trim();
  if (said) return said.slice(0, 80);
  return String(p.name || 'שיחה חדשה').slice(0, 80);
}

// Clamped to the range a Date can hold. /api/data stores {...incoming}
// unfiltered, so `touched` is whatever a signed-in browser last sent — and a
// number outside ±8.64e15 makes new Date(n).toISOString() throw RangeError,
// which on the client took out the whole card AND every keystroke in its
// search box. One user could have switched this screen off permanently.
function threadTime(p) {
  const inRange = (n) => (Number.isFinite(n) && n > 0 && n <= 8.64e15 ? n : 0);
  const touched = inRange(Number(p.touched));
  const created = p.created ? inRange(Date.parse(String(p.created).split('T')[0])) : 0;
  return Math.max(touched, created);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
  if (!env.SJ_DATA) {
    return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  }

  const url = new URL(request.url);
  const target = (url.searchParams.get('user') || '').trim().toLowerCase();
  const id = (url.searchParams.get('id') || '').trim();

  // ---- One thread, in full ------------------------------------------------
  // Both parameters are required together: a user without an id would return
  // everything that person has ever written, which is exactly the request this
  // endpoint is careful not to serve.
  if (target || id) {
    if (!target || !id) {
      return jsonResponse({ error: { message: 'צריך גם משתמש וגם מזהה שיחה.' } }, 400);
    }
    // A KV key is capped at 512 bytes; past that the get below throws rather
    // than missing, and nothing here would catch it.
    if (target.length > 254 || id.length > 254) {
      return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400);
    }
    const raw = await env.SJ_DATA.get(USER_PREFIX + target, { cacheTtl: 300 });
    const db = raw ? safeParse(raw) : null;
    const proj = (db && Array.isArray(db.projects) ? db.projects : []).find((p) => p && p.id === id);
    if (!proj) return jsonResponse({ error: { message: 'השיחה לא נמצאה.' } }, 404);

    const messages = visibleTurns(proj.planChatHistory).map((m) => ({
      role: m.role === 'user' ? 'user' : 'ai',
      text: turnText(m),
    })).filter((m) => m.text);

    return jsonResponse({
      ok: true,
      email: target,
      id,
      title: threadTitle(proj),
      kind: proj.kind === 'ask' ? 'ask' : 'job',
      status: proj.status || null,
      when: threadTime(proj),
      messages,
    });
  }

  // ---- The feed -----------------------------------------------------------
  const threads = [];
  let scanned = 0;
  let failed = 0;
  let cursor;
  let truncated = false;
  let usersTruncated = false;
  do {
    const res = await env.SJ_DATA.list({ prefix: USER_PREFIX, cursor, limit: 1000 });
    cursor = res.list_complete ? null : res.cursor;
    for (const k of res.keys) {
      if (scanned >= MAX_USERS) { usersTruncated = true; break; }
      scanned += 1;
      const email = k.name.slice(USER_PREFIX.length);
      // A feed missing three users is worth far more than a 500. Without this,
      // one failed read discards every read already paid for, the operator sees
      // "loading failed", and the natural response is to press refresh — which
      // spends the whole budget again.
      let db = null;
      try { db = safeParse(await env.SJ_DATA.get(k.name, { cacheTtl: 300 })); }
      catch { failed += 1; continue; }
      const projects = db && Array.isArray(db.projects) ? db.projects : [];
      for (const p of projects) {
        if (!p) continue;
        const turns = visibleTurns(p.planChatHistory);
        // Every job opens with a model greeting that is NOT marked hidden
        // (sale/app.js), so `turns.length` is 1 before anybody has typed a word
        // — and the feed filled with jobs whose only content was a title the
        // app generated from a customer's name. The test is whether a PERSON
        // said something.
        if (!turns.some((m) => m.role === 'user')) continue;
        const lastUser = [...turns].reverse().find((m) => m.role === 'user');
        const lastAi = [...turns].reverse().find((m) => m.role !== 'user');
        threads.push({
          email,
          id: p.id,
          title: threadTitle(p),
          kind: p.kind === 'ask' ? 'ask' : 'job',
          status: p.status || null,
          when: threadTime(p),
          messages: turns.length,
          asked: turnText(lastUser).slice(0, PREVIEW),
          answered: turnText(lastAi).slice(0, PREVIEW),
        });
      }
    }
  } while (cursor && scanned < MAX_USERS);

  threads.sort((a, b) => b.when - a.when);
  if (threads.length > MAX_THREADS) truncated = true;

  // Two different truncations, reported separately because they mean opposite
  // things. `truncated` = more threads than fit, and the newest ARE shown.
  // `usersTruncated` = the scan stopped early, and KV lists keys alphabetically
  // by email — so what is missing is not the oldest, it is whoever sorts after
  // the cut. Saying "showing the most recent" there would be a claim the scan
  // never established.
  return jsonResponse({
    ok: true,
    users: scanned,
    failed,
    total: threads.length,
    truncated,
    usersTruncated,
    threads: threads.slice(0, MAX_THREADS),
  });
}
