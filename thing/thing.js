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

let tree = { nodes: [], edges: [], del: [], pages: [], updatedAt: 0 };
let view = { x: 0, y: 0, k: 1 };
let tab = 'all';            // 'all' or a page id
let linkKind = 'in';        // the kind of line the knob draws in "הכל"
let selectedId = null;
let selectedEdge = null;
let cloudKey = null;
let saveTimer = null;
let cloudTimer = null;
let offsets = { '': { x: 0, y: 0 } };   // page id → shift applied in "הכל"

const $ = (id) => document.getElementById(id);
const stage = $('stage'), world = $('world'), wires = $('wires'), nodesEl = $('nodes');

// ---------- boot ----------

init();

function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
    tree = normalize(safeParse(localStorage.getItem(STORAGE_KEY)));
    cloudKey = keyFromAddress() || localStorage.getItem(KEY_KEY) || null;
    if (cloudKey) localStorage.setItem(KEY_KEY, cloudKey);
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
    if (cloudKey) cloudLoad();
    bindStage();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/thing/sw.js').catch(() => {});
    window.addEventListener('online', () => { if (cloudKey) { cloudSave().then(flushPending); } });
    if (navigator.onLine && cloudKey) setTimeout(flushPending, 2500);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cloudKey) cloudLoad(); });
}

function keyFromAddress() {
    const m = (location.hash || '').match(/[#&]k=([A-Za-z0-9_-]{32,64})/);
    return m ? m[1] : null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function normalize(t) {
    const n = t && typeof t === 'object' ? t : {};
    const pages = (Array.isArray(n.pages) ? n.pages : []).filter((p) => p && p.id).map((p) => ({ id: String(p.id), name: String(p.name || ''), u: Number(p.u) || 0 }));
    const pageIds = new Set(pages.map((p) => p.id));
    const nodes = (Array.isArray(n.nodes) ? n.nodes : []).filter((x) => x && x.id).map((x) => ({
        id: String(x.id), t: String(x.t || ''), b: String(x.b || ''), x: Number(x.x) || 0, y: Number(x.y) || 0, u: Number(x.u) || 0,
        c: Math.min(7, Math.max(0, Number(x.c) || 0)),
        p: pageIds.has(String(x.p || '')) ? String(x.p) : '',
        recs: (Array.isArray(x.recs) ? x.recs : []).filter((r) => r && r.id),
    }));
    const ids = new Set(nodes.map((x) => x.id));
    const edges = (Array.isArray(n.edges) ? n.edges : []).filter((e) => e && ids.has(e.a) && ids.has(e.b) && e.a !== e.b)
        .map((e) => ({ a: e.a, b: e.b, u: Number(e.u) || 0, k: e.k === 'x' ? 'x' : 'in' }));
    const del = (Array.isArray(n.del) ? n.del : []).filter((d) => d && d.id).map((d) => ({ id: String(d.id), at: Number(d.at) || 0 }));
    return { nodes, edges, del, pages, updatedAt: Number(n.updatedAt) || 0 };
}

// ---------- persistence ----------

function touch(changed) {
    const now = Date.now();
    if (changed) changed.u = now;
    tree.updatedAt = now;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)), 150);
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudSave, 1200);
    setSync(cloudKey ? 'שומר…' : 'מקומי בלבד', false);
}

function saveView() { localStorage.setItem(STORAGE_KEY + ':view:' + tab, JSON.stringify(view)); }

function setSync(text, ok) {
    const el = $('sync'); if (!el) return;
    el.textContent = text; el.classList.toggle('on', !!ok);
}

