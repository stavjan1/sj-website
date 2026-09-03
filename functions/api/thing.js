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
import { MSG, safeParse } from './_http.js';
import { keyFor } from './_ai.js';

const MAX_BYTES = 900 * 1024;
const MAX_NODES = 2000;
const SNAP_TTL = 60 * 24 * 3600;
const TOMB_KEEP_MS = 90 * 24 * 3600 * 1000;
const TRASH_KEEP_MS = 30 * 24 * 3600 * 1000;   // a bubble waits in the bin this long
const MAX_TRASH = 500;

// Voice notes. KV holds them as raw bytes under thing:<hash>:rec:<id>. Not the
// textbook store for audio — R2 is — but a person's notebook of one-minute
// notes at ~32 kbit/s is a few hundred kilobytes each, KV values go to 25 MB,
// and this needs no dashboard step. If the notes ever outgrow it, the blob
// key is the only thing that moves.
const REC_MAX_BYTES = 4 * 1024 * 1024;   // ~15 minutes of opus
const REC_MAX_PER_NODE = 10;
const MAX_PAGES = 60;
// Anchored on both ends: the header is the caller's, and a value like
// "image/png, text/html" would pass a prefix match, be stored, and come back as
// the served Content-Type — which a browser reads as HTML on our origin.
const REC_MIMES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|m4a|x-m4a)$/;

// Pictures. The page shrinks them to ~1280px JPEG before sending, so a photo
// from the phone is a few hundred kilobytes; the cap is a guard, not a budget.
const IMG_MAX_BYTES = 2 * 1024 * 1024;
const IMG_MAX_PER_NODE = 6;
const IMG_MIMES = /^image\/(jpeg|png|webp)$/;

