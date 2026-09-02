// עץ התובנות — a plane of bubbles and the lines between them.
//
// Stav's spec (2.9.2026): put a box on the screen with a title and a body;
// out in the world the boxes show only their titles, as bubbles sized to the
// title; stretch lines between insights and delete them; walk around.
//
// And no login. The address is the key: /thing/#k=<long random key>. The
// first visit keeps the key on the device, so the plain /thing/ opens it from
// then on; a device that has never seen the key sees an empty, local-only
// tree and says so. Nothing is ever deleted by a failed sync — the tree is in
// localStorage first, and the server merges bubble by bubble (see
// functions/api/thing.js).
//
// Everything lives in world units. The screen shows the world through one
// transform (pan + zoom) applied to #world. Pointer events do all the input,
// so a finger and a mouse are the same thing here.

const STORAGE_KEY = 'sj_thing_v1';
const KEY_KEY = 'sj_thing_key';
const THEME_KEY = 'sj_thing_theme';

let tree = { nodes: [], edges: [], del: [], updatedAt: 0 };
let view = { x: 0, y: 0, k: 1 };
let selectedId = null;
let selectedEdge = null;
let cloudKey = null;
let saveTimer = null;
let cloudTimer = null;

const $ = (id) => document.getElementById(id);
const stage = $('stage'), world = $('world'), wires = $('wires'), nodesEl = $('nodes');

// ---------- boot ----------

init();

function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
    tree = normalize(safeParse(localStorage.getItem(STORAGE_KEY)));
    cloudKey = keyFromAddress() || localStorage.getItem(KEY_KEY) || null;
    if (cloudKey) localStorage.setItem(KEY_KEY, cloudKey);
    const v = safeParse(localStorage.getItem(STORAGE_KEY + ':view'));
    if (v && Number.isFinite(v.k) && v.k > 0) view = v;
    else centerOn(0, 0);
    render();
    if (!tree.nodes.length) fitAll();
    setSync(cloudKey ? 'מתחבר…' : 'מקומי בלבד', false);
    if (cloudKey) cloudLoad();
    bindStage();
    // Sync again whenever the page comes back into view — the phone in the
    // pocket, the tab left open on the desk.
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
    const nodes = (Array.isArray(n.nodes) ? n.nodes : []).filter((x) => x && x.id).map((x) => ({
        id: String(x.id), t: String(x.t || ''), b: String(x.b || ''), x: Number(x.x) || 0, y: Number(x.y) || 0, u: Number(x.u) || 0, c: Math.min(7, Math.max(0, Number(x.c) || 0)),
        recs: (Array.isArray(x.recs) ? x.recs : []).filter((r) => r && r.id),
    }));
    const ids = new Set(nodes.map((x) => x.id));
    const edges = (Array.isArray(n.edges) ? n.edges : []).filter((e) => e && ids.has(e.a) && ids.has(e.b) && e.a !== e.b)
        .map((e) => ({ a: e.a, b: e.b, u: Number(e.u) || 0 }));
    const del = (Array.isArray(n.del) ? n.del : []).filter((d) => d && d.id).map((d) => ({ id: String(d.id), at: Number(d.at) || 0 }));
    return { nodes, edges, del, updatedAt: Number(n.updatedAt) || 0 };
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

function saveView() {
    localStorage.setItem(STORAGE_KEY + ':view', JSON.stringify(view));
}

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
        // The server's copy and ours may each hold something the other lacks;
        // a PUT merges them and returns the union. Sending is how we read.
        if (tree.nodes.length || tree.del.length || (body.tree && body.tree.nodes && body.tree.nodes.length)) await cloudSave();
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
    const k = Math.min(3, Math.max(0.25, view.k * factor));
    const w = toWorld(sx, sy);
    view.k = k;
    view.x = sx - w.x * k; view.y = sy - w.y * k;
    applyView(); saveView();
}
function zoomBy(f) { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, f); }
function fitAll() {
    if (!tree.nodes.length) { view.k = 1; centerOn(0, 0); return; }
    const xs = tree.nodes.map((n) => n.x), ys = tree.nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 140, maxX = Math.max(...xs) + 140;
    const minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 120;
    const k = Math.min(2, Math.max(0.25, Math.min(stage.clientWidth / (maxX - minX), stage.clientHeight / (maxY - minY))));
    view.k = k;
    centerOn((minX + maxX) / 2, (minY + maxY) / 2);
}

// ---------- rendering ----------

function render() {
    renderNodes();
    renderWires();
    applyView();
    $('count').textContent = tree.nodes.length ? `${tree.nodes.length} תובנות · ${tree.edges.length} קווים` : 'עדיין ריק';
    $('hint').hidden = tree.nodes.length > 0;
}

function renderNodes() {
    const byId = new Map([...nodesEl.children].map((el) => [el.dataset.id, el]));
    const keep = new Set();
    for (const n of tree.nodes) {
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
        el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    }
    for (const [id, el] of byId) if (!keep.has(id)) el.remove();
}

// A line runs centre to centre and the bubbles simply sit on top of it; the
// stroke under a bubble is hidden by the bubble. Simpler than clipping, and
// what a pen would do.
function renderWires() {
    const parts = [];
    for (const e of tree.edges) {
        const a = tree.nodes.find((n) => n.id === e.a), b = tree.nodes.find((n) => n.id === e.b);
        if (!a || !b) continue;
        const d = `M${a.x},${a.y} L${b.x},${b.y}`;
        const sel = selectedEdge && selectedEdge.a === e.a && selectedEdge.b === e.b;
        const c = a.c || b.c || 0;
        parts.push(`<path class="wire${sel ? ' sel' : ''}" data-c="${c}" d="${d}"/><path class="wire-hit" data-a="${e.a}" data-b="${e.b}" d="${d}"/>`);
    }
    wires.innerHTML = parts.join('') + '<path id="ghost" class="wire ghost" d=""/>';
    wires.setAttribute('width', '1'); wires.setAttribute('height', '1');
    wires.querySelectorAll('.wire-hit').forEach((p) => p.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        selectEdge({ a: p.dataset.a, b: p.dataset.b });
    }));
}

