// עץ התובנות — a plane of bubbles and the lines between them.
//
// Stav's spec (2.9.2026): put a box on the screen with a title and a body;
// out in the world the boxes show only their titles, as bubbles sized to the
// title; stretch lines between insights and delete them; walk around.
//
// Tabs (3.9.2026): every tab is a blank page of its own, and "הכל" shows every
// page side by side. A bubble belongs to one page (n.p, '' = none). A line is
// one of two kinds: an ASSIGNING line (e.k === 'in') pulls a page-less bubble
// into the page of the bubble it was drawn from, so a tree begun in a tab can
// be continued from "הכל" and still be that tab's tree; a CROSS line ('x')
// connects without moving anything. In "הכל" each page's bubbles keep their
// own coordinates and the page is shifted as a whole into its slot, so the
// pages never pile on each other and a page's tree looks the same in its tab.
//
// And no login. The address is the key: /thing/#k=<long random key>. The
// first visit keeps the key on the device, so the plain /thing/ opens it from
// then on. Nothing is ever deleted by a failed sync — the tree is in
// localStorage first, and the server merges bubble by bubble (see
// functions/api/thing.js).

const STORAGE_KEY = 'sj_thing_v1';
const KEY_KEY = 'sj_thing_key';
const THEME_KEY = 'sj_thing_theme';
const TAB_KEY = 'sj_thing_tab';
const LINK_KEY = 'sj_thing_link';
const DB_NAME = 'sj_thing', DB_STORE = 'pending';
const POLL_MS = 45000;
const MIN_ZOOM = 0.06, MAX_ZOOM = 3;   // Stav: "שיהיה אפשר לצאת עוד בזום"   // GET only — reads are plentiful, writes are not

// What the eight colours mean. Stav named four (3.9.2026): אמונה מגבילה in a
// light purple, פרקטיקה in green, plain thoughts in the plain colour, things he
// loves in a sunset yellow. The other four follow the same psychology: blue is
// clarity, so it is the insight itself; coral is the alarm colour, so it is the
// fear under a limiting belief; pink is warmth, so people; teal is direction.
const LEGEND = [
    { c: 0, name: 'מחשבה',        hint: 'עוד לא סווגה' },
    { c: 5, name: 'תובנה',        hint: 'הבנה שנפלה — כחול של בהירות' },
    { c: 4, name: 'אמונה מגבילה', hint: 'סיפור שמחזיק אותי — סגול של התבוננות' },
    { c: 2, name: 'פחד',          hint: 'הרגש שמתחת לאמונה — כתום של אזעקה' },
    { c: 7, name: 'פרקטיקה',      hint: 'מה עושים עם זה — ירוק של צמיחה' },
    { c: 1, name: 'אוהב',         hint: 'מה שטוב לי — צהוב של שקיעה' },
    { c: 3, name: 'אנשים',        hint: 'יחסים ומי שסביבי — ורוד של חום' },
    { c: 6, name: 'כיוון',        hint: 'מטרה, לאן — טורקיז של מרחק' },
];
const LEGEND_BY_C = Object.fromEntries(LEGEND.map((l) => [l.c, l]));

// The name a colour goes by here: what Stav wrote for it, or the default.
function legendName(c) {
    const o = (tree.legend || []).find((l) => l.c === c);
    return (o && o.name) || (LEGEND_BY_C[c] || LEGEND[0]).name;
}
let legendEditing = false;

let tree = { nodes: [], edges: [], del: [], pages: [], trash: [], legend: [], updatedAt: 0 };
let view = { x: 0, y: 0, k: 1 };
let tab = 'all';            // 'all' or a page id
let linkKind = 'in';        // the kind of line the knob draws in "הכל"
let selectedId = null;
let selectedEdge = null;
let cloudKey = null;
let saveTimer = null;
let cloudTimer = null;
let offsets = { '': { x: 0, y: 0 } };   // page id → shift applied in "הכל"
let query = '';                          // what is typed in the search field, normalized
let dirty = false;                       // this device changed something the cloud has not seen
let lastServerAt = 0;                    // updatedAt of the last tree the cloud handed us
let pollTimer = null;
let hitIndex = -1;
let picked = new Set();                  // bubbles chosen together — they move together
let localSeq = 0;                        // grows on every local change; a request that started before a change may not overwrite it
const CLIP_KEY = 'sj_thing_clip';        // the copied bubbles live here, so a paste survives a reload
const HISTORY_MAX = 60;
let undoStack = [], redoStack = [];      // snapshots of the tree before each change, and the ones undone
let histKey = null;                      // consecutive keystrokes in one field are one entry
let lastClip = null;                     // the last copy, for a session where localStorage is full
let marqueeMode = false;                 // phone: the 🔲 button turns a drag on the ground into a selection box

const $ = (id) => document.getElementById(id);
const stage = $('stage'), world = $('world'), wires = $('wires'), nodesEl = $('nodes');

// ---------- boot ----------

init();

function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
    tree = normalize(safeParse(localStorage.getItem(STORAGE_KEY)));
    cloudKey = keyFromAddress() || localStorage.getItem(KEY_KEY) || null;
    if (cloudKey) localStorage.setItem(KEY_KEY, cloudKey);
    // The icon added from this page must open connected: the manifest it
    // reads carries the key in start_url (see functions/thing/manifest.webmanifest.js).
    const ml = $('manifest-link'); if (ml && cloudKey) ml.href = '/thing/manifest.webmanifest?k=' + encodeURIComponent(cloudKey);
    tab = localStorage.getItem(TAB_KEY) || 'all';
    if (tab !== 'all' && !tree.pages.some((p) => p.id === tab)) tab = 'all';
    linkKind = localStorage.getItem(LINK_KEY) === 'x' ? 'x' : 'in';
    const v = safeParse(localStorage.getItem(STORAGE_KEY + ':view:' + tab));
    if (v && Number.isFinite(v.k) && v.k > 0) view = v;
    else centerOn(0, 0);
    renderLegend();
    render();
    if (!visibleNodes().length) fitAll();
    setSync(cloudKey ? 'מתחבר…' : 'מקומי בלבד', false);
    if (cloudKey) cloudLoad(); else showNoKey();
    bindStage();
    startPolling();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/thing/sw.js').catch(() => {});
    window.addEventListener('online', () => { if (cloudKey) { cloudSave().then(flushPending); } });
    if (navigator.onLine && cloudKey) setTimeout(flushPending, 2500);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cloudKey) { cloudLoad(); startPolling(); } });
    window.addEventListener('focus', () => { if (cloudKey) cloudLoad(); });
    // Stav asked whether a refresh mid-sentence loses the sentence. It does
    // not: every keystroke is in the tree, and the tree reaches localStorage
    // within 150 ms — and right now if the page is about to go.
    const flush = () => { closeIfEmpty(); clearTimeout(saveTimer); localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)); if (dirty && cloudKey && navigator.onLine) { clearTimeout(cloudTimer); cloudSave(); } };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    renderHistoryButtons(); renderClipButton();
}

function keyFromAddress() {
    const m = (location.hash || '').match(/[#&]k=([A-Za-z0-9_-]{32,64})/);
    return m ? m[1] : null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function normalize(t) {
    const n = t && typeof t === 'object' ? t : {};
    const pages = (Array.isArray(n.pages) ? n.pages : []).filter((p) => p && p.id).map((p) => ({ id: String(p.id), name: String(p.name || ''), u: Number(p.u) || 0, x: !!p.x }));
    const pageIds = new Set(pages.map((p) => p.id));
    const nodes = (Array.isArray(n.nodes) ? n.nodes : []).filter((x) => x && x.id).map((x) => ({
        id: String(x.id), t: String(x.t || ''), b: String(x.b || ''), x: Number(x.x) || 0, y: Number(x.y) || 0, u: Number(x.u) || 0,
        c: Math.min(7, Math.max(0, Number(x.c) || 0)),
        ...(Number(x.c2) >= 1 && Number(x.c2) <= 7 ? { c2: Number(x.c2) } : {}),   // a second colour: half/half
        ...(x.s === 'L' ? { s: 'L' } : {}),                                         // a big bubble
        p: pageIds.has(String(x.p || '')) ? String(x.p) : '',
        recs: (Array.isArray(x.recs) ? x.recs : []).filter((r) => r && r.id),
        imgs: (Array.isArray(x.imgs) ? x.imgs : []).filter((g) => g && g.id),
    }));
    const ids = new Set(nodes.map((x) => x.id));
    const edges = (Array.isArray(n.edges) ? n.edges : []).filter((e) => e && ids.has(e.a) && ids.has(e.b) && e.a !== e.b)
        .map((e) => ({ a: e.a, b: e.b, u: Number(e.u) || 0, k: e.k === 'x' ? 'x' : 'in', ...(['ab', 'ba', 'both'].includes(e.d) ? { d: e.d } : {}) }));
    const del = (Array.isArray(n.del) ? n.del : []).filter((d) => d && d.id).map((d) => ({ id: String(d.id), at: Number(d.at) || 0 }));
    const trash = (Array.isArray(n.trash) ? n.trash : []).filter((x) => x && x.id && !ids.has(String(x.id))).map((x) => ({ ...x, id: String(x.id), edges: Array.isArray(x.edges) ? x.edges : [], recs: Array.isArray(x.recs) ? x.recs : [], dAt: Number(x.dAt) || 0 }));
    const legend = (Array.isArray(n.legend) ? n.legend : []).filter((l) => l && l.name).map((l) => ({ c: Math.min(7, Math.max(0, Number(l.c) || 0)), name: String(l.name).slice(0, 30), u: Number(l.u) || 0 }));
    return { nodes, edges, del, pages, trash, legend, updatedAt: Number(n.updatedAt) || 0 };
}

// ---------- persistence ----------

function touch(changed) {
    const now = Date.now();
    if (changed) changed.u = now;
    tree.updatedAt = now;
    dirty = true;
    localSeq++;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)), 150);
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudSave, 1200);
    setSync(cloudKey ? 'שומר…' : 'מקומי בלבד', false);
}

function saveView() { localStorage.setItem(STORAGE_KEY + ':view:' + tab, JSON.stringify(view)); }

// ---------- undo / redo ----------
//
// A snapshot of the tree before every change; Ctrl+Z puts it back. Media
// (recordings, pictures) is outside history — a blob cannot be un-deleted —
// so a restored bubble keeps whatever media it has now. What comes back is
// stamped as a new change, so the other device takes it too.