// A blob leaves as bytes of the type we validated, never as a document: the
// Content-Type is re-checked against the allow-list on the way out, sniffing is
// off, and a sandboxing CSP makes anything that still looked like HTML inert.
function blobResponse(bytes, mime, allow, fallback) {
  const m = allow.test(String(mime || '')) ? String(mime) : fallback;
  return new Response(bytes, { status: 200, headers: {
    'Content-Type': m, 'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } });
}

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
  // Tabs: each a blank page. A bubble names its page in `p`; '' is no page.
  const pages = (Array.isArray(t.pages) ? t.pages : []).slice(0, MAX_PAGES).map((p) => ({
    id: String(p.id || '').slice(0, 24), name: String(p.name || '').slice(0, 40), u: Number(p.u) || 0, x: !!p.x,
  })).filter((p) => p.id);
  const pageIds = new Set(pages.map((p) => p.id));
  const nodes = (Array.isArray(t.nodes) ? t.nodes : []).slice(0, MAX_NODES).map((n) => ({
    id: String(n.id || '').slice(0, 24),
    t: String(n.t || '').slice(0, 120),
    b: String(n.b || '').slice(0, 4000),
    x: Number.isFinite(Number(n.x)) ? Math.round(Number(n.x)) : 0,
    y: Number.isFinite(Number(n.y)) ? Math.round(Number(n.y)) : 0,
    u: Number(n.u) || 0,
    c: Math.min(7, Math.max(0, Math.round(Number(n.c)) || 0)),
    p: pageIds.has(String(n.p || '')) ? String(n.p) : '',
    recs: (Array.isArray(n.recs) ? n.recs : []).slice(0, REC_MAX_PER_NODE).map((r) => ({
      id: String(r.id || '').slice(0, 24),
      m: String(r.m || '').slice(0, 40),
      n: Math.max(0, Math.round(Number(r.n)) || 0),
      d: Math.max(0, Math.round(Number(r.d)) || 0),
      tx: String(r.tx || '').slice(0, 4000),
      at: Number(r.at) || 0,
    })).filter((r) => r.id),
    imgs: (Array.isArray(n.imgs) ? n.imgs : []).slice(0, IMG_MAX_PER_NODE).map((g) => ({
      id: String(g.id || '').slice(0, 24), m: String(g.m || '').slice(0, 40),
      n: Math.max(0, Math.round(Number(g.n)) || 0), w: Math.round(Number(g.w)) || 0, h: Math.round(Number(g.h)) || 0, at: Number(g.at) || 0,
    })).filter((g) => g.id),
  })).filter((n) => n.id);
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const edges = (Array.isArray(t.edges) ? t.edges : []).map((e) => ({
    a: String(e.a || '').slice(0, 24), b: String(e.b || '').slice(0, 24), u: Number(e.u) || 0,
    k: e.k === 'x' ? 'x' : 'in',   // 'in' assigns the far bubble to this page; 'x' only connects
  })).filter((e) => e.a && e.b && e.a !== e.b && ids.has(e.a) && ids.has(e.b))
    .filter((e) => { const k = edgeKey(e); if (seen.has(k)) return false; seen.add(k); return true; });
  // The bin: the whole bubble, plus the lines it had, so a restore brings
  // back what was there and not a bare title. Entries older than 30 days go.
  const tcut = Date.now() - TRASH_KEEP_MS;
  const trash = (Array.isArray(t.trash) ? t.trash : []).slice(0, MAX_TRASH).map((x) => ({
    id: String(x.id || '').slice(0, 24),
    t: String(x.t || '').slice(0, 120), b: String(x.b || '').slice(0, 4000),
    x: Math.round(Number(x.x)) || 0, y: Math.round(Number(x.y)) || 0,
    u: Number(x.u) || 0, c: Math.min(7, Math.max(0, Math.round(Number(x.c)) || 0)),
    p: String(x.p || '').slice(0, 24),
    recs: (Array.isArray(x.recs) ? x.recs : []).slice(0, REC_MAX_PER_NODE).map((r) => ({ id: String(r.id || '').slice(0, 24), m: String(r.m || '').slice(0, 40), n: Number(r.n) || 0, d: Number(r.d) || 0, tx: String(r.tx || '').slice(0, 4000), at: Number(r.at) || 0 })).filter((r) => r.id),
    imgs: (Array.isArray(x.imgs) ? x.imgs : []).slice(0, IMG_MAX_PER_NODE).map((g) => ({ id: String(g.id || '').slice(0, 24), m: String(g.m || '').slice(0, 40), n: Number(g.n) || 0, w: Number(g.w) || 0, h: Number(g.h) || 0, at: Number(g.at) || 0 })).filter((g) => g.id),
    edges: (Array.isArray(x.edges) ? x.edges : []).slice(0, 200).map((e) => ({ a: String(e.a || '').slice(0, 24), b: String(e.b || '').slice(0, 24), k: e.k === 'x' ? 'x' : 'in' })).filter((e) => e.a && e.b),
    dAt: Number(x.dAt) || 0,
  })).filter((x) => x.id && x.dAt > tcut && !ids.has(x.id));
  // The legend as Stav renamed it: one entry per colour he touched.
  const legend = (Array.isArray(t.legend) ? t.legend : []).slice(0, 8).map((l) => ({
    c: Math.min(7, Math.max(0, Math.round(Number(l.c)) || 0)),
    name: String(l.name || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    u: Number(l.u) || 0,
  })).filter((l) => l.name);
  const cutoff = Date.now() - TOMB_KEEP_MS;
  const del = (Array.isArray(t.del) ? t.del : []).map((d) => ({ id: String(d.id || '').slice(0, 60), at: Number(d.at) || 0 }))
    .filter((d) => d.id && d.at > cutoff);
  return { nodes, edges, del, pages, trash, legend, updatedAt: Number(t.updatedAt) || Date.now() };
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
  const pages = new Map();
  for (const p of [...A.pages, ...B.pages]) {
    const dead = tomb.get('page:' + p.id);
    if (dead && dead >= p.u) continue;
    const cur = pages.get(p.id);
    if (!cur || p.u > cur.u) pages.set(p.id, p);
  }
  // A bubble whose page is gone is not gone: it is page-less.
  const alive = [...nodes.values()].map((n) => (n.p && !pages.has(n.p)) ? { ...n, p: '' } : n);
  const trash = new Map();
  for (const x of [...A.trash, ...B.trash]) {
    if (nodes.has(x.id)) continue;                      // it lives again somewhere — not in the bin
    const cur = trash.get(x.id);
    if (!cur || x.dAt > cur.dAt) trash.set(x.id, x);
  }
  const legend = new Map();
  for (const l of [...A.legend, ...B.legend]) { const cur = legend.get(l.c); if (!cur || l.u > cur.u) legend.set(l.c, l); }
  return {
    legend: [...legend.values()],
    trash: [...trash.values()],
    nodes: alive,
    edges: [...edges.values()],
    del: [...tomb].map(([id, at]) => ({ id, at })),
    pages: [...pages.values()],
    updatedAt: Math.max(A.updatedAt, B.updatedAt),
  };
}

function keyFrom(request) {
  const url = new URL(request.url);
  return url.searchParams.get('k') || '';
}

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// Every Gemini call this file makes, in one place. Deliberately NOT routed
// through _ai.js: these are one-shot utility calls (a title, a transcript, a
// colour per bubble) with their own model and their own request shape —
// one user part made of the instruction and the text joined, an optional
// inline blob after it, no systemInstruction. `maxTokens` caps the answer and
// switches thinking off with it: Gemini 2.5 spends "thinking" tokens out of the
// same budget as the answer, and with a 40-token cap the thought ate the title
// and two letters came back. `json` asks for JSON response mode. The answer is
// the first candidate's text; '' when the key is missing, the call fails or
// the answer is empty — which every caller already treats as "next engine".
async function askGemini(env, { system, user, inline, temperature, maxTokens, json }) {
  const key = keyFor(env, 'gemini');
  if (!key) return '';
  const parts = [{ text: system ? system + '\n\n' + user : user }];
  if (inline) parts.push({ inline_data: inline });
  const generationConfig = { temperature };
  if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
  if (json) generationConfig.responseMimeType = 'application/json';
  if (maxTokens) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
      .map((p) => p.text || '').join('');
  } catch { return ''; }
}

// Hebrew speech → text. Workers AI's Whisper first (free, bound already, takes
// the browser's webm/opus as-is); Gemini as the fallback when the binding is
// missing, with the same audio inline. Either way an empty string is a valid
// answer — a note with no transcript is still a note.
export async function transcribe(env, bytes, mime) {
  if (env.AI) {
    try {
      const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: b64(bytes), language: 'he' });
      const text = out && (out.text || (out.result && out.result.text));
      if (typeof text === 'string') return text.trim();
    } catch { /* fall through to Gemini */ }
  }
  const text = await askGemini(env, {
    user: 'תמלל את ההקלטה הזו מילה במילה בעברית. החזר רק את התמלול, בלי הקדמה ובלי הערות.',
    inline: { mime_type: mime.split(';')[0], data: b64(bytes) },
    temperature: 0,
  });
  return text.trim();
}

