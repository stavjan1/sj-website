// The "עוזר" screen — friends who are electricians write what they charge.
//
// One list, one number per row, and the others' numbers appear under a row
// only once yours is on it (the server decides that, not this file). Kept
// deliberately small: Stav, 2.9.2026 — "תעשה את המינימום ונזרום".

let helperState = { items: [], mine: {}, others: {}, loaded: false };

function helperEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function helperFmt(n) { return Number(n).toLocaleString('he-IL'); }

// Whether the signed-in account is a helper. Runs after login; a 403 is the
// normal answer for almost everyone and simply keeps the rail button hidden.
//
// Two things this must NOT do. It must not ask the server about the admin —
// the admin is a helper by definition and isAdmin() is a local check, so a
// lapsed Google hour would otherwise hide the button from the one account
// that always has it. And a missing token is not a "no": it is "not yet", so
// the answer is retried a few times instead of being remembered as a refusal.
let helperAccessRetries = 0;
async function refreshHelperAccess() {
    const btn = document.getElementById('tab-helper-rail');
    if (!btn) return;
    const guest = typeof isGuestUser === 'function' ? isGuestUser() : true;
    if (guest || typeof adminRes !== 'function') { btn.hidden = true; return; }
    if (typeof isAdmin === 'function' && isAdmin()) { btn.hidden = false; return; }
    try {
        const res = await adminRes('/api/helper-prices');
        btn.hidden = !res.ok;
        if (res.ok) {
            const data = await res.json();
            helperState = { items: data.items || [], mine: data.mine || {}, others: data.others || {}, loaded: true };
        }
        helperAccessRetries = 0;
    } catch (e) {
        if (e && e.code === 'NO_TOKEN' && helperAccessRetries < 4) {
            helperAccessRetries++;
            setTimeout(refreshHelperAccess, 25000);
        }
    }
}

async function renderHelperPanel(force) {
    const root = document.getElementById('helper-list');
    if (!root) return;
    if (!helperState.loaded || force) {
        root.innerHTML = '<p class="input-help">טוען…</p>';
        try {
            const res = await adminRes('/api/helper-prices');
            const data = await res.json();
            if (!res.ok) { root.innerHTML = '<p class="input-help">' + helperEsc((data.error && data.error.message) || 'אין גישה.') + '</p>'; return; }
            helperState = { items: data.items || [], mine: data.mine || {}, others: data.others || {}, loaded: true };
        } catch (e) {
            // A helper who is not the admin never sees the admin strip, so this
            // is his one way back in. Same reconnect as the strip's button —
            // adminSignInNow — not a second implementation of it.
            root.innerHTML = (e && e.code === 'NO_TOKEN' && typeof adminSignInNow === 'function')
                ? `<div class="admin-auth"><p>צריך אישור מגוגל כדי לטעון את הרשימה.</p>
                     <button type="button" class="btn btn-accent btn-small" onclick="adminSignInNow(this)">התחבר מחדש</button></div>`
                : '<p class="input-help">לא הצלחתי לטעון. התחבר שוב לגוגל ונסה שוב.</p>';
            return;
        }
    }
    const q = (document.getElementById('helper-q') || {}).value || '';
    const needle = q.trim();
    const rows = helperState.items.filter((it) => !needle || it.name.includes(needle));
    const done = Object.keys(helperState.mine).length;
    const counter = document.getElementById('helper-progress');
    if (counter) counter.textContent = done + ' מתוך ' + helperState.items.length + ' סעיפים עם המחיר שלך';
    root.innerHTML = rows.map(helperRow).join('') || '<p class="input-help">לא נמצא סעיף כזה — תוסיף אותו למטה.</p>';
}

function helperRow(it) {
    const mine = helperState.mine[it.id];
    const others = helperState.others[it.id];
    return `
    <div class="helper-row${mine ? ' has-price' : ''}" id="helper-row-${helperEsc(it.id)}">
        <div class="helper-row-name">${helperEsc(it.name)} <span class="helper-unit">${helperEsc(it.unit)}</span></div>
        <div class="helper-row-input">
            <input type="number" inputmode="numeric" min="1" step="1" class="model-select-input" style="width:110px"
                   value="${mine ? helperEsc(mine.price) : ''}" placeholder="₪"
                   id="helper-price-${helperEsc(it.id)}"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();saveHelperPrice('${helperEsc(it.id)}')}">
            <button type="button" class="btn btn-small ${mine ? 'btn-secondary' : 'btn-accent'}" onclick="saveHelperPrice('${helperEsc(it.id)}')">${mine ? 'עדכן' : 'שמור'}</button>
        </div>
        <div class="helper-row-others" id="helper-others-${helperEsc(it.id)}">${helperOthersText(mine, others)}</div>
    </div>`;
}

// The line under a priced row. Wording is the product's, not a statistic's.
function helperOthersText(mine, others) {
    if (!mine) return '';
    if (!others || !others.n) return '<span class="input-help">אתה הראשון שתמחר את זה. כשעוד עוזרים ירשמו — תראה אותם כאן.</span>';
    if (others.n === 1) return `<span class="input-help">עוזר אחד נוסף רשם <b>${helperFmt(others.median)} ₪</b>.</span>`;
    return `<span class="input-help">עוד ${others.n} עוזרים: <b>${helperFmt(others.low)}–${helperFmt(others.high)} ₪</b>, באמצע ${helperFmt(others.median)} ₪.</span>`;
}