function snapshot() { return JSON.stringify({ nodes: tree.nodes, edges: tree.edges, pages: tree.pages, legend: tree.legend, trash: tree.trash }); }
function remember(coalesce) {
    if (coalesce && histKey && histKey.key === coalesce && Date.now() - histKey.at < 1500) { histKey.at = Date.now(); return; }
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
    histKey = coalesce ? { key: coalesce, at: Date.now() } : null;
    renderHistoryButtons();
}
function renderHistoryButtons() {
    const u = $('btn-undo'), r = $('btn-redo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
}
function stripMedia(n) { const { recs, imgs, u, ...rest } = n; return rest; }
function restoreSnapshot(json) {
    const snap = safeParse(json); if (!snap) return;
    const now = Date.now();
    const prev = tree;
    const next = normalize({ ...snap, del: prev.del, updatedAt: now });
    const have = new Map();
    for (const n of prev.nodes) have.set(n.id, n);
    for (const x of prev.trash || []) if (!have.has(x.id)) have.set(x.id, x);
    for (const n of next.nodes) { const m = have.get(n.id); n.recs = m ? (m.recs || []) : []; n.imgs = m ? (m.imgs || []) : []; }
    next.trash = next.trash.filter((x) => have.has(x.id)).map((x) => { const m = have.get(x.id); return { ...x, recs: m.recs || [], imgs: m.imgs || [] }; });
    const same = (a, b) => JSON.stringify(stripMedia(a)) === JSON.stringify(stripMedia(b));
    const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
    for (const n of next.nodes) { const p = prevNodes.get(n.id); if (!p || !same(p, n)) n.u = now; }
    for (const p of prev.nodes) if (!next.nodes.some((n) => n.id === p.id)) next.del.push({ id: p.id, at: now });
    const prevEdges = new Map(prev.edges.map((e) => [ekey(e), e]));
    for (const e of next.edges) { const p = prevEdges.get(ekey(e)); if (!p || p.a !== e.a || p.k !== e.k || (p.d || '') !== (e.d || '')) e.u = now; }
    for (const p of prev.edges) if (!next.edges.some((e) => ekey(e) === ekey(p))) next.del.push({ id: ekey(p), at: now });
    const prevPages = new Map(prev.pages.map((p) => [p.id, p]));
    for (const p of next.pages) { const q = prevPages.get(p.id); if (!q || q.name !== p.name || q.x !== p.x) p.u = now; }
    for (const q of prev.pages) if (!next.pages.some((p) => p.id === q.id)) next.del.push({ id: 'page:' + q.id, at: now });
    for (const l of next.legend) { const q = prev.legend.find((z) => z.c === l.c); if (!q || q.name !== l.name) l.u = now; }
    for (const q of prev.legend) if (!next.legend.some((l) => l.c === q.c)) next.legend.push({ c: q.c, name: '', u: now });
    next.legend = next.legend.filter((l) => l.name);
    tree = next;
    picked = new Set([...picked].filter((id) => tree.nodes.some((n) => n.id === id)));
    if (tab !== 'all' && !tree.pages.some((p) => p.id === tab)) { tab = 'all'; localStorage.setItem(TAB_KEY, tab); }
    render(); touch();
    if (selectedId) { if (tree.nodes.some((n) => n.id === selectedId)) select(selectedId); else closeSheet(); }
    renderTrash();
}
function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    const snap = undoStack.pop(); histKey = null;
    restoreSnapshot(snap); renderHistoryButtons(); toast('בוטל');
}
function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    const snap = redoStack.pop(); histKey = null;
    restoreSnapshot(snap); renderHistoryButtons(); toast('בוצע שוב');
}

// ---------- copy / cut / paste ----------
//
// The clipboard is a set of bubbles with the lines among them, kept in
// localStorage so it survives a tab switch and a reload. Positions are kept
// relative to each other; a paste lands beside the originals when they are on
// screen, else in the middle of the view. Titles also go to the system
// clipboard as plain text, so a bubble can be pasted into a message.
function readClip() { return safeParse(localStorage.getItem(CLIP_KEY)); }
function renderClipButton() { const b = $('btn-paste'); if (b) b.disabled = !readClip(); }
function idsInHand() { return picked.size ? [...picked] : (selectedId ? [selectedId] : []); }
function copyIds(ids, quiet) {
    const set = new Set(ids);
    const nodes = tree.nodes.filter((n) => set.has(n.id)).map((n) => { const q = pos(n); return { id: n.id, t: n.t, b: n.b, x: q.x, y: q.y, c: n.c || 0, c2: n.c2, s: n.s }; });
    if (!nodes.length) return null;
    const edges = tree.edges.filter((e) => set.has(e.a) && set.has(e.b)).map((e) => ({ a: e.a, b: e.b, k: e.k, d: e.d }));
    const clip = { nodes, edges, tab, at: Date.now() };
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { /* the in-memory copy below still works this session */ }
    lastClip = clip;
    try { if (navigator.clipboard) navigator.clipboard.writeText(nodes.map((n) => n.t || firstWords(n)).filter(Boolean).join(String.fromCharCode(10))).catch(() => {}); } catch { /* not important */ }
    renderClipButton();
    if (!quiet) toast(nodes.length === 1 ? 'הועתק' : `הועתקו ${nodes.length}`);
    return clip;
}
function copyPicked() { copyIds(idsInHand()); }
function copySelected() { if (selectedId) copyIds([selectedId]); }
function cutPicked() {
    const ids = idsInHand(); if (!ids.length) return;
    if (!copyIds(ids, true)) return;
    remember(); deleteNodes(ids);
    toast(ids.length === 1 ? 'נגזר — Ctrl+V מדביק' : `נגזרו ${ids.length} — Ctrl+V מדביק`);
}
function pasteClipboard(nudge) {
    const clip = readClip() || lastClip; if (!clip || !clip.nodes.length) { toast('אין מה להדביק'); return; }
    remember();
    const now = Date.now();
    const p = tab !== 'all' ? tab : '';
    const o = off(p);
    const cx = clip.nodes.reduce((a, n) => a + n.x, 0) / clip.nodes.length, cy = clip.nodes.reduce((a, n) => a + n.y, 0) / clip.nodes.length;
    const sx = cx * view.k + view.x, sy = cy * view.k + view.y;
    const onScreen = clip.tab === tab && sx > 0 && sy > 0 && sx < stage.clientWidth && sy < stage.clientHeight;
    let dx, dy;
    if (onScreen) { const step = 40 * (nudge || 1); dx = step; dy = step; }
    else { const c = toWorld(stage.clientWidth / 2, stage.clientHeight / 2 - 40); dx = c.x - cx; dy = c.y - cy; }
    const map = new Map();
    const made = [];
    for (const n of clip.nodes) {
        const id = uid(); map.set(n.id, id);
        const node = { id, t: n.t, b: n.b, x: Math.round(n.x + dx - o.x), y: Math.round(n.y + dy - o.y), u: now, c: n.c || 0, p, recs: [], imgs: [] };
        if (n.c2 >= 1 && n.c2 <= 7) node.c2 = n.c2;
        if (n.s === 'L') node.s = 'L';
        tree.nodes.push(node); made.push(id);
    }
    for (const e of clip.edges) {
        const a = map.get(e.a), b = map.get(e.b); if (!a || !b) continue;
        const edge = { a, b, u: now, k: e.k === 'x' ? 'x' : 'in' }; if (['ab', 'ba', 'both'].includes(e.d)) edge.d = e.d;
        tree.edges.push(edge);
    }
    // The next paste of the same thing lands one step further, like a stack of cards.
    if (onScreen) { const shifted = { ...clip, nodes: clip.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })) }; try { localStorage.setItem(CLIP_KEY, JSON.stringify(shifted)); } catch { /* fine */ } lastClip = shifted; }
    picked = new Set(made); selectedId = null; $('sheet').classList.remove('open');
    render(); touch();
    toast(made.length === 1 ? 'הודבק' : `הודבקו ${made.length}`);
}
function duplicatePicked() {
    const ids = idsInHand(); if (!ids.length) return;
    const keep = readClip();
    if (!copyIds(ids, true)) return;
    pasteClipboard();
    if (keep) { try { localStorage.setItem(CLIP_KEY, JSON.stringify(keep)); } catch { /* fine */ } lastClip = keep; }
    renderClipButton();
}
function nudgePicked(dx, dy) {
    const ids = idsInHand(); if (!ids.length) return;
    remember('nudge');
    const now = Date.now();
    for (const id of ids) { const n = tree.nodes.find((x) => x.id === id); if (n) { n.x += dx; n.y += dy; n.u = now; } }
    render(); touch();
}

// A yes/no that looks like the page and works in the installed app on the
// phone, where the browser's own confirm() is at its ugliest.
function askConfirm(text, okLabel) {
    const d = $('confirm');
    if (!d || typeof d.showModal !== 'function') return Promise.resolve(window.confirm(text));
    return new Promise((resolve) => {
        $('confirm-text').textContent = text;
        const ok = $('confirm-ok'), cancel = $('confirm-cancel');
        ok.textContent = okLabel || 'כן';
        const done = (v) => { d.removeEventListener('close', onClose); d.close(); resolve(v); };
        const onClose = () => { d.removeEventListener('close', onClose); resolve(false); };
        ok.onclick = () => done(true); cancel.onclick = () => done(false);
        d.addEventListener('close', onClose);
        d.showModal();
    });
}

function setSync(text, ok) {
    const el = $('sync'); if (!el) return;
    el.textContent = text; el.classList.toggle('on', !!ok);
}