// A title for a bubble that has none, from what it says. Stav, 2.9.2026:
// "אפשר שהכותרת תיווצר לבד מהקונספט של הפתק?" — it can, and it is the same
// engines as the transcript. Gemini first (good Hebrew), Workers AI's Llama
// second, and if both are away the first few words of the text, so the
// bubble is never left blank.
const TITLE_PROMPT = 'תן כותרת קצרה בעברית, 3 עד 6 מילים, שמסכמת את הרעיון המרכזי של הטקסט הבא. החזר רק את הכותרת, בלי מירכאות, בלי נקודה בסוף, בלי הסבר.';

export function fallbackTitle(text) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return words.slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '').slice(0, 60);
}

export function cleanTitle(t) {
  return String(t || '').split('\n')[0].replace(/^["'״׳\s]+|["'״׳\s.]+$/g, '').replace(/\s+/g, ' ').slice(0, 80);
}

// "הצ" is not a title. A model cut off mid-word hands back a fragment that
// passes every string check; the only tell is that it is too short to be a
// title of three to six words. Below this, fall through to the next engine.
export function plausibleTitle(t) {
  const s = String(t || '').trim();
  return s.length >= 6 && /\s/.test(s);
}

export async function suggestTitle(env, text) {
  const body = String(text || '').slice(0, 6000);
  if (body.trim().length < 3) return '';
  const t = cleanTitle(await askGemini(env, { system: TITLE_PROMPT, user: body, temperature: 0.2, maxTokens: 96 }));
  if (plausibleTitle(t)) return t;
  if (env.AI) {
    try {
      const out = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'system', content: TITLE_PROMPT }, { role: 'user', content: body }], max_tokens: 40, temperature: 0.2,
      });
      const t = cleanTitle(out && (out.response || (out.result && out.result.response)));
      if (plausibleTitle(t)) return t;
    } catch { /* fall through */ }
  }
  return fallbackTitle(body);
}