// Whatever comes back from the server is the merged truth: it already holds
// everything this device sent plus everything the other one did.
function adopt(merged) {
    if (!merged) return;
    tree = normalize(merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    if (tab !== 'all' && !tree.pages.some((p) => p.id === tab)) { tab = 'all'; localStorage.setItem(TAB_KEY, tab); }
    render();
    if (selectedId && !tree.nodes.some((n) => n.id === selectedId)) closeSheet();
}

async function cloudLoad() {
    if (!cloudKey) return;
    try {
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey));
        if (res.status === 404) { setSync('כתובת לא מוכרת', false); return; }
        const body = await res.json();
        if (!res.ok) { setSync('לא מקוון', false); return; }
        if (tree.nodes.length || tree.del.length || tree.pages.length || (body.tree && body.tree.nodes && body.tree.nodes.length)) await cloudSave();
        else setSync('מסונכרן', true);
    } catch { setSync('לא מקוון', false); }
}

async function cloudSave() {
    if (!cloudKey) return;
    try {
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tree }),
        });
        const body = await res.json();
        if (!res.ok) { setSync('לא נשמר', false); toast((body.error && body.error.message) || 'לא נשמר'); return; }
        adopt(body.tree);
        setSync('מסונכרן', true);
    } catch { setSync('לא מקוון', false); }
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
        + tree.pages.map((p) => chip(p.id, p.name || 'לשונית', `ondblclick="renamePage('${p.id}')" title="לחיצה כפולה לשינוי שם"`)).join('')
        + `<button type="button" class="tab add" onclick="addPage()" title="לשונית חדשה">＋</button>`;
    const tools = $('tab-tools'); if (!tools) return;
    if (tab === 'all') {
        tools.innerHTML = `<button type="button" class="btn small" id="btn-linkkind" onclick="toggleLinkKind()" title="איזה קו הנקודה הכחולה מותחת">${linkKind === 'in' ? 'קו: משייך ללשונית' : 'קו: חוצה'}</button>`;
    } else {
        tools.innerHTML = `<button type="button" class="btn quiet small" onclick="renamePage('${tab}')">שם</button><button type="button" class="btn quiet small" onclick="deletePage('${tab}')">מחק לשונית</button>`;
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

function visibleNodes() { return tab === 'all' ? tree.nodes : tree.nodes.filter((n) => n.p === tab); }
function visibleEdges() {
    if (tab === 'all') return tree.edges;
    const ids = new Set(visibleNodes().map((n) => n.id));
    return tree.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
}

function computeOffsets() {
    offsets = {};
    if (tab !== 'all') { offsets[tab] = { x: 0, y: 0 }; return; }
    const groups = ['', ...tree.pages.map((p) => p.id)];
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
    const g = Math.max(14, 28 * view.k);
    stage.style.backgroundSize = `${g}px ${g}px`;
    stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
}
function toWorld(sx, sy) { return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k }; }
function centerOn(wx, wy) {
    view.x = stage.clientWidth / 2 - wx * view.k;
    view.y = stage.clientHeight / 2 - wy * view.k;
    applyView(); saveView();
}
function zoomAt(sx, sy, factor) {
    const k = Math.min(3, Math.max(0.15, view.k * factor));
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
    const k = Math.min(2, Math.max(0.15, Math.min(stage.clientWidth / (maxX - minX), stage.clientHeight / (maxY - minY))));
    view.k = k;
    centerOn((minX + maxX) / 2, (minY + maxY) / 2);
}

// ---------- rendering ----------

