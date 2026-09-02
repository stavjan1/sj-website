// Cloudflare Pages Function — /api/thing
//
// The insight tree, reached by its address and nothing else. Stav, 2.9.2026:
// no Google, no hour that lapses, "פשוט בכתובת סודית שאף אחד לא יכול להגיע
// אליה ... אלא רק עם הכתובת". So the address carries a long random key, the
// key is the whole permission, and the server never enumerates anything: it
// answers for the hash of a key it is handed, or it answers 404.
//
// What the key protects against is guessing (30 random bytes; nobody guesses
// that). What it does not protect against is the address itself leaking — a
// bookmark shared, a screen photographed. That is the trade he chose, said
// plainly, and it is why the document holds insights and not passwords.
//
// The fear behind the request was losing insights to a login that expired.
// Two things answer it here, neither of them a login:
//   • the merge is per bubble, not per document — a bubble edited on the phone
//     and another edited on the computer both survive, and a deletion is a
//     tombstone so it cannot be resurrected by a stale copy;
//   • the first write of each day keeps a snapshot for 60 days.
//
//   GET /api/thing?k=<key>          → { ok, tree }        (404 for an unknown key)
//   PUT /api/thing?k=<key>  { tree } → { ok, tree }        (merged result)

import { jsonResponse, rateLimit } from './_tiers.js';

const MAX_BYTES = 900 * 1024;
const MAX_NODES = 2000;
const SNAP_TTL = 60 * 24 * 3600;
const TOMB_KEEP_MS = 90 * 24 * 3600 * 1000;

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// The key never touches KV as itself. Its hash is the record name, so a KV
// listing (admin console, a backup) shows nothing that opens the page.
export async function keyHash(key) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validKey(k) {
  return typeof k === 'string' && k.length >= 32 && k.length <= 64 && /^[A-Za-z0-9_-]+$/.test(k);
}

// Keep only what the page understands, clamped. Every bubble carries `u`, the
// time it last changed, which is what the merge decides by.
export function cleanTree(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const nodes = (Array.isArray(t.nodes) ? t.nodes : []).slice(0, MAX_NODES).map((n) => ({
    id: String(n.id || '').slice(0, 24),
    t: String(n.t || '').slice(0, 120),
    b: String(n.b || '').slice(0, 4000),
    x: Number.isFinite(Number(n.x)) ? Math.round(Number(n.x)) : 0,
    y: Number.isFinite(Number(n.y)) ? Math.round(Number(n.y)) : 0,
    u: Number(n.u) || 0,
    c: Math.min(7, Math.max(0, Math.round(Number(n.c)) || 0)),
  })).filter((n) => n.id);
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const edges = (Array.isArray(t.edges) ? t.edges : []).map((e) => ({
    a: String(e.a || '').slice(0, 24), b: String(e.b || '').slice(0, 24), u: Number(e.u) || 0,
  })).filter((e) => e.a && e.b && e.a !== e.b && ids.has(e.a) && ids.has(e.b))
    .filter((e) => { const k = edgeKey(e); if (seen.has(k)) return false; seen.add(k); return true; });
  const cutoff = Date.now() - TOMB_KEEP_MS;
  const del = (Array.isArray(t.del) ? t.del : []).map((d) => ({ id: String(d.id || '').slice(0, 60), at: Number(d.at) || 0 }))
    .filter((d) => d.id && d.at > cutoff);
  return { nodes, edges, del, updatedAt: Number(t.updatedAt) || Date.now() };
}

function edgeKey(e) { return [e.a, e.b].sort().join('|'); }

// Union by id, newest change wins per bubble; a tombstone beats anything
// older than it. Lines follow the same rule keyed by their two ends
// (tombstone id "a|b"). The result of merging X with itself is X.
export function mergeTrees(a, b) {
  const A = cleanTree(a), B = cleanTree(b);
  const tomb = new Map();
  for (const d of [...A.del, ...B.del]) if (!tomb.has(d.id) || tomb.get(d.id) < d.at) tomb.set(d.id, d.at);

  const nodes = new Map();
  for (const n of [...A.nodes, ...B.nodes]) {
    const dead = tomb.get(n.id);
    if (dead && dead >= n.u) continue;
    const cur = nodes.get(n.id);
    if (!cur || n.u > cur.u) nodes.set(n.id, n);
  }
  const edges = new Map();
  for (const e of [...A.edges, ...B.edges]) {
    if (!nodes.has(e.a) || !nodes.has(e.b)) continue;
    const k = edgeKey(e);
    const dead = tomb.get(k);
    if (dead && dead >= e.u) continue;
    const cur = edges.get(k);
    if (!cur || e.u > cur.u) edges.set(k, e);
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    del: [...tomb].map(([id, at]) => ({ id, at })),
    updatedAt: Math.max(A.updatedAt, B.updatedAt),
  };
}

function keyFrom(request) {
  const url = new URL(request.url);
  return url.searchParams.get('k') || '';
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const k = keyFrom(request);
  if (!validKey(k)) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  const raw = await env.SJ_DATA.get('thing:' + await keyHash(k));
  // An unknown key and an empty tree look the same from outside — nothing to probe.
  return jsonResponse({ ok: true, tree: raw ? cleanTree(safeParse(raw)) : null });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const k = keyFrom(request);
  if (!validKey(k)) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  if (!(await rateLimit(env, request, 'thing', 60))) return jsonResponse({ error: { message: 'יותר מדי שמירות בזמן קצר.' } }, 429);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const incoming = cleanTree(body && body.tree);
  if (JSON.stringify(incoming).length > MAX_BYTES) return jsonResponse({ error: { message: 'העץ גדול מדי לשמירה.' } }, 413);

  const name = 'thing:' + await keyHash(k);
  const raw = await env.SJ_DATA.get(name);
  const current = raw ? safeParse(raw) : null;
  const merged = current ? mergeTrees(current, incoming) : cleanTree(incoming);
  const payload = JSON.stringify(merged);
  await env.SJ_DATA.put(name, payload);

  // One snapshot per day, taken before today's first change could hurt.
  if (current) {
    const day = new Date().toISOString().slice(0, 10);
    const snap = `${name}:snap:${day}`;
    try {
      if (!(await env.SJ_DATA.get(snap))) await env.SJ_DATA.put(snap, raw, { expirationTtl: SNAP_TTL });
    } catch { /* a missed snapshot is not a failed save */ }
  }
  return jsonResponse({ ok: true, tree: merged });
}
