// Cloudflare Pages Function — /api/mind
//
// Stav's insight tree: one document, one owner. Bubbles (title + body) on a
// plane, lines between them. The page at /mind/ keeps a local copy and syncs
// here so the phone and the computer show the same tree.
//
// Admin-only by the verified Google email — the same gate as the admin panel,
// not a "secret" URL: a URL is not a lock and Google finds it.
//
//   GET /api/mind   → { ok, tree }              (tree may be null the first time)
//   PUT /api/mind   { tree } → { ok, tree }     (whole document; newest updatedAt wins)

import { adminGate, jsonResponse } from './_tiers.js';

const KEY = 'mind:tree';
const MAX_BYTES = 900 * 1024;   // KV values cap at 25 MB; a tree of words never needs more than this
const MAX_NODES = 2000;

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Keep only what the page understands, clamped. A bubble is a title, a body
// and a place; a line is two ids. Anything else in the payload is dropped, so
// a stray field can never grow the document past what the page reads.
export function cleanTree(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const nodes = (Array.isArray(t.nodes) ? t.nodes : []).slice(0, MAX_NODES).map((n) => ({
    id: String(n.id || '').slice(0, 24),
    t: String(n.t || '').slice(0, 120),
    b: String(n.b || '').slice(0, 4000),
    x: Number.isFinite(Number(n.x)) ? Math.round(Number(n.x)) : 0,
    y: Number.isFinite(Number(n.y)) ? Math.round(Number(n.y)) : 0,
  })).filter((n) => n.id);
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const edges = (Array.isArray(t.edges) ? t.edges : []).map((e) => ({
    a: String(e.a || '').slice(0, 24), b: String(e.b || '').slice(0, 24),
  })).filter((e) => e.a && e.b && e.a !== e.b && ids.has(e.a) && ids.has(e.b))
    .filter((e) => { const k = [e.a, e.b].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
  const updatedAt = Number(t.updatedAt) || Date.now();
  return { nodes, edges, updatedAt };
}

// Whole-document merge: the newer copy wins. Two devices editing the same
// minute is rare for one person's notebook, and a field-level merge would be
// machinery nobody asked for. The loser is not lost — the page keeps it locally
// until its next save, which will be newer.
export function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (Number(b.updatedAt) || 0) > (Number(a.updatedAt) || 0) ? b : a;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  const raw = await env.SJ_DATA.get(KEY);
  const tree = raw ? safeParse(raw) : null;
  return jsonResponse({ ok: true, tree: tree ? cleanTree(tree) : null });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const incoming = cleanTree(body && body.tree);
  const payload = JSON.stringify(incoming);
  if (payload.length > MAX_BYTES) return jsonResponse({ error: { message: 'העץ גדול מדי לשמירה.' } }, 413);
  const raw = await env.SJ_DATA.get(KEY);
  const current = raw ? cleanTree(safeParse(raw)) : null;
  const winner = newer(current, incoming);
  if (winner === incoming) await env.SJ_DATA.put(KEY, payload);
  return jsonResponse({ ok: true, tree: winner, saved: winner === incoming });
}