function render() {
    computeOffsets();
    renderTabs();
    renderNodes();
    renderWires();
    applyView();
    const ns = visibleNodes(), es = visibleEdges();
    $('count').textContent = ns.length ? `${ns.length} תובנות · ${es.length} קווים` : (tab === 'all' ? 'עדיין ריק' : 'לשונית ריקה');
    $('hint').hidden = ns.length > 0;
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
        const title = n.t.trim() || 'ללא כותרת';
        if (label.textContent !== title) label.textContent = title;
        el.classList.toggle('long', title.length > 28);
        el.classList.toggle('has-body', !!n.b.trim());
        el.classList.toggle('has-rec', !!(n.recs && n.recs.length));
        el.classList.toggle('sel', n.id === selectedId);
        el.dataset.c = n.c || 0;
        el.title = (LEGEND_BY_C[n.c] || LEGEND[0]).name + (tab === 'all' && n.p ? ' · ' + pageName(n.p) : '');
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
    for (const g of ['', ...tree.pages.map((p) => p.id)]) {
        const ns = tree.nodes.filter((n) => n.p === g);
        if (!ns.length && g === '') continue;
        const o = off(g);
        const minX = ns.length ? Math.min(...ns.map((n) => n.x)) : 0;
        const minY = ns.length ? Math.min(...ns.map((n) => n.y)) : 0;
        const el = document.createElement('div');
        el.className = 'cluster';
        el.textContent = g ? pageName(g) : 'כללי';
        el.style.left = (minX + o.x - 120) + 'px'; el.style.top = (minY + o.y - 70) + 'px';
        el.onclick = () => { if (g) setTab(g); };
        nodesEl.appendChild(el);
    }
}

function renderWires() {
    const parts = [];
    for (const e of visibleEdges()) {
        const a = tree.nodes.find((n) => n.id === e.a), b = tree.nodes.find((n) => n.id === e.b);
        if (!a || !b) continue;
        const pa = pos(a), pb = pos(b);
        const d = `M${pa.x},${pa.y} L${pb.x},${pb.y}`;
        const sel = selectedEdge && selectedEdge.a === e.a && selectedEdge.b === e.b;
        const c = a.c || b.c || 0;
        parts.push(`<path class="wire${sel ? ' sel' : ''}${e.k === 'x' ? ' cross' : ''}" data-c="${c}" d="${d}"/><path class="wire-hit" data-a="${e.a}" data-b="${e.b}" d="${d}"/>`);
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
    box.innerHTML = LEGEND.map((l) => `
        <button type="button" class="legend-row" data-c="${l.c}" onclick="legendPick(${l.c})" title="${escapeHtml(l.hint)}">
            <span class="swatch" data-c="${l.c}"></span><span class="legend-name">${escapeHtml(l.name)}</span>
        </button>`).join('');
}
function legendPick(c) {
    if (selectedId) { setColor(c); toast('נצבע: ' + LEGEND_BY_C[c].name); }
    else toast(LEGEND_BY_C[c].name + ' — ' + LEGEND_BY_C[c].hint);
}
function toggleLegend() { $('legend').classList.toggle('open'); }

// ---------- selection & the sheet ----------

function select(id) {
    selectedId = id; selectedEdge = null;
    renderNodes(); renderWires();
    const n = tree.nodes.find((x) => x.id === id);
    if (!n) { closeSheet(); return; }
    $('f-title').value = n.t; $('f-body').value = n.b;
    $('f-meta').textContent = n.b ? `${n.b.length} תווים` : '';
    renderSwatches(n.c || 0);
    renderPageSelect(n);
    renderRecs(n);
    $('sheet').classList.add('open');
}

function closeSheet() {
    $('sheet').classList.remove('open');
    selectedId = null; renderNodes();
    document.activeElement && document.activeElement.blur();
}

function onFieldInput() {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n) return;
    n.t = $('f-title').value; n.b = $('f-body').value;
    $('f-meta').textContent = n.b ? `${n.b.length} תווים` : '';
    renderNodes(); renderWires(); touch(n);
}

function deleteSelected() {
    if (!selectedId) return;
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!confirm(`למחוק את "${(n && n.t) || 'ללא כותרת'}"? הקווים שלה יימחקו איתה.`)) return;
    const now = Date.now();
    tree.del.push({ id: selectedId, at: now });
    for (const e of tree.edges) if (e.a === selectedId || e.b === selectedId) tree.del.push({ id: [e.a, e.b].sort().join('|'), at: now });
    tree.nodes = tree.nodes.filter((x) => x.id !== selectedId);
    tree.edges = tree.edges.filter((e) => e.a !== selectedId && e.b !== selectedId);
    closeSheet(); render(); touch();
}