// "כפתור שלחיצה עליו צובעת את כל הפתקים, כל אחד בצבע שמתאים לו." Every
// bubble's words go up with the legend as Stav named it, and one answer
// comes back: a colour per bubble. Gemini in JSON mode, no thinking, cold;
// Llama as the fallback; on failure nothing is painted — never a guess.
const PAINT_PROMPT = 'לפניך מקרא של קטגוריות (מספר צבע, שם, הסבר) ורשימת פתקים (מזהה, טקסט). לכל פתק בחר את הקטגוריה המתאימה ביותר לפי תוכנו. החזר JSON בלבד: מערך של אובייקטים {"id": "...", "c": מספר} — מזהה אחד לכל פתק, בלי הסברים.';

export async function classifyBubbles(env, items, legend) {
  const list = (Array.isArray(items) ? items : []).slice(0, 150).map((it) => ({ id: String(it.id || '').slice(0, 24), text: String(it.text || '').slice(0, 600) })).filter((it) => it.id && it.text.trim());
  const leg = (Array.isArray(legend) ? legend : []).slice(0, 8).map((l) => ({ c: Math.min(7, Math.max(0, Math.round(Number(l.c)) || 0)), name: String(l.name || '').slice(0, 30), hint: String(l.hint || '').slice(0, 80) }));
  if (!list.length || !leg.length) return [];
  const allowed = new Set(leg.map((l) => l.c));
  const body = 'מקרא:\n' + leg.map((l) => `${l.c} = ${l.name}${l.hint ? ' (' + l.hint + ')' : ''}`).join('\n') + '\n\nפתקים:\n' + list.map((it) => `[${it.id}] ${it.text.replace(/\s+/g, ' ')}`).join('\n');
  const parse = (txt) => {
    try {
      const m = String(txt || '').match(/\[[\s\S]*\]/); const arr = JSON.parse(m ? m[0] : txt);
      const ids = new Set(list.map((it) => it.id));
      return (Array.isArray(arr) ? arr : []).map((r) => ({ id: String(r.id || ''), c: Math.round(Number(r.c)) })).filter((r) => ids.has(r.id) && allowed.has(r.c));
    } catch { return []; }
  };
  const painted = parse(await askGemini(env, { system: PAINT_PROMPT, user: body, temperature: 0.1, maxTokens: 4096, json: true }));
  if (painted.length) return painted;
  if (env.AI) {
    try {
      const out = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'system', content: PAINT_PROMPT }, { role: 'user', content: body }], max_tokens: 4096, temperature: 0.1 });
      const parsed = parse(out && (out.response || (out.result && out.result.response)));
      if (parsed.length) return parsed;
    } catch { /* fall through */ }
  }
  return [];
}

