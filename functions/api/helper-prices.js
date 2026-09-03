// Cloudflare Pages Function — /api/helper-prices
//
// The "עוזר" screen: a handful of electricians Stav trusts write down what
// THEY charge for the common jobs, so the site's numbers rest on more than
// one man's memory and a WhatsApp group.
//
// Two rules shape the whole thing, both Stav's (2.9.2026):
//
//   1. "לא מאגר חומרים" — helpers price WORK (נקודה, חציבה, לוח), never
//      materials. They are electricians, not suppliers.
//
//   2. Helpers may see what other helpers wrote — but only AFTER they have
//      written their own number for that job. Shown before, the first price on
//      the screen becomes everybody's price and the independent signal that
//      makes several opinions worth more than one is gone. Shown after, it is
//      a reward for contributing and a reason to come back. Enforced HERE, not
//      in the client: `others` is only filled for items the caller has priced.
//
// Who is a helper: the admin, or any account with a `helper:<email>` key in
// KV. Nothing is trusted from the request body about identity — the Google
// token decides, same as every other gate in this folder.
//
//   GET  /api/helper-prices            (helper)  → { items, mine, others }
//   POST /api/helper-prices            (helper)  { itemId, price, note? } | { add: { name, unit } }
//   GET  /api/helper-prices?admin=1    (admin)   → { helpers, items, prices }
//   PUT  /api/helper-prices            (admin)   { email, on }

import {
  ADMIN_EMAIL, adminGate, requireUser, jsonResponse, rateLimit,
} from './_tiers.js';
import { MSG, safeParse } from './_http.js';
import { SJ_ITEMS, SJ_GROUPS } from './_sj_catalog.js';

const HELPER_PREFIX = 'helper:';
const ITEMS_KEY = 'hp:items';
const USER_PREFIX = 'hp:user:';
const MAX_ITEMS = 400;
const MAX_PRICE = 500000;

// The first list a helper sees. Spoken names, not catalogue names, and units
// the trade actually quotes in. Helpers add to it; the admin prunes it.
export const SEED_ITEMS = [
  { id: 'point-light',      name: 'נקודת מאור חדשה',                       unit: "נק'" },
  { id: 'point-socket',     name: 'נקודת בית תקע חדשה',                    unit: "נק'" },
  { id: 'point-move',       name: "העתקת נקודה עד 2 מ' כולל חציבה ותיקון",  unit: "נק'" },
  { id: 'chase-block',      name: 'חציבה בבלוק',                           unit: "מ'" },
  { id: 'chase-concrete',   name: 'חציבה בבטון',                           unit: "מ'" },
  { id: 'point-ac',         name: 'נקודת מזגן',                            unit: "נק'" },
  { id: 'point-boiler',     name: 'נקודת דוד חשמלי',                       unit: "נק'" },
  { id: 'panel-1ph',        name: 'החלפת לוח חד-פאזי (בלי הארקה)',          unit: "קומפ'" },
  { id: 'panel-3ph',        name: 'החלפת לוח תלת-פאזי (בלי הארקה)',         unit: "קומפ'" },
  { id: 'ev-charger',       name: 'עמדת טעינה לרכב — עבודה ותשתית קלה',     unit: "קומפ'" },
  { id: 'inspector',        name: 'בודק (תשלום לבודק, שורה נפרדת)',         unit: "קומפ'" },
  { id: 'fixture-existing', name: 'הרכבת גוף תאורה על נקודה קיימת',         unit: "יח'" },
  { id: 'spot-gypsum',      name: 'ספוט בגבס מנקודה קיימת',                 unit: "יח'" },
  { id: 'swap-accessory',   name: 'החלפת שקע או מפסק',                     unit: "יח'" },
  { id: 'hour-certified',   name: 'שעת עבודה חשמלאי מוסמך',                unit: 'שעה' },
  { id: 'hour-assistant',   name: 'שעת עבודה עוזר',                        unit: 'שעה' },
];