// Whatever comes back from the server is merged INTO what is here now, bubble
// by bubble, newest change wins — the same rule the server uses. It used to
// replace the tree outright, and that was the "jumps back" bug (Stav,
// 4.9.2026): a drag made while a save was in flight was overwritten by the
// reply, which did not know about it, and `dirty` went false so it was never
// sent. Merging keeps the newer local change, and the seq check below keeps
// it dirty until a save that started after it comes back.
function adopt(merged) {
    if (!merged) return;
    tree = mergeLocal(tree, merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    if (tab !== 'all' && !tree.pages.some((p) => p.id === tab)) { tab = 'all'; localStorage.setItem(TAB_KEY, tab); }
    render();
    if (selectedId && !tree.nodes.some((n) => n.id === selectedId)) closeSheet();
}

function ekey(e) { return [e.a, e.b].sort().join('|'); }
function mergeLocal(a, b) {
    const A = normalize(a), B = normalize(b);
    const tomb = new Map();
    for (const d of [...A.del, ...B.del]) if (!tomb.has(d.id) || tomb.get(d.id) < d.at) tomb.set(d.id, d.at);
    const nodes = new Map();
    for (const n of [...B.nodes, ...A.nodes]) {
        const dead = tomb.get(n.id); if (dead && dead >= n.u) continue;
        const cur = nodes.get(n.id); if (!cur || n.u > cur.u) nodes.set(n.id, n);
    }
    const edges = new Map();
    for (const e of [...B.edges, ...A.edges]) {
        if (!nodes.has(e.a) || !nodes.has(e.b)) continue;
        const k = ekey(e); const dead = tomb.get(k); if (dead && dead >= e.u) continue;
        const cur = edges.get(k); if (!cur || e.u > cur.u) edges.set(k, e);
    }
    const pages = new Map();
    for (const p of [...B.pages, ...A.pages]) {
        const dead = tomb.get('page:' + p.id); if (dead && dead >= p.u) continue;
        const cur = pages.get(p.id); if (!cur || p.u > cur.u) pages.set(p.id, p);
    }
    const alive = [...nodes.values()].map((n) => (n.p && !pages.has(n.p)) ? { ...n, p: '' } : n);
    const trash = new Map();
    for (const x of [...B.trash, ...A.trash]) {
        if (nodes.has(x.id)) continue;
        const purged = tomb.get('trash:' + x.id); if (purged && purged >= x.dAt) continue;   // emptied on some device — stays empty
        const cur = trash.get(x.id); if (!cur || x.dAt > cur.dAt) trash.set(x.id, x);
    }
    const legend = new Map();
    for (const l of [...B.legend, ...A.legend]) { const cur = legend.get(l.c); if (!cur || l.u > cur.u) legend.set(l.c, l); }
    return normalize({
        nodes: alive, edges: [...edges.values()], pages: [...pages.values()], trash: [...trash.values()],
        legend: [...legend.values()], del: [...tomb].map(([id, at]) => ({ id, at })),
        updatedAt: Math.max(A.updatedAt, B.updatedAt),
    });
}

async function cloudLoad() {
    if (!cloudKey) return;
    const seq = localSeq;
    try {
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey));
        if (res.status === 404) { setSync('כתובת לא מוכרת', false); return; }
        const body = await res.json();
        if (!res.ok) { setSync('לא מקוון', false); return; }
        const cloud = body.tree ? normalize(body.tree) : null;
        const cloudAt = cloud ? cloud.updatedAt : 0;
        if (dirty || (!cloud && (tree.nodes.length || tree.pages.length || tree.del.length))) {
            // We hold something the cloud has not seen: send, and take the merge back.
            await cloudSave();
        } else if (cloud && cloudAt !== lastServerAt) {
            // The other device wrote. Merge it in; if something changed here
            // while we waited, the merge keeps it and it goes up next.
            lastServerAt = cloudAt;
            adopt(cloud);
            if (localSeq !== seq) { dirty = true; clearTimeout(cloudTimer); cloudTimer = setTimeout(cloudSave, 800); }
            setSync('מסונכרן', true);
        } else {
            setSync('מסונכרן', true);
        }
    } catch { setSync('לא מקוון', false); }
}

// Every device asks the cloud on a clock while it is on screen, so the
// computer sees what the phone wrote within a minute without a reload.
function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && cloudKey && navigator.onLine) cloudLoad(); }, POLL_MS);
}

async function cloudSave() {
    if (!cloudKey) return;
    const seq = localSeq;
    try {
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tree }), keepalive: true,   // a save started while the page closes still lands
        });
        const body = await res.json();
        if (!res.ok) { setSync('לא נשמר', false); toast((body.error && body.error.message) || 'לא נשמר'); return; }
        lastServerAt = body.tree ? (Number(body.tree.updatedAt) || 0) : 0;
        adopt(body.tree);
        if (localSeq === seq) { dirty = false; setSync('מסונכרן', true); }
        else { dirty = true; clearTimeout(cloudTimer); cloudTimer = setTimeout(cloudSave, 800); setSync('שומר…', false); }
    } catch { setSync('לא מקוון', false); }
}

// ---------- joining the cloud from a device that has no address ----------

function showNoKey() {
    const el = $('nokey'); if (!el) return;
    if (localStorage.getItem('sj_thing_nokey_dismissed') === '1') return;
    const n = tree.nodes.length;
    $('nokey-local').textContent = n ? `במכשיר הזה יש ${n} תובנות שעוד לא בענן — הן יצטרפו, לא יימחקו.` : '';
    el.hidden = false;
}
function dismissNoKey() {
    try { localStorage.setItem('sj_thing_nokey_dismissed', '1'); } catch { /* fine */ }
    const el = $('nokey'); if (el) { el.hidden = true; el.style.display = 'none'; }
}

// Before anything leaves the device, a copy of what it holds stays behind
// under its own name. The merge is union-by-bubble and cannot lose a bubble,
// but a backup that costs nothing is worth more than trusting a merge.
function connectKey() {
    const raw = ($('nokey-input').value || '').trim();
    const m = raw.match(/k=([A-Za-z0-9_-]{32,64})/) || raw.match(/^([A-Za-z0-9_-]{32,64})$/);
    if (!m) { toast('זו לא נראית כמו הכתובת המלאה — צריך את החלק #k=…'); return; }
    if (tree.nodes.length) {
        try { localStorage.setItem('sj_thing_backup_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'), JSON.stringify(tree)); } catch { /* no room — the merge still keeps it */ }
    }
    cloudKey = m[1];
    localStorage.setItem(KEY_KEY, cloudKey);
    localStorage.removeItem('sj_thing_nokey_dismissed');
    const el = $('nokey'); if (el) { el.hidden = true; el.style.display = 'none'; }
    dirty = true;                      // whatever is here goes up and merges
    setSync('מתחבר…', false);
    cloudLoad().then(() => { toast('מחובר לענן — הכל מסונכרן'); flushPending(); });
}

// ---------- pages (tabs) ----------

function pageName(id) { const p = tree.pages.find((x) => x.id === id); return p ? (p.name || 'לשונית') : 'כללי'; }

function setTab(id) {
    tab = id;
    localStorage.setItem(TAB_KEY, tab);
    closeSheet();
    const v = safeParse(localStorage.getItem(STORAGE_KEY + ':view:' + tab));
    if (v && Number.isFinite(v.k) && v.k > 0) { view = v; render(); } else { render(); fitAll(); }
}

function addPage() {
    const name = (prompt('שם ללשונית החדשה:') || '').trim().slice(0, 40);
    if (!name) return;
    const p = { id: uid(), name, u: Date.now() };
    tree.pages.push(p);
    touch();
    setTab(p.id);
}

function renamePage(id) {
    const p = tree.pages.find((x) => x.id === id); if (!p) return;
    const name = (prompt('שם חדש ללשונית:', p.name) || '').trim().slice(0, 40);
    if (!name || name === p.name) return;
    p.name = name; p.u = Date.now();
    touch(); render();
}

// "שתהיה אפשרות שכרטיסיה לא תהיה חלק מהכללי." The page keeps everything; it
// just does not show up in הכל. The flag rides with the page, newest wins.
function togglePageHidden(id) {
    const p = tree.pages.find((x) => x.id === id); if (!p) return;
    p.x = !p.x; p.u = Date.now();
    touch(); render();
    toast(p.x ? `"${p.name}" לא תופיע בכללי` : `"${p.name}" חזרה לכללי`);
}

// Removing a page never removes a bubble: they simply become page-less and
// show in "הכל" as their own group.
function deletePage(id) {
    const p = tree.pages.find((x) => x.id === id); if (!p) return;
    const count = tree.nodes.filter((n) => n.p === id).length;
    if (!confirm(`למחוק את הלשונית "${p.name}"? ${count ? count + ' התובנות שבה יעברו ל"כללי", לא יימחקו.' : ''}`)) return;
    const now = Date.now();
    for (const n of tree.nodes) if (n.p === id) { n.p = ''; n.u = now; }
    tree.pages = tree.pages.filter((x) => x.id !== id);
    tree.del.push({ id: 'page:' + id, at: now });
    touch();
    setTab('all');
}

function renderTabs() {
    const bar = $('tabs'); if (!bar) return;
    const chip = (id, label, extra) => `<button type="button" class="tab${tab === id ? ' on' : ''}" data-id="${id}" onclick="setTab('${id}')" ${extra || ''}>${escapeHtml(label)}</button>`;
    bar.innerHTML = chip('all', 'הכל')
        + tree.pages.map((p) => chip(p.id, (p.x ? '◌ ' : '') + (p.name || 'לשונית'), `ondblclick="renamePage('${p.id}')" title="${p.x ? 'לא מוצגת בכללי · ' : ''}לחיצה כפולה לשינוי שם"`)).join('')
        + `<button type="button" class="tab add" onclick="addPage()" title="לשונית חדשה">＋</button>`;
    const tools = $('tab-tools'); if (!tools) return;
    if (tab === 'all') {
        tools.innerHTML = `<button type="button" class="btn small" id="btn-linkkind" onclick="toggleLinkKind()" title="איזה קו הנקודה הכחולה מותחת">${linkKind === 'in' ? 'קו: משייך ללשונית' : 'קו: חוצה'}</button>`;
    } else {
        const pg = tree.pages.find((p) => p.id === tab);
        tools.innerHTML = `<button type="button" class="btn quiet small" onclick="renamePage('${tab}')">שם</button>`
            + `<button type="button" class="btn quiet small${pg && pg.x ? ' on' : ''}" onclick="togglePageHidden('${tab}')" title="האם הלשונית הזו מופיעה גם בתצוגת הכל">${pg && pg.x ? '◌ לא בכללי' : 'מוצגת בכללי'}</button>`
            + `<button type="button" class="btn quiet small" onclick="deletePage('${tab}')">מחק לשונית</button>`;
    }
}

function toggleLinkKind() {
    linkKind = linkKind === 'in' ? 'x' : 'in';
    localStorage.setItem(LINK_KEY, linkKind);
    renderTabs();
    toast(linkKind === 'in' ? 'קו משייך: תובנה בלי לשונית תיכנס ללשונית של הבועה שממנה מתחת' : 'קו חוצה: מחבר בלי להעביר לשונית');
}

// Every bubble reachable through assigning lines — the tree a bubble is part of.
function componentOf(id) {
    const seen = new Set([id]); const q = [id];
    while (q.length) {
        const cur = q.pop();
        for (const e of tree.edges) {
            if (e.k === 'x') continue;
            const other = e.a === cur ? e.b : e.b === cur ? e.a : null;
            if (other && !seen.has(other)) { seen.add(other); q.push(other); }
        }
    }
    return [...seen];
}

// Move a bubble — and its whole tree — into a page (or out of every page),
// keeping the tree's shape. Coordinates are page-local, so the tree is
// re-based at its own top-left; in "הכל" the page's slot puts it in place.
function assignPage(id, pageId) {
    remember();
    const ids = componentOf(id);
    const nodes = ids.map((x) => tree.nodes.find((n) => n.id === x)).filter(Boolean);
    const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
    const now = Date.now();
    for (const n of nodes) { n.p = pageId; n.x = Math.round(n.x - minX); n.y = Math.round(n.y - minY); n.u = now; }
    touch(); render();
    if (selectedId) renderPageSelect(tree.nodes.find((n) => n.id === selectedId));
}