async function postPaint(context) {
  let payload;
  try { payload = await context.request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const colors = await classifyBubbles(context.env, payload && payload.items, payload && payload.legend);
  if (!colors.length) return jsonResponse({ error: { message: 'המנוע לא החזיר צבעים — נסה שוב עוד רגע.' } }, 502);
  return jsonResponse({ ok: true, colors });
}

async function postTitle(context, name) {
  const { request, env } = context;
  const url = new URL(request.url);
  const nodeId = String(url.searchParams.get('node') || '').slice(0, 24);
  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const title = await suggestTitle(env, payload && payload.text);
  if (!title) return jsonResponse({ error: { message: 'אין מספיק טקסט לכותרת.' } }, 400);
  // Written into the stored bubble too, so the other device sees it on its
  // next merge and not only the one that asked.
  if (nodeId) await patchNode(env, name, nodeId, (n) => { n.t = title; });
  return jsonResponse({ ok: true, title });
}

async function loadTree(env, name) {
  const raw = await env.SJ_DATA.get(name);
  return raw ? cleanTree(safeParse(raw)) : null;
}

// Attach a recording to one bubble in the stored tree, as a per-bubble change
// (bumps that bubble's `u`), so the next merge from any device carries it.
async function patchNode(env, name, nodeId, fn) {
  const tree = (await loadTree(env, name)) || cleanTree({});
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  fn(node);
  node.u = Date.now();
  tree.updatedAt = node.u;
  await env.SJ_DATA.put(name, JSON.stringify(cleanTree(tree)));
  return node;
}

async function postRecording(context, k, name) {
  const { request, env } = context;
  const url = new URL(request.url);
  const nodeId = String(url.searchParams.get('node') || '').slice(0, 24);
  const dur = Math.max(0, Math.round(Number(url.searchParams.get('dur')) || 0));
  const mime = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!nodeId) return jsonResponse({ error: { message: 'חסרה תובנה.' } }, 400);
  if (!REC_MIMES.test(mime)) return jsonResponse({ error: { message: 'סוג הקלטה לא נתמך.' } }, 415);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonResponse({ error: { message: 'ההקלטה ריקה.' } }, 400);
  if (bytes.byteLength > REC_MAX_BYTES) return jsonResponse({ error: { message: 'ההקלטה ארוכה מדי (עד כ-15 דקות).' } }, 413);
  const tree = await loadTree(env, name);
  const node = tree && tree.nodes.find((n) => n.id === nodeId);
  if (!node) return jsonResponse({ error: { message: 'התובנה עוד לא נשמרה בענן — נסה שוב עוד רגע.' } }, 409);
  if (node.recs.length >= REC_MAX_PER_NODE) return jsonResponse({ error: { message: 'עד 10 הקלטות לתובנה.' } }, 400);

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await env.SJ_DATA.put(`${name}:rec:${id}`, bytes, { metadata: { m: mime, n: bytes.byteLength } });
  const tx = await transcribe(env, bytes, mime);
  const rec = { id, m: mime.slice(0, 40), n: bytes.byteLength, d: dur, tx, at: Date.now() };
  await patchNode(env, name, nodeId, (n) => { n.recs = [...(n.recs || []), rec]; });
  return jsonResponse({ ok: true, rec });
}

async function postImage(context, k, name) {
  const { request, env } = context;
  const url = new URL(request.url);
  const nodeId = String(url.searchParams.get('node') || '').slice(0, 24);
  const w = Math.round(Number(url.searchParams.get('w')) || 0), h = Math.round(Number(url.searchParams.get('h')) || 0);
  const mime = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!nodeId) return jsonResponse({ error: { message: 'חסרה תובנה.' } }, 400);
  if (!IMG_MIMES.test(mime)) return jsonResponse({ error: { message: 'סוג תמונה לא נתמך.' } }, 415);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonResponse({ error: { message: 'התמונה ריקה.' } }, 400);
  if (bytes.byteLength > IMG_MAX_BYTES) return jsonResponse({ error: { message: 'התמונה גדולה מדי.' } }, 413);
  const tree = await loadTree(env, name);
  const node = tree && tree.nodes.find((n) => n.id === nodeId);
  if (!node) return jsonResponse({ error: { message: 'התובנה עוד לא נשמרה בענן — נסה שוב עוד רגע.' } }, 409);
  if ((node.imgs || []).length >= IMG_MAX_PER_NODE) return jsonResponse({ error: { message: 'עד 6 תמונות לתובנה.' } }, 400);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await env.SJ_DATA.put(`${name}:img:${id}`, bytes, { metadata: { m: mime, n: bytes.byteLength } });
  const img = { id, m: mime.slice(0, 40), n: bytes.byteLength, w, h, at: Date.now() };
  await patchNode(env, name, nodeId, (n) => { n.imgs = [...(n.imgs || []), img]; });
  return jsonResponse({ ok: true, img });
}