function selectEdge(e) {
    selectedEdge = e; selectedId = null;
    $('sheet').classList.remove('open');
    renderNodes(); renderWires();
    const a = tree.nodes.find((n) => n.id === e.a), b = tree.nodes.find((n) => n.id === e.b);
    if (confirm(`למחוק את הקו בין "${a ? a.t : ''}" ל-"${b ? b.t : ''}"?`)) {
        tree.del.push({ id: [e.a, e.b].sort().join('|'), at: Date.now() });
        tree.edges = tree.edges.filter((x) => !(x.a === e.a && x.b === e.b));
        touch();
    }
    selectedEdge = null; renderWires();
}

// ---------- creating ----------

// Where a new bubble lives: in the open tab; in "הכל", with the selected
// bubble's page if one is selected (so a tree continues in its own tab),
// otherwise page-less.
function addNodeAt(wx, wy) {
    const parent = tree.nodes.find((x) => x.id === selectedId);
    const p = tab !== 'all' ? tab : (parent ? parent.p : '');
    const o = off(p);
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
function renderSwatches(cur) {
    const box = $('f-colors'); if (!box) return;
    box.innerHTML = LEGEND.map((l) =>
        `<button type="button" class="swatch${l.c === cur ? ' on' : ''}" data-c="${l.c}" onclick="setColor(${l.c})" title="${escapeHtml(l.name)}" aria-label="${escapeHtml(l.name)}"></button>`).join('');
    const nm = $('f-color-name'); if (nm) nm.textContent = (LEGEND_BY_C[cur] || LEGEND[0]).name;
}
function setColor(i) {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n) return;
    n.c = i;
    renderSwatches(i); renderNodes(); renderWires(); touch(n);
}

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
let lastTap = 0;

function bindStage() {
    stage.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.bubble') || ev.target.closest('.cluster')) return;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pointers.size === 2) { gesture = pinchStart(); return; }
        stage.setPointerCapture(ev.pointerId);
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
    stage.addEventListener('dblclick', (ev) => {
        if (ev.target.closest('.bubble') || ev.target.closest('.cluster')) return;
        const w = toWorld(ev.clientX, ev.clientY);
        addNodeAt(w.x, w.y);
    });
    window.addEventListener('resize', applyView);
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { linkFrom = null; closeSheet(); }
    });
}

function bindNode(el) {
    el.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        const id = el.dataset.id;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        el.setPointerCapture(ev.pointerId);
        const n = tree.nodes.find((x) => x.id === id);
        if (ev.target.closest('.knob')) {
            gesture = { type: 'link', from: id, el, sx: ev.clientX, sy: ev.clientY, over: null };
            return;
        }
        gesture = { type: 'node', id, el, sx: ev.clientX, sy: ev.clientY, nx: n.x, ny: n.y, moved: false };
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
    if (gesture.type === 'pan') {
        if (Math.hypot(dx, dy) > 4) gesture.moved = true;
        view.x = gesture.vx + dx; view.y = gesture.vy + dy; applyView();
    } else if (gesture.type === 'node') {
        if (Math.hypot(dx, dy) > 4 && !gesture.moved) { gesture.moved = true; gesture.el.classList.add('drag'); }
        if (!gesture.moved) return;
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
    if (g.type === 'pan') {
        saveView();
        if (!g.moved) {
            const now = Date.now();
            if (now - lastTap < 350) { const w = toWorld(ev.clientX, ev.clientY); addNodeAt(w.x, w.y); lastTap = 0; return; }
            lastTap = now;
            linkFrom = null; closeSheet();
        }
    } else if (g.type === 'node') {
        g.el.classList.remove('drag');
        if (g.moved) { touch(tree.nodes.find((x) => x.id === g.id)); renderClusterLabels(); return; }
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
    const k = Math.min(3, Math.max(0.15, gesture.k0 * (d / gesture.d0)));
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    view.k = k; view.x = cx - gesture.w.x * k; view.y = cy - gesture.w.y * k;
    applyView();
}

// ---------- small things ----------

let toastTimer = null;
function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