function renderPageSelect(n) {
    const sel = $('f-page'); if (!sel || !n) return;
    sel.innerHTML = `<option value="">כללי (בלי לשונית)</option>` + tree.pages.map((p) => `<option value="${p.id}"${n.p === p.id ? ' selected' : ''}>${escapeHtml(p.name || 'לשונית')}</option>`).join('');
    sel.value = n.p || '';
}
function onPageSelect() {
    const n = tree.nodes.find((x) => x.id === selectedId); if (!n) return;
    const to = $('f-page').value;
    if (to === (n.p || '')) return;
    const size = componentOf(n.id).length;
    if (size > 1 && !confirm(`להעביר את כל העץ המחובר (${size} תובנות) ל"${to ? pageName(to) : 'כללי'}"?`)) { $('f-page').value = n.p || ''; return; }
    assignPage(n.id, to);
}

// ---------- layout in "הכל": pages side by side ----------

// A page marked "לא בכללי" keeps to its own tab: its bubbles, its lines and
// its slot are all left out of the general view.
function hiddenPages() { return new Set(tree.pages.filter((p) => p.x).map((p) => p.id)); }
function generalPages() { return ['', ...tree.pages.filter((p) => !p.x).map((p) => p.id)]; }
function visibleNodes() {
    if (tab !== 'all') return tree.nodes.filter((n) => n.p === tab);
    const hid = hiddenPages();
    return hid.size ? tree.nodes.filter((n) => !hid.has(n.p)) : tree.nodes;
}
function visibleEdges() {
    const ids = new Set(visibleNodes().map((n) => n.id));
    return tree.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
}

function computeOffsets() {
    offsets = {};
    if (tab !== 'all') { offsets[tab] = { x: 0, y: 0 }; return; }
    const groups = generalPages();
    let cursor = 0;
    const GAP = 320;
    for (const g of groups) {
        const ns = tree.nodes.filter((n) => n.p === g);
        const box = ns.length
            ? { minX: Math.min(...ns.map((n) => n.x)) - 140, maxX: Math.max(...ns.map((n) => n.x)) + 140, minY: Math.min(...ns.map((n) => n.y)) - 60 }
            : { minX: -140, maxX: 140, minY: -60 };
        offsets[g] = { x: cursor - box.minX, y: -box.minY, w: box.maxX - box.minX };
        cursor += (box.maxX - box.minX) + GAP;
    }
}
function off(p) { return offsets[p || ''] || { x: 0, y: 0 }; }
function pos(n) { const o = off(n.p); return { x: n.x + o.x, y: n.y + o.y }; }

// ---------- view (pan / zoom) ----------

function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    if (selectedEdge) placeEdgeButton();
    const g = Math.max(14, 28 * view.k);
    stage.style.backgroundSize = `${g}px ${g}px`;
    stage.style.setProperty('--dot-alpha', view.k < 0.3 ? '0' : '1');
    stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
}
function toWorld(sx, sy) { return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k }; }
function centerOn(wx, wy) {
    view.x = stage.clientWidth / 2 - wx * view.k;
    view.y = stage.clientHeight / 2 - wy * view.k;
    applyView(); saveView();
}
function zoomAt(sx, sy, factor) {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
    const w = toWorld(sx, sy);
    view.k = k;
    view.x = sx - w.x * k; view.y = sy - w.y * k;
    applyView(); saveView();
}
function zoomBy(f) { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, f); }
function fitAll() {
    computeOffsets();
    const ns = visibleNodes();
    if (!ns.length) { view.k = 1; centerOn(0, 0); return; }
    const ps = ns.map(pos);
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const minX = Math.min(...xs) - 160, maxX = Math.max(...xs) + 160;
    const minY = Math.min(...ys) - 110, maxY = Math.max(...ys) + 120;
    const k = Math.min(2, Math.max(MIN_ZOOM, Math.min(stage.clientWidth / (maxX - minX), stage.clientHeight / (maxY - minY))));
    view.k = k;
    centerOn((minX + maxX) / 2, (minY + maxY) / 2);
}

// ---------- rendering ----------

function render() {
    renderTrash();
    computeOffsets();
    renderTabs();
    renderNodes();
    renderWires();
    applyView();
    const ns = visibleNodes(), es = visibleEdges();
    $('count').textContent = picked.size ? `${picked.size} נבחרו · גרור אחת וכולן זזות` : (ns.length ? `${ns.length} תובנות · ${es.length} קווים` : (tab === 'all' ? 'עדיין ריק' : 'לשונית ריקה'));
    $('hint').hidden = ns.length > 0;
    const pb = $('pickbar'); if (pb) { pb.hidden = !picked.size; const pc = $('pick-count'); if (pc) pc.textContent = picked.size ? `${picked.size} נבחרו` : ''; }
}

function renderNodes() {
    const byId = new Map([...nodesEl.querySelectorAll('.bubble')].map((el) => [el.dataset.id, el]));
    const keep = new Set();
    for (const n of visibleNodes()) {
        keep.add(n.id);
        let el = byId.get(n.id);
        if (!el) {
            el = document.createElement('div');
            el.className = 'bubble'; el.dataset.id = n.id;
            el.innerHTML = '<span class="label"></span><span class="knob" title="גרור לתובנה אחרת כדי לחבר"></span>';
            bindNode(el);
            nodesEl.appendChild(el);
        }
        const label = el.querySelector('.label');
        const title = n.t.trim() || firstWords(n) || 'ללא כותרת';
        if (label.textContent !== title) label.textContent = title;
        el.classList.toggle('long', title.length > (n.s === 'L' ? 56 : 28));
        el.classList.toggle('big', n.s === 'L');
        if (n.c2 >= 1 && n.c2 <= 7 && n.c2 !== (n.c || 0)) el.dataset.c2 = n.c2; else delete el.dataset.c2;
        el.classList.toggle('has-body', !!n.b.trim());
        el.classList.toggle('has-rec', !!(n.recs && n.recs.length));
        el.classList.toggle('has-img', !!(n.imgs && n.imgs.length));
        el.classList.toggle('sel', n.id === selectedId);
        el.dataset.c = n.c || 0;
        el.classList.toggle('dim', !!query && !matches(n));
        el.classList.toggle('picked', picked.has(n.id));
        el.title = legendName(n.c || 0) + (tab === 'all' && n.p ? ' · ' + pageName(n.p) : '');
        const p = pos(n);
        el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    }
    for (const [id, el] of byId) if (!keep.has(id)) el.remove();
    renderClusterLabels();
}

// In "הכל", each page's group carries its name above it, so you know whose
// tree you are looking at.
function renderClusterLabels() {
    nodesEl.querySelectorAll('.cluster').forEach((x) => x.remove());
    if (tab !== 'all') return;
    for (const g of generalPages()) {
        const ns = tree.nodes.filter((n) => n.p === g);
        if (!ns.length && g === '') continue;
        const o = off(g);
        const minX = ns.length ? Math.min(...ns.map((n) => n.x)) : 0;
        const minY = ns.length ? Math.min(...ns.map((n) => n.y)) : 0;
        const el = document.createElement('div');
        el.className = 'cluster' + (query && !ns.some(matches) ? ' dim' : '');
        el.textContent = g ? pageName(g) : 'כללי';
        el.style.left = (minX + o.x - 120) + 'px'; el.style.top = (minY + o.y - 70) + 'px';
        el.onclick = () => { if (g) setTab(g); };
        nodesEl.appendChild(el);
    }
}

// Where a line meets a bubble's edge, so an arrowhead is not buried under
// the bubble. Sizes come from the drawn elements; a bubble not yet drawn is
// treated as a point.
function bubbleRect(id) {
    const el = nodesEl.querySelector(`.bubble[data-id="${id}"]`);
    return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
}
function clipToRect(from, to, rect, pad) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!dx && !dy) return { x: from.x, y: from.y };
    const hw = rect.w / 2 + pad, hh = rect.h / 2 + pad;
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return t >= 1 ? { x: from.x, y: from.y } : { x: from.x + dx * t, y: from.y + dy * t };
}
function arrowHead(tip, from, c, cls) {
    const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
    const L = 14, W = 7;
    const bx = tip.x - Math.cos(ang) * L, by = tip.y - Math.sin(ang) * L;
    const lx = bx + Math.sin(ang) * W, ly = by - Math.cos(ang) * W;
    const rx = bx - Math.sin(ang) * W, ry = by + Math.cos(ang) * W;
    return `<path class="arrow${cls}" data-c="${c}" d="M${tip.x},${tip.y} L${lx},${ly} L${rx},${ry} Z"/>`;
}
function renderWires() {
    const parts = [];
    for (const e of visibleEdges()) {
        const a = tree.nodes.find((n) => n.id === e.a), b = tree.nodes.find((n) => n.id === e.b);
        if (!a || !b) continue;
        const pa = pos(a), pb = pos(b);
        const d = `M${pa.x},${pa.y} L${pb.x},${pb.y}`;
        const sel = selectedEdge && selectedEdge.a === e.a && selectedEdge.b === e.b;
        // The line wears the colour of the bubble it was drawn from; a white
        // source gives a plain line (Stav, 4.9.2026 — it used to borrow the target's).
        const c = a.c || 0;
        const dim = !!query && !matches(a) && !matches(b);
        parts.push(`<path class="wire${sel ? ' sel' : ''}${e.k === 'x' ? ' cross' : ''}${dim ? ' dim' : ''}" data-c="${c}" d="${d}"/><path class="wire-hit" data-a="${e.a}" data-b="${e.b}" d="${d}"/>`);
        if (e.d) {
            const cls = (sel ? ' sel' : '') + (dim ? ' dim' : '');
            if (e.d === 'ab' || e.d === 'both') parts.push(arrowHead(clipToRect(pb, pa, bubbleRect(b.id), 3), pa, c, cls));
            if (e.d === 'ba' || e.d === 'both') parts.push(arrowHead(clipToRect(pa, pb, bubbleRect(a.id), 3), pb, c, cls));
        }
    }
    wires.innerHTML = parts.join('') + '<path id="ghost" class="wire ghost" d=""/>';
    wires.setAttribute('width', '1'); wires.setAttribute('height', '1');
    wires.querySelectorAll('.wire-hit').forEach((p) => p.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        selectEdge({ a: p.dataset.a, b: p.dataset.b });
    }));
}

function renderLegend() {
    const box = $('legend-list'); if (!box) return;
    const eb = $('btn-legend-edit'); if (eb) { eb.textContent = legendEditing ? 'סיום' : '✎'; eb.classList.toggle('on', legendEditing); }
    box.innerHTML = LEGEND.map((l) => legendEditing ? `
        <div class="legend-row editing" data-c="${l.c}">
            <span class="swatch" data-c="${l.c}"></span>
            <input type="text" class="legend-input" value="${escapeHtml(legendName(l.c))}" maxlength="30" placeholder="${escapeHtml(l.name)}"
                   onchange="renameLegend(${l.c}, this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">
        </div>` : `
        <button type="button" class="legend-row" data-c="${l.c}" onclick="legendPick(${l.c})" title="${escapeHtml(l.hint)}">
            <span class="swatch" data-c="${l.c}"></span><span class="legend-name">${escapeHtml(legendName(l.c))}</span>
        </button>`).join('');
}
function legendPick(c) {
    if (selectedId) { setColor(c); toast('נצבע: ' + legendName(c)); }
    else toast(legendName(c) + ' — ' + LEGEND_BY_C[c].hint);
}