async function saveHelperPrice(itemId) {
    const input = document.getElementById('helper-price-' + itemId);
    const price = Math.round(Number(input && input.value));
    if (!price || price <= 0) { showToast('תרשום מחיר.', 'error'); return; }
    try {
        const res = await adminRes('/api/helper-prices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, price }),
        });
        const data = await res.json();
        if (!res.ok) { showToast((data.error && data.error.message) || 'לא נשמר.', 'error'); return; }
        helperState.mine[itemId] = data.mine;
        if (data.others) helperState.others[itemId] = data.others; else delete helperState.others[itemId];
        const row = document.getElementById('helper-row-' + itemId);
        if (row) row.outerHTML = helperRow(helperState.items.find((x) => x.id === itemId));
        const counter = document.getElementById('helper-progress');
        if (counter) counter.textContent = Object.keys(helperState.mine).length + ' מתוך ' + helperState.items.length + ' סעיפים עם המחיר שלך';
        showToast('נשמר.', 'success');
    } catch (e) {
        showToast('לא נשמר — התחבר שוב לגוגל.', 'error');
    }
}

async function addHelperItem() {
    const nameEl = document.getElementById('helper-new-name');
    const unitEl = document.getElementById('helper-new-unit');
    const name = (nameEl && nameEl.value || '').trim();
    const unit = (unitEl && unitEl.value || "יח'").trim();
    if (name.length < 2) { showToast('תן שם לסעיף.', 'error'); return; }
    try {
        const res = await adminRes('/api/helper-prices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ add: { name, unit } }),
        });
        const data = await res.json();
        if (!res.ok) { showToast((data.error && data.error.message) || 'לא נוסף.', 'error'); return; }
        helperState.items = data.items || helperState.items;
        if (nameEl) nameEl.value = '';
        renderHelperPanel();
        showToast('הסעיף נוסף — עכשיו תרשום לו מחיר.', 'success');
        const input = document.getElementById('helper-price-' + data.item.id);
        if (input) input.focus();
    } catch (e) {
        showToast('לא נוסף — התחבר שוב לגוגל.', 'error');
    }
}

// ── Admin: who is a helper, and what everyone wrote ─────────────────────────

async function renderAdminHelpers() {
    const body = document.getElementById('admin-helpers-body');
    if (!body || typeof isAdmin !== 'function' || !isAdmin()) return;
    body.innerHTML = '<p class="input-help">טוען…</p>';
    let data;
    try {
        const res = await adminRes('/api/helper-prices?admin=1');
        data = await res.json();
        if (!res.ok) { body.innerHTML = '<p class="input-help">' + helperEsc((data.error && data.error.message) || 'שגיאה') + '</p>'; return; }
    } catch (e) {
        body.innerHTML = '<p class="input-help">לא נטען.</p>';
        return;
    }
    const helpers = data.helpers || [];
    const prices = data.prices || {};
    const items = data.items || [];
    const byId = Object.fromEntries(items.map((it) => [it.id, it]));
    const list = helpers.length
        ? helpers.map((em) => `<li>${helperEsc(em)} <span class="input-help">· ${Object.keys(prices[em] || {}).length} מחירים</span>
            <button type="button" class="btn btn-small btn-secondary" onclick="setHelper('${helperEsc(em)}', false)">הסר</button></li>`).join('')
        : '<li class="input-help">עדיין אין עוזרים.</li>';
    // Every price, attributed — this is the admin's view, the only place names appear.
    const rows = [];
    for (const [em, ps] of Object.entries(prices)) {
        for (const [id, p] of Object.entries(ps || {})) {
            rows.push({ em, name: (byId[id] || {}).name || id, unit: (byId[id] || {}).unit || '', price: p.price, at: p.at });
        }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, 'he') || a.em.localeCompare(b.em));
    const table = rows.length
        ? `<table style="width:100%;font-size:var(--fs-sm);border-collapse:collapse"><thead><tr><th style="text-align:right">סעיף</th><th style="text-align:right">מי</th><th style="text-align:left">₪</th></tr></thead><tbody>`
          + rows.map((r) => `<tr><td>${helperEsc(r.name)} <span class="input-help">${helperEsc(r.unit)}</span></td><td>${helperEsc(r.em.split('@')[0])}</td><td style="text-align:left">${helperFmt(r.price)}</td></tr>`).join('')
          + '</tbody></table>'
        : '<p class="input-help">עוד לא נרשם אף מחיר.</p>';
    body.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
            <input type="email" id="admin-helper-email" class="model-select-input" placeholder="מייל של חבר (חשבון גוגל)" style="flex:1;min-width:220px">
            <button type="button" class="btn btn-small btn-accent" onclick="setHelper(null, true)">הוסף עוזר</button>
        </div>
        <ul style="margin:0 0 14px;padding-inline-start:18px;line-height:2">${list}</ul>
        ${table}`;
}

async function setHelper(email, on) {
    const em = email || ((document.getElementById('admin-helper-email') || {}).value || '').trim();
    if (!em) { showToast('תכתוב מייל.', 'error'); return; }
    try {
        const res = await adminRes('/api/helper-prices', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: em, on: !!on }),
        });
        const data = await res.json();
        if (!res.ok) { showToast((data.error && data.error.message) || 'לא נשמר.', 'error'); return; }
        showToast(on ? 'נוסף. הוא יראה "עוזר" בסרגל אחרי התחברות.' : 'הוסר.', 'success');
        renderAdminHelpers();
    } catch (e) {
        showToast('לא נשמר — התחבר שוב לגוגל.', 'error');
    }
}

window.refreshHelperAccess = refreshHelperAccess;
window.renderHelperPanel = renderHelperPanel;
window.saveHelperPrice = saveHelperPrice;
window.addHelperItem = addHelperItem;
window.renderAdminHelpers = renderAdminHelpers;
window.setHelper = setHelper;