// ---------- selection & the sheet ----------

function select(id) {
    selectedId = id; selectedEdge = null;
    renderNodes(); renderWires();
    const n = tree.nodes.find((x) => x.id === id);
    if (!n) { closeSheet(); return; }
    $('f-title').value = n.t; $('f-body').value = n.b;
    $('f-meta').textContent = n.b ? `${n.b.length} תווים` : '';
    renderSwatches(n.c || 0);
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

function addNodeAt(wx, wy) {
    const parent = tree.nodes.find((x) => x.id === selectedId);
    const n = { id: uid(), t: '', b: '', x: Math.round(wx), y: Math.round(wy), u: Date.now(), c: parent ? (parent.c || 0) : 0 };
    tree.nodes.push(n);
    render(); touch(n);
    select(n.id);
    setTimeout(() => $('f-title').focus(), 50);
}
function addNodeAtCenter() {
    const c = toWorld(stage.clientWidth / 2, stage.clientHeight / 2 - 40);
    addNodeAt(c.x + (Math.random() - 0.5) * 60, c.y + (Math.random() - 0.5) * 60);
}

function connect(a, b) {
    if (!a || !b || a === b) return;
    if (tree.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) { toast('כבר מחובר'); return; }
    const e = { a, b, u: Date.now() };
    tree.edges.push(e);
    renderWires(); touch();
}

// Colour is a way of grouping, chosen in the sheet. A bubble created while
// another is selected inherits its colour, so a cluster colours itself.
function renderSwatches(cur) {
    const box = $('f-colors'); if (!box) return;
    box.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        `<button type="button" class="swatch${i === cur ? ' on' : ''}" data-c="${i}" onclick="setColor(${i})" aria-label="צבע ${i}"></button>`).join('');
}
function setColor(i) {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n) return;
    n.c = i;
    renderSwatches(i); renderNodes(); renderWires(); touch(n);
}

// "חבר ל…" from the sheet: the next bubble you tap gets the line.
let linkFrom = null;
function startLinkFromSheet() {
    if (!selectedId) return;
    linkFrom = selectedId;
    $('sheet').classList.remove('open');
    toast('לחץ על התובנה שאליה לחבר');
}

// ---------- input ----------

// One pointer = pan or drag; two pointers = pinch zoom.
const pointers = new Map();
let gesture = null;   // { type: 'pan'|'node'|'link'|'pinch', ... }
let lastTap = 0;

function bindStage() {
    stage.addEventListener('pointerdown', (ev) => {
        if (ev.target.closest('.bubble')) return;
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
        if (ev.target.closest('.bubble')) return;
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
        gesture.el.style.left = n.x + 'px'; gesture.el.style.top = n.y + 'px';
        renderWires();
    } else if (gesture.type === 'link') {
        const from = tree.nodes.find((x) => x.id === gesture.from);
        const w = toWorld(ev.clientX, ev.clientY);
        const ghost = $('ghost'); if (ghost) ghost.setAttribute('d', `M${from.x},${from.y} L${w.x},${w.y}`);
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
        if (g.moved) { touch(tree.nodes.find((x) => x.id === g.id)); return; }
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
    const k = Math.min(3, Math.max(0.25, gesture.k0 * (d / gesture.d0)));
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    view.k = k; view.x = cx - gesture.w.x * k; view.y = cy - gesture.w.y * k;
    applyView();
}

// ---------- theme ----------

// Day is the default (Stav: "תעשה גם את הרקע שיהיה מצב יום"); the moon flips
// it and the choice sticks to the device.
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
    box.innerHTML = recs.map((r) => `
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

async function uploadRec(nodeId, blob, dur) {
    // The bubble must already be in the cloud before a note can hang on it.
    await cloudSave();
    setSync('מעלה הקלטה…', false);
    try {
        const res = await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(nodeId) + '&dur=' + dur, {
            method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob,
        });
        const body = await res.json();
        if (!res.ok) { setSync('לא נשמר', false); toast((body.error && body.error.message) || 'ההקלטה לא נשמרה'); return; }
        const n = tree.nodes.find((x) => x.id === nodeId);
        if (n) { n.recs = [...(n.recs || []), body.rec]; n.u = Date.now(); localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)); }
        if (selectedId === nodeId) renderRecs(n);
        renderNodes();
        setSync('מסונכרן', true);
        toast(body.rec.tx ? 'נשמר ותומלל' : 'נשמר (בלי תמלול)');
        if (n && !n.t.trim() && body.rec.tx) autoTitle(nodeId, { quiet: true });
    } catch { setSync('לא מקוון', false); toast('ההקלטה לא הועלתה'); }
}

async function deleteRec(id) {
    const n = tree.nodes.find((x) => x.id === selectedId);
    if (!n || !confirm('למחוק את ההקלטה?')) return;
    try {
        await fetch('/api/thing?k=' + encodeURIComponent(cloudKey) + '&node=' + encodeURIComponent(n.id) + '&rec=' + encodeURIComponent(id), { method: 'DELETE' });
    } catch { /* the list below is corrected on the next merge either way */ }
    n.recs = (n.recs || []).filter((r) => r.id !== id); n.u = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    renderRecs(n); renderNodes();
}

// ---------- a title from the words ----------

// Everything the bubble says, body first, then every transcript.
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

// ---------- small things ----------

let toastTimer = null;
function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