// Stav: "אפשרות לערוך את המקרא". The colours stay; the words are his. A name
// is kept per colour with a time, so the newest rename wins across devices;
// an empty name means "back to the default".
function toggleLegendEdit() { legendEditing = !legendEditing; renderLegend(); if (legendEditing) $('legend').classList.add('open'); }
function renameLegend(c, value) {
    const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    tree.legend = (tree.legend || []).filter((l) => l.c !== c);
    if (name && name !== LEGEND_BY_C[c].name) tree.legend.push({ c, name, u: Date.now() });
    touch(); renderLegend(); renderNodes();
}
function toggleLegend() { $('legend').classList.toggle('open'); }

// ---------- selection & the sheet ----------

function select(id) {
    if (selectedId && selectedId !== id) closeIfEmpty();
    selectedId = id; selectedEdge = null; hideEdgeBar();
    renderNodes(); renderWires();
    const n = tree.nodes.find((x) => x.id === id);
    if (!n) { closeSheet(); return; }
    $('f-title').value = n.t; $('f-body').value = n.b;
    $('f-meta').textContent = n.b ? `${n.b.length} תווים` : '';
    renderSwatches(n.c || 0, n.c2 || 0);
    const bb = $('btn-big'); if (bb) bb.classList.toggle('on', n.s === 'L');
    renderPageSelect(n);
    renderRecs(n);
    renderImgs(n);
    $('sheet').classList.add('open');
}

function closeSheet() {
    closeIfEmpty();
    $('sheet').classList.remove('open');
    selectedId = null; renderNodes();
    document.activeElement && document.activeElement.blur();
}

// A note opened and left blank is not a note: closing it takes it away
// quietly (Stav, 4.9.2026). No bin, no toast — there was nothing in it.
function isEmptyNode(n) { return !!n && !n.t.trim() && !n.b.trim() && !(n.recs || []).length && !(n.imgs || []).length; }
function closeIfEmpty() {
    const n = selectedId && tree.nodes.find((x) => x.id === selectedId);
    if (!isEmptyNode(n)) return;
    const now = Date.now();
    tree.del.push({ id: n.id, at: now });
    for (const e of tree.edges) if (e.a === n.id || e.b === n.id) tree.del.push({ id: ekey(e), at: now });
    tree.nodes = tree.nodes.filter((x) => x.id !== n.id);
    tree.edges = tree.edges.filter((e) => e.a !== n.id && e.b !== n.id);
    picked.delete(n.id);
    selectedId = null;
    render(); touch();
}

function onFieldInput() {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n) return;
    if (n.t !== $('f-title').value || n.b !== $('f-body').value) remember('text:' + n.id);
    n.t = $('f-title').value; n.b = $('f-body').value;
    $('f-meta').textContent = n.b ? `${n.b.length} תווים` : '';
    renderNodes(); renderWires(); touch(n);
}

// Deleting puts the bubble in the bin with its lines; it can come back for
// 30 days. The tombstones still go in — they are what stops a stale device
// from bringing the bubble back on its own, and a restore beats them because
// it is a newer change.
function deleteNodes(ids) {
    const set = new Set(ids);
    const now = Date.now();
    const gone = tree.nodes.filter((n) => set.has(n.id));
    if (!gone.length) return 0;
    const mine = tree.edges.filter((e) => set.has(e.a) || set.has(e.b));
    tree.trash = [...gone.map((n) => ({ ...n, edges: mine.filter((e) => e.a === n.id || e.b === n.id).map((e) => ({ a: e.a, b: e.b, k: e.k, ...(e.d ? { d: e.d } : {}) })), dAt: now })), ...(tree.trash || [])];
    for (const n of gone) tree.del.push({ id: n.id, at: now });
    for (const e of mine) tree.del.push({ id: ekey(e), at: now });
    tree.nodes = tree.nodes.filter((n) => !set.has(n.id));
    tree.edges = tree.edges.filter((e) => !set.has(e.a) && !set.has(e.b));
    for (const id of set) picked.delete(id);
    if (selectedId && set.has(selectedId)) { selectedId = null; $('sheet').classList.remove('open'); }
    render(); touch();
    return gone.length;
}
function deleteSelected() {
    if (!selectedId) return;
    remember();
    if (deleteNodes([selectedId])) toast('הועבר לסל המחזור');
}

function restoreFromTrash(id) {
    const i = (tree.trash || []).findIndex((x) => x.id === id);
    if (i < 0) return;
    const x = tree.trash[i];
    const now = Date.now();
    const { edges, dAt, ...node } = x;
    const back = { ...node, u: now, p: tree.pages.some((p) => p.id === node.p) ? node.p : '' };
    tree.nodes.push(back);
    for (const e of edges || []) {
        if (!tree.nodes.some((q) => q.id === e.a) || !tree.nodes.some((q) => q.id === e.b)) continue;
        if (tree.edges.some((q) => (q.a === e.a && q.b === e.b) || (q.a === e.b && q.b === e.a))) continue;
        tree.edges.push({ a: e.a, b: e.b, k: e.k === 'x' ? 'x' : 'in', u: now });
    }
    tree.trash.splice(i, 1);
    render(); touch(); renderTrash();
    toast('שוחזר');
}
function restoreFromTrashRemembered(id) { remember(); restoreFromTrash(id); }

async function purgeFromTrash(id) {
    const i = (tree.trash || []).findIndex((x) => x.id === id);
    if (i < 0) return;
    const x = tree.trash[i];
    if (!(await askConfirm(`למחוק לצמיתות את "${x.t || 'ללא כותרת'}"? אין דרך חזרה.`, 'מחק'))) return;
    // Its recordings and pictures go with it.
    if (cloudKey) for (const g of x.imgs || []) {
        try { await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(x.id) + '&img=' + encodeURIComponent(g.id), { method: 'DELETE' }); } catch { /* harmless */ }
    }
    if (cloudKey) for (const r of x.recs || []) {
        try { await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(x.id) + '&rec=' + encodeURIComponent(r.id), { method: 'DELETE' }); } catch { /* the blob will outlive its bubble — harmless */ }
    }
    // The purge leaves a tombstone, or the other device's copy of the bin
    // brings the entry straight back on the next sync (Stav: "זה לא נותן לי לרוקן").
    tree.del.push({ id: 'trash:' + x.id, at: Date.now() });
    tree.trash.splice(i, 1);
    touch(); renderTrash();
}

async function emptyTrash() {
    if (!(tree.trash || []).length) return;
    if (!(await askConfirm(`לרוקן את הסל? ${tree.trash.length} תובנות יימחקו לצמיתות.`, 'רוקן'))) return;
    for (const x of tree.trash) if (cloudKey) for (const r of x.recs || []) {
        try { await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(x.id) + '&rec=' + encodeURIComponent(r.id), { method: 'DELETE' }); } catch { /* see above */ }
    }
    const now = Date.now();
    for (const x of tree.trash) tree.del.push({ id: 'trash:' + x.id, at: now });
    tree.trash = [];
    touch(); renderTrash();
    toast('הסל רוקן');
}

function ago(ts) {
    const d = Math.max(0, Date.now() - ts), h = Math.floor(d / 3600000), days = Math.floor(h / 24);
    if (days >= 1) return days === 1 ? 'אתמול' : `לפני ${days} ימים`;
    if (h >= 1) return `לפני ${h} שע'`;
    return 'עכשיו';
}

function toggleTrash() {
    const el = $('trash'); if (!el) return;
    el.hidden = !el.hidden;
    if (!el.hidden) { closeSheet(); renderTrash(); }
}
function renderTrash() {
    const el = $('trash'), list = $('trash-list'), btn = $('btn-trash');
    const items = tree.trash || [];
    if (btn) btn.textContent = items.length ? `🗑 ${items.length}` : '🗑';
    if (!el || el.hidden) return;
    list.innerHTML = items.length ? items.map((x) => `
        <div class="trash-row">
            <span class="swatch" data-c="${x.c || 0}"></span>
            <div class="trash-text">
                <div class="trash-title">${escapeHtml(x.t.trim() || 'ללא כותרת')}</div>
                <div class="trash-meta">${ago(x.dAt)}${x.p && pageName(x.p) ? ' · ' + escapeHtml(pageName(x.p)) : ''}${(x.recs || []).length ? ' · 🎙' + x.recs.length : ''}</div>
            </div>
            <button type="button" class="btn small" onclick="restoreFromTrashRemembered('${x.id}')">שחזר</button>
            <button type="button" class="btn quiet small danger" onclick="purgeFromTrash('${x.id}')">מחק</button>
        </div>`).join('') : '<div class="trash-empty">הסל ריק. תובנה שנמחקת מחכה כאן 30 יום.</div>';
    $('btn-empty-trash').hidden = !items.length;
}

// A tapped line lights up and shows one button at its middle: מחק. No
// dialog — on a phone the line is thin and the question was the annoying
// part. Tapping the ground puts the button away.
function edgeBar() { return $('edge-bar') || $('edge-del'); }
function hideEdgeBar() { const b = edgeBar(); if (b) b.hidden = true; }
function selectEdge(e) {
    closeIfEmpty();
    selectedEdge = e; selectedId = null;
    $('sheet').classList.remove('open');
    renderNodes(); renderWires();
    placeEdgeButton();
}
const DIR_LABEL = { '': 'ללא חץ', ab: 'חץ קדימה', ba: 'חץ אחורה', both: 'דו-כיווני' };
function placeEdgeButton() {
    const bar = edgeBar(); if (!bar) return;
    const e = selectedEdge;
    const a = e && tree.nodes.find((n) => n.id === e.a), b = e && tree.nodes.find((n) => n.id === e.b);
    if (!a || !b) { bar.hidden = true; return; }
    const pa = pos(a), pb = pos(b);
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    bar.style.left = (mx * view.k + view.x) + 'px';
    bar.style.top = (my * view.k + view.y) + 'px';
    const edge = tree.edges.find((x) => x.a === e.a && x.b === e.b);
    const db = $('edge-dir'); if (db) db.textContent = DIR_LABEL[(edge && edge.d) || ''];
    bar.hidden = false;
}
// Stav: "חצים עם כיוון — הלוך, חזור או דו". Tapping the button walks the
// line through none → forward → back → both.
function cycleEdgeDir() {
    const e = selectedEdge; if (!e) return;
    const edge = tree.edges.find((x) => x.a === e.a && x.b === e.b); if (!edge) return;
    remember();
    const order = ['', 'ab', 'ba', 'both'];
    const next = order[(order.indexOf(edge.d || '') + 1) % order.length];
    if (next) edge.d = next; else delete edge.d;
    edge.u = Date.now();
    renderWires(); placeEdgeButton(); touch();
}
function deleteSelectedEdge() {
    const e = selectedEdge; if (!e) return;
    remember();
    tree.del.push({ id: ekey(e), at: Date.now() });
    tree.edges = tree.edges.filter((x) => !(x.a === e.a && x.b === e.b));
    selectedEdge = null; hideEdgeBar();
    renderWires(); touch();
    toast('הקו נמחק');
}

