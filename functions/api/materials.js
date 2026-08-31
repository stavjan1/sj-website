// Cloudflare Pages Function — GET /api/materials
//
// Read-only lookup over the supplier materials database (ERCO / ארכה). Two
// consumers: the quote app's catalog UI (search a real price instead of typing
// one from memory) and any agent that wants a ready-made DATA block.
//
// The heavy lifting — loading, normalizing, scoring — lives in ./_materials.js
// so the chat endpoint and this endpoint can never drift apart on how a price
// is matched or how its basis (retail, before VAT) is stated.
//
//   /api/materials?q=כבל 5x6          → matching items
//   /api/materials?q=...&format=block → the Hebrew DATA block for a prompt
//   /api/materials?sku=5951020        → one exact item
//   /api/materials?cat=כבלי חשמל      → browse a category
//   /api/materials?taxonomy=1         → categories + price statistics
//   /api/materials?meta=1             → freshness / size / basis only

import {
  loadMaterials, searchMaterials, categoryStats, renderMaterialsBlock,
  norm, MAX_LIMIT,
} from './_materials.js';
import { rateLimit } from './_tiers.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (method !== 'GET') return json({ error: { message: 'מתודה לא נתמכת.' } }, 405);

  // This endpoint is unauthenticated and does real CPU work per call. The cap
  // is far above any human use of the catalog UI and only bites scrapers.
  if (!(await rateLimit(env, request, 'materials', 60))) {
    return json({ error: { message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' } }, 429);
  }

  const url = new URL(request.url);
  const p = url.searchParams;
  const db = await loadMaterials(request);

  if (!db.items.length) {
    return json({ items: [], count: 0, meta: null,
      error: { message: 'מאגר החומרים עדיין לא נטען בשרת.' } }, 503);
  }

  if (p.get('meta')) return json({ meta: db.meta, categories: db.cats.length });

  if (p.get('taxonomy')) {
    const agg = new Map();
    for (const it of db.items) {
      if (!it.cat) continue;
      let a = agg.get(it.cat);
      if (!a) { a = []; agg.set(it.cat, a); }
      a.push(it.price);
    }
    const rows = [...agg.entries()].map(([cat, prices]) => {
      prices.sort((x, y) => x - y);
      return {
        cat,
        count: prices.length,
        min: prices[0],
        median: prices[Math.floor(prices.length / 2)],
        max: prices[prices.length - 1],
      };
    }).sort((a, b) => b.count - a.count);
    return json({ meta: db.meta, categories: rows });
  }

  const limit = clamp(parseInt(p.get('limit') || '40', 10), 1, MAX_LIMIT);

  const sku = (p.get('sku') || '').trim();
  if (sku) {
    const want = norm(sku);
    const hit = db.items.find((it) => it.skuNorm === want);
    return json({ meta: db.meta, items: hit ? [strip(hit)] : [], count: hit ? 1 : 0 });
  }

  const cat = (p.get('cat') || '').trim();
  if (cat) {
    const want = norm(cat);
    const rows = db.items.filter((it) => norm(it.cat).includes(want)).slice(0, limit);
    return json({ meta: db.meta, items: rows.map(strip), count: rows.length });
  }

  const q = (p.get('q') || '').trim().slice(0, 400);
  if (!q) return json({ error: { message: 'חסר פרמטר חיפוש (q).' } }, 400);

  const hits = searchMaterials(db, q, limit);

  if (p.get('format') === 'block') {
    const block = renderMaterialsBlock(db, hits, categoryStats(db, q));
    return new Response(block, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors(), ...cache() },
    });
  }

  return json({ meta: db.meta, items: hits.map(strip), count: hits.length });
}

// The hydrated rows carry search scratch fields (`hay`, `skuNorm`) that would
// double the response size and mean nothing to a caller.
function strip(it) {
  return {
    sku: it.sku, name: it.name, price: it.price,
    unit: it.unit, cat: it.cat, attrs: it.attrs,
  };
}

function clamp(n, lo, hi) {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Prices move slowly; a 10-minute edge cache makes repeat lookups free.
function cache() {
  return { 'Cache-Control': 'public, max-age=600' };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(), ...cache() },
  });
}