// Turn a free-text item name into a stable id: lowercase, spaces → dashes,
// Hebrew kept as-is (KV keys are UTF-8), everything else dropped.
export function slugify(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/["'״׳()]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Median plus the two ends. Deliberately not the mean: one helper typing an
// extra zero should not move what the others see.
export function summarize(nums) {
  const a = nums.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  const median = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  return { n: a.length, low: a[0], high: a[a.length - 1], median: Math.round(median) };
}

// The reveal rule as a pure function, so it can be tested without KV.
// `all` is { email → { itemId → { price } } }; `me` is the caller's email.
export function othersFor(all, me, mine) {
  const out = {};
  const myEmail = String(me || '').toLowerCase();
  for (const itemId of Object.keys(mine || {})) {
    const nums = [];
    for (const [email, prices] of Object.entries(all || {})) {
      if (email.toLowerCase() === myEmail) continue;
      const p = prices && prices[itemId];
      if (p && Number.isFinite(Number(p.price))) nums.push(Number(p.price));
    }
    const s = summarize(nums);
    if (s) out[itemId] = s;
  }
  return out;
}

async function isHelper(env, email) {
  if (!email) return false;
  if (email.toLowerCase() === ADMIN_EMAIL) return true;
  if (!env.SJ_DATA) return false;
  try { return (await env.SJ_DATA.get(HELPER_PREFIX + email.toLowerCase())) === '1'; } catch { return false; }
}

// Same two answers as adminGate, for the same reason: 401 is "sign in again"
// and the client fixes it silently; 403 is "not you".
async function helperGate(request, env) {
  const who = await requireUser(request, { error: { message: MSG.AUTH_EXPIRED, code: 'auth-expired' } });
  if (who instanceof Response) return { ok: false, response: who };
  if (!(await isHelper(env, who.email))) return { ok: false, response: jsonResponse({ error: { message: 'המסך הזה פתוח רק לעוזרים.' } }, 403) };
  return { ok: true, email: who.email.toLowerCase() };
}

// The list a helper prices: SJ's own catalogue of work items (683 rows, each
// with our price as the reference — Stav, 4.9.2026: "תכניס הכל לאתר"), and
// after it whatever the helpers added themselves (KV). Ids never collide:
// catalogue ids are Dekel-style codes, added items are Hebrew slugs.
async function loadItems(env) {
  const custom = await loadCustomItems(env);
  return SJ_ITEMS.concat(custom);
}
async function loadCustomItems(env) {
  if (!env.SJ_DATA) return [];
  const raw = await env.SJ_DATA.get(ITEMS_KEY);
  const list = raw ? safeParse(raw, null) : null;
  return Array.isArray(list) ? list.filter((it) => it && it.id && !SJ_ITEMS.some((s) => s.id === it.id)) : [];
}

async function loadAllPrices(env) {
  const all = {};
  if (!env.SJ_DATA) return all;
  let cursor;
  do {
    const res = await env.SJ_DATA.list({ prefix: USER_PREFIX, cursor, limit: 1000 });
    cursor = res.list_complete ? null : res.cursor;
    const got = await Promise.all(res.keys.map((k) => env.SJ_DATA.get(k.name).catch(() => null)));
    res.keys.forEach((k, i) => {
      const email = k.name.slice(USER_PREFIX.length);
      all[email] = safeParse(got[i] || '{}', {});
    });
  } while (cursor);
  return all;
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method.toUpperCase();
  if (method === 'GET') return get(context);
  if (method === 'POST') return post(context);
  if (method === 'PUT') return put(context);
  return jsonResponse({ error: { message: 'מתודה לא נתמכת.' } }, 405);
}

async function get({ request, env }) {
  const url = new URL(request.url);

  if (url.searchParams.get('admin')) {
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
    const helpers = [];
    let cursor;
    do {
      const res = await env.SJ_DATA.list({ prefix: HELPER_PREFIX, cursor, limit: 1000 });
      cursor = res.list_complete ? null : res.cursor;
      for (const k of res.keys) helpers.push(k.name.slice(HELPER_PREFIX.length));
    } while (cursor);
    const [items, prices] = await Promise.all([loadItems(env), loadAllPrices(env)]);
    return jsonResponse({ ok: true, helpers, items, groups: SJ_GROUPS, prices });
  }

  const gate = await helperGate(request, env);
  if (!gate.ok) return gate.response;
  const [items, all] = await Promise.all([loadItems(env), loadAllPrices(env)]);
  const mine = all[gate.email] || {};
  return jsonResponse({ ok: true, email: gate.email, items, groups: SJ_GROUPS, mine, others: othersFor(all, gate.email, mine) });
}

async function post({ request, env }) {
  if (!(await rateLimit(env, request, 'helper-prices', 60))) {
    return jsonResponse({ error: { message: MSG.TOO_MANY_SAVES } }, 429);
  }
  const gate = await helperGate(request, env);
  if (!gate.ok) return gate.response;
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }

  // Adding a job to the list. Anyone who can price can add; duplicates by
  // name (after slugging) are folded into the existing row.
  if (body.add) {
    const name = String(body.add.name || '').trim().slice(0, 80);
    const unit = String(body.add.unit || "יח'").trim().slice(0, 12);
    if (name.length < 2) return jsonResponse({ error: { message: 'תן שם לסעיף.' } }, 400);
    const id = slugify(name);
    if (!id) return jsonResponse({ error: { message: 'שם לא תקין.' } }, 400);
    const items = await loadItems(env);
    if (items.length - SJ_ITEMS.length >= MAX_ITEMS) return jsonResponse({ error: { message: 'הרשימה מלאה.' } }, 400);
    let item = items.find((x) => x.id === id);
    if (!item) {
      item = { id, name, unit, by: gate.email, at: new Date().toISOString() };
      items.push(item);
      await env.SJ_DATA.put(ITEMS_KEY, JSON.stringify(items.filter((it) => !SJ_ITEMS.some((x) => x.id === it.id))));
    }
    return jsonResponse({ ok: true, item, items });
  }

  const itemId = String(body.itemId || '').slice(0, 60);
  const price = Math.round(Number(body.price));
  if (!itemId) return jsonResponse({ error: { message: 'חסר סעיף.' } }, 400);
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
    return jsonResponse({ error: { message: 'מחיר לא הגיוני.' } }, 400);
  }
  const items = await loadItems(env);
  if (!items.some((x) => x.id === itemId)) return jsonResponse({ error: { message: 'סעיף לא מוכר.' } }, 400);

  const key = USER_PREFIX + gate.email;
  const mine = safeParse((await env.SJ_DATA.get(key)) || '{}', {});
  mine[itemId] = { price, note: String(body.note || '').slice(0, 200), at: new Date().toISOString() };
  await env.SJ_DATA.put(key, JSON.stringify(mine));

  // The reveal, now that this item has the caller's own number on it.
  const all = await loadAllPrices(env);
  all[gate.email] = mine;
  const others = othersFor(all, gate.email, { [itemId]: mine[itemId] });
  return jsonResponse({ ok: true, itemId, mine: mine[itemId], others: others[itemId] || null });
}

async function put({ request, env }) {
  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonResponse({ error: { message: 'כתובת מייל לא תקינה.' } }, 400);
  if (body.on) await env.SJ_DATA.put(HELPER_PREFIX + email, '1');
  else await env.SJ_DATA.delete(HELPER_PREFIX + email);
  return jsonResponse({ ok: true, email, on: !!body.on });
}