// ---------- creating ----------

// Where a new bubble lives: in the open tab; in "הכל", with the selected
// bubble's page if one is selected (so a tree continues in its own tab),
// otherwise page-less.
function addNodeAt(wx, wy) {
    const parent = tree.nodes.find((x) => x.id === selectedId);
    const p = tab !== 'all' ? tab : (parent ? parent.p : '');
    const o = off(p);
    remember();
    const n = { id: uid(), t: '', b: '', x: Math.round(wx - o.x), y: Math.round(wy - o.y), u: Date.now(), c: parent ? (parent.c || 0) : 0, p, recs: [] };
    tree.nodes.push(n);
    render(); touch(n);
    select(n.id);
    setTimeout(() => $('f-title').focus(), 50);
}
function addNodeAtCenter() {
    const c = toWorld(stage.clientWidth / 2, stage.clientHeight / 2 - 40);
    addNodeAt(c.x + (Math.random() - 0.5) * 60, c.y + (Math.random() - 0.5) * 60);
}

// A line from a to b. An assigning line pulls a page-less bubble (and its
// tree) into a's page; between two different pages it can only cross.
function connect(a, b) {
    if (!a || !b || a === b) return;
    if (tree.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) { toast('כבר מחובר'); return; }
    const na = tree.nodes.find((n) => n.id === a), nb = tree.nodes.find((n) => n.id === b);
    remember();
    let kind = tab === 'all' ? linkKind : 'in';
    if (kind === 'in' && na && nb && na.p !== nb.p) {
        const pull = (src, dst) => {   // src's tree moves into dst's page, staying where it sits on screen
            const os = off(src.p), od = off(dst.p);
            const now = Date.now();
            for (const id of componentOf(src.id)) {
                const n = tree.nodes.find((x) => x.id === id); if (!n) continue;
                n.x = Math.round(n.x + os.x - od.x); n.y = Math.round(n.y + os.y - od.y); n.p = dst.p; n.u = now;
            }
            toast('עבר ל"' + pageName(dst.p) + '"');
        };
        if (!nb.p && na.p) pull(nb, na);
        else if (!na.p && nb.p) pull(na, nb);
        else { kind = 'x'; toast('שתי לשוניות שונות — הקו חוצה, לא מעביר'); }
    }
    tree.edges.push({ a, b, u: Date.now(), k: kind });
    render(); touch();
}

// "חבר ל…" from the sheet: the next bubble you tap gets the line.
let linkFrom = null;
function startLinkFromSheet() {
    if (!selectedId) return;
    linkFrom = selectedId;
    $('sheet').classList.remove('open');
    toast('לחץ על התובנה שאליה לחבר');
}

// Colour is a way of grouping, chosen in the sheet or the legend. A bubble
// created while another is selected inherits its colour.
function renderSwatches(cur, cur2) {
    const box = $('f-colors'); if (!box) return;
    box.innerHTML = LEGEND.map((l) =>
        `<button type="button" class="swatch${l.c === cur ? ' on' : ''}" data-c="${l.c}" onclick="setColor(${l.c})" title="${escapeHtml(legendName(l.c))}" aria-label="${escapeHtml(legendName(l.c))}"></button>`).join('');
    const nm = $('f-color-name'); if (nm) nm.textContent = legendName(cur) + (cur2 ? ' + ' + legendName(cur2) : '');
    // Stav (4.9.2026): "שיהיה אפשר לבחור 2 צבעים למשהו" — a second row, with
    // "none" first; the bubble is painted half and half.
    const box2 = $('f-colors2'); if (!box2) return;
    box2.innerHTML = `<button type="button" class="swatch none${cur2 ? '' : ' on'}" onclick="setColor2(0)" title="בלי צבע שני" aria-label="בלי צבע שני"></button>` +
        LEGEND.filter((l) => l.c !== 0).map((l) =>
            `<button type="button" class="swatch${l.c === cur2 ? ' on' : ''}${l.c === cur ? ' same' : ''}" data-c="${l.c}" onclick="setColor2(${l.c})" title="${escapeHtml(legendName(l.c))}" aria-label="${escapeHtml(legendName(l.c))}"></button>`).join('');
}
function setColor(i) {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n) return;
    remember();
    n.c = i;
    if (n.c2 === i) delete n.c2;
    renderSwatches(i, n.c2 || 0); renderNodes(); renderWires(); touch(n);
}
function setColor2(i) {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n) return;
    remember();
    // A white bubble given a second colour simply takes it: half white is no colour.
    if (i >= 1 && i <= 7 && !(n.c || 0)) { n.c = i; delete n.c2; }
    else if (i >= 1 && i <= 7 && i !== (n.c || 0)) n.c2 = i; else delete n.c2;
    renderSwatches(n.c || 0, n.c2 || 0); renderNodes(); touch(n);
}
// Stav: "בלון גדול יותר למקרה שהוא משהו חשוב שמוביל להרבה דברים" — wider,
// bolder; the text size stays, as he asked.
function toggleBig() {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n) return;
    remember();
    if (n.s === 'L') delete n.s; else n.s = 'L';
    const bb = $('btn-big'); if (bb) bb.classList.toggle('on', n.s === 'L');
    renderNodes(); renderWires(); touch(n);
}

// The label of a bubble with no title: the first few words of its body, or
// of its first transcript — so an untitled note still says what it is.
function firstWords(n) {
    const src = (n.b || '').trim() || (((n.recs || [])[0] || {}).tx || '').trim();
    if (!src) return '';
    const words = src.replace(/\s+/g, ' ').split(' ').filter(Boolean);
    const cut = words.slice(0, 5).join(' ').replace(/[.,;:!?]+$/, '');
    return words.length > 5 ? cut + '…' : cut;
}

// ---------- colour every bubble by what it says ----------

let lastPaint = null;

async function paintAll() {
    if (!cloudKey) { toast('הצביעה צריכה ענן — פתח את הכתובת המלאה פעם אחת'); return; }
    const ns = visibleNodes().filter((n) => (n.t + n.b + ((n.recs || []).map((r) => r.tx || '').join(' '))).trim().length >= 3);
    if (!ns.length) { toast('אין פתקים עם טקסט לצבוע'); return; }
    if (!confirm(`לצבוע ${ns.length} פתקים לפי המקרא? אפשר לבטל מיד אחרי.`)) return;
    const btn = $('btn-paint'); if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
        const items = ns.map((n) => ({ id: n.id, text: [n.t, n.b, ((n.recs || [])[0] || {}).tx || ''].filter(Boolean).join(' — ').slice(0, 600) }));
        const legend = LEGEND.map((l) => ({ c: l.c, name: legendName(l.c), hint: l.hint }));
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&paint=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, legend }) });
        const body = await res.json();
        if (!res.ok) { toast((body.error && body.error.message) || 'הצביעה לא הצליחה'); return; }
        remember();
        lastPaint = ns.map((n) => ({ id: n.id, c: n.c || 0 }));
        const now = Date.now(); let changed = 0;
        for (const r of body.colors || []) { const n = tree.nodes.find((x) => x.id === r.id); if (n && n.c !== r.c) { n.c = r.c; n.u = now; changed++; } }
        render(); touch();
        toast(changed ? `נצבעו ${changed} פתקים` : 'הכל כבר בצבע הנכון', { action: changed ? 'בטל' : null, onAction: undoPaint });
    } catch { toast('הצביעה לא הצליחה'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '🎨'; } }
}
function undoPaint() {
    if (!lastPaint) return;
    const now = Date.now();
    for (const p of lastPaint) { const n = tree.nodes.find((x) => x.id === p.id); if (n) { n.c = p.c; n.u = now; } }
    lastPaint = null; render(); touch(); toast('הצבעים חזרו');
}

// ---------- pictures ----------

function imgUrl(id) { return '/api/thing?k=' + encodeURIComponent(cloudKey) + '&img=' + encodeURIComponent(id); }

function renderImgs(n) {
    const box = $('f-imgs'); if (!box) return;
    const imgs = (n && n.imgs) || [];
    box.innerHTML = imgs.map((g) => `
        <div class="pic">
            <img src="${imgUrl(g.id)}" alt="" loading="lazy" onclick="openPic('${g.id}')">
            <button type="button" class="pic-x" onclick="deleteImg('${g.id}')" aria-label="מחק תמונה">✕</button>
        </div>`).join('');
}

// A photo from the phone is 3-5 MB; the bubble needs a picture, not a file.
// Drawn onto a canvas at 1280px on the long side, saved as JPEG — a few
// hundred kilobytes, the same picture to the eye.
async function shrinkImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const MAX = 1280; const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
        return { blob, w, h };
    } finally { URL.revokeObjectURL(url); }
}

function pickImage() {
    if (!selectedId) return;
    if (!cloudKey) { toast('תמונות נשמרות בענן — פתח את הכתובת המלאה פעם אחת'); return; }
    if (!navigator.onLine) { toast('אין קליטה — תמונות עולות רק עם קליטה'); return; }
    const inp = $('f-img-input'); inp.value = ''; inp.click();
}

async function onImagePicked(inp) {
    const file = inp.files && inp.files[0]; if (!file || !selectedId) return;
    const nodeId = selectedId;
    setSync('מעלה תמונה…', false);
    try {
        const { blob, w, h } = await shrinkImage(file);
        await cloudSave();
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&img=1&node=' + encodeURIComponent(nodeId) + '&w=' + w + '&h=' + h, {
            method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
        });
        const body = await res.json();
        if (!res.ok) { setSync('לא נשמר', false); toast((body.error && body.error.message) || 'התמונה לא נשמרה'); return; }
        const n = tree.nodes.find((x) => x.id === nodeId);
        if (n) { n.imgs = [...(n.imgs || []), body.img]; n.u = Date.now(); localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)); }
        if (selectedId === nodeId) renderImgs(n);
        renderNodes();
        setSync('מסונכרן', true); toast('התמונה נשמרה');
    } catch { setSync('לא מקוון', false); toast('התמונה לא הועלתה'); }
}

async function deleteImg(id) {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n || !confirm('למחוק את התמונה?')) return;
    try { await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(n.id) + '&img=' + encodeURIComponent(id), { method: 'DELETE' }); } catch { /* corrected on the next merge */ }
    n.imgs = (n.imgs || []).filter((g) => g.id !== id); n.u = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    renderImgs(n); renderNodes();
}