async function getImage(env, name, id) {
  const got = await env.SJ_DATA.getWithMetadata(`${name}:img:${id}`, 'arrayBuffer');
  if (!got || !got.value) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  return blobResponse(got.value, got.metadata && got.metadata.m, IMG_MIMES, 'image/jpeg');
}

async function deleteImage(context, name) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = String(url.searchParams.get('img') || '').slice(0, 24);
  const nodeId = String(url.searchParams.get('node') || '').slice(0, 24);
  if (!id || !nodeId) return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400);
  await env.SJ_DATA.delete(`${name}:img:${id}`);
  await patchNode(env, name, nodeId, (n) => { n.imgs = (n.imgs || []).filter((g) => g.id !== id); });
  return jsonResponse({ ok: true });
}

async function getRecording(env, name, id) {
  const got = await env.SJ_DATA.getWithMetadata(`${name}:rec:${id}`, 'arrayBuffer');
  if (!got || !got.value) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  return blobResponse(got.value, got.metadata && got.metadata.m, REC_MIMES, 'audio/webm');
}

async function deleteRecording(context, name) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = String(url.searchParams.get('rec') || '').slice(0, 24);
  const nodeId = String(url.searchParams.get('node') || '').slice(0, 24);
  if (!id || !nodeId) return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400);
  await env.SJ_DATA.delete(`${name}:rec:${id}`);
  await patchNode(env, name, nodeId, (n) => { n.recs = (n.recs || []).filter((r) => r.id !== id); });
  return jsonResponse({ ok: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const k = keyFrom(request);
  if (!validKey(k)) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  const rec = new URL(request.url).searchParams.get('rec');
  if (rec) return getRecording(env, 'thing:' + await keyHash(k), String(rec).slice(0, 24));
  const img = new URL(request.url).searchParams.get('img');
  if (img) return getImage(env, 'thing:' + await keyHash(k), String(img).slice(0, 24));
  const raw = await env.SJ_DATA.get('thing:' + await keyHash(k));
  // An unknown key and an empty tree look the same from outside — nothing to probe.
  return jsonResponse({ ok: true, tree: raw ? cleanTree(safeParse(raw)) : null });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const k = keyFrom(request);
  if (!validKey(k)) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  if (!(await rateLimit(env, request, 'thing', 60))) return jsonResponse({ error: { message: MSG.TOO_MANY_SAVES } }, 429);
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const k = keyFrom(request);
  if (!validKey(k)) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  if (!(await rateLimit(env, request, 'thing-rec', 20))) return jsonResponse({ error: { message: 'יותר מדי הקלטות בזמן קצר.' } }, 429);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  if (new URL(request.url).searchParams.get('title')) return postTitle(context, 'thing:' + await keyHash(k));
  if (new URL(request.url).searchParams.get('paint')) return postPaint(context);
  if (new URL(request.url).searchParams.get('img')) return postImage(context, k, 'thing:' + await keyHash(k));
  return postRecording(context, k, 'thing:' + await keyHash(k));
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const k = keyFrom(request);
  if (!validKey(k)) return jsonResponse({ error: { message: 'לא נמצא.' } }, 404);
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'אחסון הענן (KV) עדיין לא הוגדר.' } }, 501);
  if (new URL(request.url).searchParams.get('img')) return deleteImage(context, 'thing:' + await keyHash(k));
  return deleteRecording(context, 'thing:' + await keyHash(k));
}