function openPic(id) { const lb = $('lightbox'); lb.querySelector('img').src = imgUrl(id); lb.hidden = false; }
function closePic() { const lb = $('lightbox'); lb.hidden = true; lb.querySelector('img').src = ''; }

// ---------- a title from the words ----------

function bubbleText(n) {
    return [n.b || '', ...((n.recs || []).map((r) => r.tx || ''))].filter((t) => t.trim()).join('\n');
}

async function autoTitle(nodeId, opts) {
    const n = tree.nodes.find((x) => x.id === nodeId);
    if (!n || !cloudKey) return;
    const text = bubbleText(n);
    if (text.trim().length < 3) { if (!(opts && opts.quiet)) toast('אין עדיין טקסט להוציא ממנו כותרת'); return; }
    const btn = $('btn-title'); if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&title=1&node=' + encodeURIComponent(nodeId), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
        });
        const body = await res.json();
        if (!res.ok) { if (!(opts && opts.quiet)) toast((body.error && body.error.message) || 'לא יצאה כותרת'); return; }
        n.t = body.title; n.u = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
        if (selectedId === nodeId) $('f-title').value = n.t;
        renderNodes(); renderWires();
    } catch { if (!(opts && opts.quiet)) toast('לא יצאה כותרת'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '✨'; } }
}

// ---------- search ----------

// Hebrew as people type it: no niqqud, no punctuation, one kind of quote, one
// space. A match is a plain substring of that, in the title, the body or any
// transcript — across every page, whichever tab is open.
function norm(s) {
    return String(s || '').toLowerCase()
        .replace(/[\u0591-\u05C7]/g, '')            // niqqud and cantillation
        .replace(/[״"“”]/g, '"').replace(/[׳'‘’]/g, "'")
        .replace(/[^\p{L}\p{N}\s'"]/gu, ' ')
        .replace(/\s+/g, ' ').trim();
}
function bubbleHaystack(n) { return norm([n.t, n.b, ...((n.recs || []).map((r) => r.tx || ''))].join(' \n ')); }
function matches(n) { return !query || bubbleHaystack(n).includes(query); }

function openSearch() {
    document.querySelector('.top').classList.add('searching');
    const q = $('q'); q.hidden = false; q.focus();
}
function closeSearch() {
    query = ''; hitIndex = -1;
    const q = $('q'); if (q) q.value = '';
    $('results').hidden = true;
    document.querySelector('.top').classList.remove('searching');
    renderNodes(); renderWires();
}

function onSearchInput() {
    query = norm($('q').value);
    hitIndex = -1;
    renderNodes(); renderWires();
    const box = $('results');
    if (!query) { box.hidden = true; return; }
    const hits = tree.nodes.filter(matches).slice(0, 40);
    box.hidden = false;
    box.innerHTML = hits.length ? hits.map((n, i) => `
        <button type="button" class="hit" data-id="${n.id}" onclick="goTo('${n.id}')">
            <div class="hit-title"><span class="swatch" data-c="${n.c || 0}"></span>${hl(n.t.trim() || 'ללא כותרת')}<span class="hit-page">${escapeHtml(n.p ? pageName(n.p) : 'כללי')}</span></div>
            ${snippet(n)}
        </button>`).join('') : '<div class="hit-none">אין תובנה עם המילים האלה</div>';
}

// The matched words lit inside the text, on the raw text (not the normalized
// one), so what is shown is what was written.
function hl(text) {
    const t = String(text || '');
    if (!query) return escapeHtml(t);
    const words = query.split(' ').filter((w) => w.length > 1);
    let out = escapeHtml(t);
    for (const w of words) {
        const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        out = out.replace(re, '<mark>$1</mark>');
    }
    return out;
}
function snippet(n) {
    const src = [n.b, ...((n.recs || []).map((r) => r.tx || ''))].join(' ');
    if (!src.trim()) return '';
    const low = norm(src);
    const at = low.indexOf(query.split(' ')[0] || '');
    const start = Math.max(0, at - 40);
    const piece = (start > 0 ? '…' : '') + src.slice(start, start + 140) + (start + 140 < src.length ? '…' : '');
    return `<div class="hit-snip">${hl(piece)}</div>`;
}

function onSearchKey(ev) {
    const hits = [...document.querySelectorAll('#results .hit')];
    if (ev.key === 'Escape') { closeSearch(); $('q').blur(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!hits.length) return;
        hitIndex = (hitIndex + (ev.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        hits.forEach((h, i) => h.classList.toggle('on', i === hitIndex));
        hits[hitIndex].scrollIntoView({ block: 'nearest' });
    }
    if (ev.key === 'Enter') {
        ev.preventDefault();
        const h = hits[hitIndex >= 0 ? hitIndex : 0];
        if (h) goTo(h.dataset.id);
    }
}

// Jump to a bubble: its page's tab if we are inside another page, then the
// bubble centred on screen and open. The search stays lit so the next result
// is one tap away.
function goTo(id) {
    const n = tree.nodes.find((x) => x.id === id); if (!n) return;
    if (tab !== 'all' && n.p !== tab) setTab(n.p || 'all');
    computeOffsets();
    const p = pos(n);
    if (view.k < 0.6) view.k = 1;
    centerOn(p.x, p.y);
    select(id);
    $('results').hidden = true;
}

// ---------- choosing many ----------

// Every bubble reachable from one by lines of either kind.
function connectedTo(id) {
    const seen = new Set([id]); const q = [id];
    while (q.length) {
        const cur = q.pop();
        for (const e of tree.edges) {
            const other = e.a === cur ? e.b : (e.b === cur ? e.a : null);
            if (other && !seen.has(other)) { seen.add(other); q.push(other); }
        }
    }
    return seen;
}

// From the sheet: "בחר את העץ" — the open bubble and everything tied to it.
function pickTree() {
    if (!selectedId) return;
    picked = new Set(connectedTo(selectedId));
    closeSheet(); render();
    toast(`${picked.size} נבחרו — גרור אחת, כולן זזות`);
}

function toggleMarquee() {
    marqueeMode = !marqueeMode;
    $('btn-marquee').classList.toggle('on', marqueeMode);
    stage.classList.toggle('marquee-mode', marqueeMode);
    toast(marqueeMode ? 'גרור על הרקע כדי לבחור' : 'חזרה לגרירה רגילה');
}

function clearPicked() { picked = new Set(); render(); }

function deletePicked() {
    const ids = idsInHand(); if (!ids.length) return;
    remember();
    const n = deleteNodes(ids);
    if (n) toast(n === 1 ? 'הועבר לסל המחזור' : `${n} הועברו לסל המחזור`);
}

// ---------- theme ----------

function applyTheme(t) {
    document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
    const b = $('btn-theme'); if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next); applyTheme(next);
}

// ---------- voice notes ----------

let recorder = null, recChunks = [], recStart = 0, recTimer = null;

function recUrl(id) { return '/api/thing?k=' + encodeURIComponent(cloudKey) + '&rec=' + encodeURIComponent(id); }
function fmtDur(sec) { const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }

function renderRecs(n) {
    const box = $('f-recs'); if (!box) return;
    const recs = (n && n.recs) || [];
    const waiting = n ? pendingCache.filter((p) => p.nodeId === n.id) : [];
    const pendingHtml = waiting.map((p) => `
        <div class="rec pending">
            <audio controls preload="none" src="${URL.createObjectURL(p.blob)}"></audio>
            <div class="rec-meta">${fmtDur(p.dur || 0)} · ממתין לקליטה — יעלה ויתומלל לבד</div>
        </div>`).join('');
    box.innerHTML = pendingHtml + recs.map((r) => `
        <div class="rec" data-id="${r.id}">
            <audio controls preload="none" src="${recUrl(r.id)}"></audio>
            <div class="rec-meta">${fmtDur(r.d || 0)} · ${Math.round((r.n || 0) / 1024)}KB
                <button type="button" class="btn quiet small" onclick="deleteRec('${r.id}')">מחק</button></div>
            ${r.tx ? `<div class="rec-tx">${escapeHtml(r.tx)}</div>` : '<div class="rec-tx muted">בלי תמלול</div>'}
        </div>`).join('');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function toggleRecord() {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    if (!selectedId) return;
    if (!cloudKey) { toast('הקלטות נשמרות בענן — פתח את הכתובת המלאה פעם אחת'); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('הדפדפן הזה לא מקליט'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('אין גישה למיקרופון'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    recChunks = []; recStart = Date.now();
    const nodeId = selectedId;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recTimer);
        const btn = $('btn-rec'); if (btn) { btn.classList.remove('live'); btn.textContent = '🎙 הקלט'; }
        const blob = new Blob(recChunks, { type: recorder.mimeType || mime || 'audio/webm' });
        recorder = null;
        if (blob.size < 1000) { toast('ההקלטה קצרה מדי'); return; }
        await uploadRec(nodeId, blob, Math.round((Date.now() - recStart) / 1000));
    };
    recorder.start(1000);
    const btn = $('btn-rec'); if (btn) { btn.classList.add('live'); btn.textContent = '■ עצור 0:00'; }
    recTimer = setInterval(() => { const b = $('btn-rec'); if (b) b.textContent = '■ עצור ' + fmtDur(Math.round((Date.now() - recStart) / 1000)); }, 1000);
}

// ---------- the queue for notes recorded without signal ----------

function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbAll() {
    try { const db = await idb(); return await new Promise((res, rej) => { const r = db.transaction(DB_STORE).objectStore(DB_STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); }
    catch { return []; }
}
async function idbPut(item) { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(DB_STORE, 'readwrite'); t.objectStore(DB_STORE).put(item); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbDel(id) { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(DB_STORE, 'readwrite'); t.objectStore(DB_STORE).delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); }); }

let pendingCache = [];
async function refreshPending() { pendingCache = await idbAll(); }

let flushing = false;
async function flushPending() {
    if (flushing || !cloudKey || !navigator.onLine) return;
    flushing = true;
    try {
        const items = await idbAll();
        for (const it of items) {
            const ok = await uploadRec(it.nodeId, it.blob, it.dur, { fromQueue: true });
            if (ok) await idbDel(it.id); else break;
        }
    } finally { flushing = false; await refreshPending(); if (selectedId) renderRecs(tree.nodes.find((x) => x.id === selectedId)); }
}

async function uploadRec(nodeId, blob, dur, opts) {
    if (!navigator.onLine) {
        if (!(opts && opts.fromQueue)) {
            await idbPut({ id: uid(), nodeId, blob, dur, at: Date.now() });
            await refreshPending();
            if (selectedId === nodeId) renderRecs(tree.nodes.find((x) => x.id === nodeId));
            toast('אין קליטה — ההקלטה שמורה בטלפון ותעלה כשתחזור');
        }
        return false;
    }
    await cloudSave();
    setSync('מעלה הקלטה…', false);
    try {
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(nodeId) + '&dur=' + dur, {
            method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob,
        });
        const body = await res.json();
        if (!res.ok) { setSync('לא נשמר', false); toast((body.error && body.error.message) || 'ההקלטה לא נשמרה'); return false; }
        const n = tree.nodes.find((x) => x.id === nodeId);
        if (n) { n.recs = [...(n.recs || []), body.rec]; n.u = Date.now(); localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)); }
        if (selectedId === nodeId) renderRecs(n);
        renderNodes();
        setSync('מסונכרן', true);
        toast(body.rec.tx ? 'נשמר ותומלל' : 'נשמר (בלי תמלול)');
        if (n && !n.t.trim() && body.rec.tx) autoTitle(nodeId, { quiet: true });
        return true;
    } catch {
        if (!(opts && opts.fromQueue)) { await idbPut({ id: uid(), nodeId, blob, dur, at: Date.now() }); await refreshPending(); if (selectedId === nodeId) renderRecs(tree.nodes.find((x) => x.id === nodeId)); }
        setSync('לא מקוון', false); toast('אין קליטה — ההקלטה שמורה בטלפון ותעלה כשתחזור');
        return false;
    }
}

async function deleteRec(id) {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n || !confirm('למחוק את ההקלטה?')) return;
    try {
        await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(n.id) + '&rec=' + encodeURIComponent(id), { method: 'DELETE' });
    } catch { /* corrected on the next merge either way */ }
    n.recs = (n.recs || []).filter((r) => r.id !== id); n.u = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    renderRecs(n); renderNodes();
}

// ---------- input ----------

const pointers = new Map();
let gesture = null;
let lastTap = 0, lastTapX = 0, lastTapY = 0;

function bindStage() {
    stage.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.bubble') || ev.target.closest('.cluster')) return;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pointers.size === 2) { gesture = pinchStart(); return; }
        try { stage.setPointerCapture(ev.pointerId); } catch { /* a pointer that is already gone must not kill the gesture */ }
        // Shift on a computer, or the 🔲 mode on a phone: the drag is a box.
        if (ev.shiftKey || marqueeMode) {
            gesture = { type: 'marquee', sx: ev.clientX, sy: ev.clientY, add: ev.ctrlKey || ev.metaKey };
            const m = $('marquee'); m.hidden = false; m.style.left = ev.clientX + 'px'; m.style.top = ev.clientY + 'px'; m.style.width = '0px'; m.style.height = '0px';
            return;
        }
        gesture = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
        stage.classList.add('panning');
    });
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    // No dblclick listener: the double tap is recognised from the pointer
    // events below, on mouse and finger alike. Having both made two bubbles
    // per double-click on a computer (Stav, 4.9.2026).
    window.addEventListener('resize', applyView);
    document.addEventListener('keydown', (ev) => {
        const typing = ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.isContentEditable);
        const mod = ev.ctrlKey || ev.metaKey;
        if (ev.key === 'Escape') { linkFrom = null; closeSheet(); hideEdgeBar(); selectedEdge = null; renderWires(); if (picked.size) clearPicked(); }
        if (typing) return;   // inside a field the browser's own undo/copy apply
        const k = ev.key.toLowerCase();
        if (mod && k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
        if (mod && ((k === 'z' && ev.shiftKey) || k === 'y')) { ev.preventDefault(); redo(); return; }
        if (mod && k === 'c') { if (idsInHand().length) { ev.preventDefault(); copyPicked(); } return; }
        if (mod && k === 'x') { if (idsInHand().length) { ev.preventDefault(); cutPicked(); } return; }
        if (mod && k === 'v') { ev.preventDefault(); pasteClipboard(); return; }
        if (mod && k === 'd') { if (idsInHand().length) { ev.preventDefault(); duplicatePicked(); } return; }
        if (mod && k === 'a') { ev.preventDefault(); picked = new Set(visibleNodes().map((n) => n.id)); render(); return; }
        if ((ev.key === 'Delete' || ev.key === 'Backspace') && idsInHand().length) { ev.preventDefault(); if (picked.size) deletePicked(); else deleteSelected(); return; }
        const step = ev.shiftKey ? 50 : 10;
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); nudgePicked(-step, 0); }
        if (ev.key === 'ArrowRight') { ev.preventDefault(); nudgePicked(step, 0); }
        if (ev.key === 'ArrowUp') { ev.preventDefault(); nudgePicked(0, -step); }
        if (ev.key === 'ArrowDown') { ev.preventDefault(); nudgePicked(0, step); }
    });
}

function bindNode(el) {
    el.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        const id = el.dataset.id;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        try { el.setPointerCapture(ev.pointerId); } catch { /* same */ }
        const n = tree.nodes.find((x) => x.id === id);
        if (ev.target.closest('.knob')) {
            gesture = { type: 'link', from: id, el, sx: ev.clientX, sy: ev.clientY, over: null };
            return;
        }
        // Ctrl (or ⌘) on a bubble: its whole connected tree comes along.
        if ((ev.ctrlKey || ev.metaKey) && !picked.has(id)) { picked = new Set(connectedTo(id)); render(); }
        const group = picked.has(id) ? [...picked].map((pid) => { const q = tree.nodes.find((x) => x.id === pid); return q && { id: pid, x: q.x, y: q.y }; }).filter(Boolean) : null;
        gesture = { type: 'node', id, el, sx: ev.clientX, sy: ev.clientY, nx: n.x, ny: n.y, moved: false, group };
    });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
}

function onMove(ev) {
    if (!gesture) return;
    const p = pointers.get(ev.pointerId);
    if (p) { p.x = ev.clientX; p.y = ev.clientY; }
    if (gesture.type === 'pinch') { pinchMove(); return; }
    const dx = ev.clientX - gesture.sx, dy = ev.clientY - gesture.sy;
    if (gesture.type === 'marquee') {
        const m = $('marquee');
        m.style.left = Math.min(gesture.sx, ev.clientX) + 'px'; m.style.top = Math.min(gesture.sy, ev.clientY) + 'px';
        m.style.width = Math.abs(dx) + 'px'; m.style.height = Math.abs(dy) + 'px';
        return;
    }
    if (gesture.type === 'pan') {
        if (Math.hypot(dx, dy) > 4) gesture.moved = true;
        view.x = gesture.vx + dx; view.y = gesture.vy + dy; applyView();
    } else if (gesture.type === 'node') {
        if (Math.hypot(dx, dy) > 4 && !gesture.moved) { remember(); gesture.moved = true; gesture.el.classList.add('drag'); }
        if (!gesture.moved) return;
        if (gesture.group) {
            for (const g0 of gesture.group) {
                const m = tree.nodes.find((x) => x.id === g0.id); if (!m) continue;
                m.x = Math.round(g0.x + dx / view.k); m.y = Math.round(g0.y + dy / view.k);
            }
            renderNodes(); renderWires();
            return;
        }
        const n = tree.nodes.find((x) => x.id === gesture.id);
        n.x = Math.round(gesture.nx + dx / view.k); n.y = Math.round(gesture.ny + dy / view.k);
        const q = pos(n);
        gesture.el.style.left = q.x + 'px'; gesture.el.style.top = q.y + 'px';
        renderWires();
    } else if (gesture.type === 'link') {
        const from = tree.nodes.find((x) => x.id === gesture.from);
        const pf = pos(from);
        const w = toWorld(ev.clientX, ev.clientY);
        const ghost = $('ghost'); if (ghost) { ghost.setAttribute('d', `M${pf.x},${pf.y} L${w.x},${w.y}`); ghost.classList.toggle('cross', tab === 'all' && linkKind === 'x'); }
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = under && under.closest('.bubble');
        const overId = target && target.dataset.id !== gesture.from ? target.dataset.id : null;
        if (overId !== gesture.over) {
            nodesEl.querySelectorAll('.target').forEach((x) => x.classList.remove('target'));
            if (overId) target.classList.add('target');
            gesture.over = overId;
        }
    }
}

function onUp(ev) {
    pointers.delete(ev.pointerId);
    if (!gesture) return;
    const g = gesture;
    if (g.type === 'pinch') { if (pointers.size < 2) gesture = null; return; }
    gesture = null;
    stage.classList.remove('panning');
    if (g.type === 'marquee') {
        $('marquee').hidden = true;
        const x0 = Math.min(g.sx, ev.clientX), x1 = Math.max(g.sx, ev.clientX), y0 = Math.min(g.sy, ev.clientY), y1 = Math.max(g.sy, ev.clientY);
        if (!g.add) picked = new Set();
        if (x1 - x0 > 4 && y1 - y0 > 4) {
            for (const n of visibleNodes()) {
                const p = pos(n), sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
                if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) picked.add(n.id);
            }
        }
        render();
        if (picked.size) toast(`${picked.size} נבחרו — גרור אחת, כולן זזות`);
        return;
    }
    if (g.type === 'pan') {
        saveView();
        if (!g.moved) {
            const now = Date.now();
            if (now - lastTap < 350 && Math.hypot(ev.clientX - lastTapX, ev.clientY - lastTapY) < 30) { const w = toWorld(ev.clientX, ev.clientY); addNodeAt(w.x, w.y); lastTap = 0; return; }
            lastTap = now; lastTapX = ev.clientX; lastTapY = ev.clientY;
            linkFrom = null; closeSheet(); $('results').hidden = true;
            if (selectedEdge) { selectedEdge = null; hideEdgeBar(); renderWires(); }
            if (picked.size) { picked = new Set(); render(); }
        }
    } else if (g.type === 'node') {
        g.el.classList.remove('drag');
        if (g.moved) {
            if (g.group) { const now = Date.now(); for (const g0 of g.group) { const q = tree.nodes.find((x) => x.id === g0.id); if (q) q.u = now; } touch(); }
            else touch(tree.nodes.find((x) => x.id === g.id));
            renderClusterLabels();
            return;
        }
        if (linkFrom) { connect(linkFrom, g.id); linkFrom = null; return; }
        select(g.id);
    } else if (g.type === 'link') {
        const ghost = $('ghost'); if (ghost) ghost.setAttribute('d', '');
        nodesEl.querySelectorAll('.target').forEach((x) => x.classList.remove('target'));
        if (g.over) connect(g.from, g.over);
    }
}

function pinchStart() {
    const [a, b] = [...pointers.values()];
    return { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), k0: view.k, w: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2) };
}
function pinchMove() {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.k0 * (d / gesture.d0)));
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    view.k = k; view.x = cx - gesture.w.x * k; view.y = cy - gesture.w.y * k;
    applyView();
}

// ---------- small things ----------

let toastTimer = null;
function toast(msg, opts) {
    const el = $('toast'); el.textContent = msg;
    if (opts && opts.action && opts.onAction) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = opts.action;
        b.onclick = () => { el.classList.remove('show'); opts.onAction(); };
        el.appendChild(b);
    }
    el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), opts && opts.action ? 8000 : 1800);
}
