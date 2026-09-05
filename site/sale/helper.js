// The "עוזר" screen — friends who are electricians write what they charge.
//
// One list, one number per row, and the others' numbers appear under a row
// only once yours is on it (the server decides that, not this file). Kept
// deliberately small: Stav, 2.9.2026 — "תעשה את המינימום ונזרום".

let helperState = { items: [], groups: [], mine: {}, others: {}, loaded: false, denied: false };
// True when the address that opened the app asked for this screen (/help →
// /sale/?panel=helper): the panel opens by itself after sign-in, and a friend
// who is not a helper yet gets a card that says how to become one instead of
// nothing at all.
function helperRequested() { try { return new URLSearchParams(location.search).get('panel') === 'helper'; } catch (e) { return false; } }

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
    const btn = document.getElementById('tab-helper');
    if (!btn) return;
    const guest = typeof isGuestUser === 'function' ? isGuestUser() : true;
    if (guest || typeof adminRes !== 'function') { btn.hidden = true; return; }
    if (typeof isAdmin === 'function' && isAdmin()) { btn.hidden = false; return; }
    try {
        const res = await adminRes('/api/helper-prices');
        btn.hidden = !res.ok;
        helperState.denied = res.status === 403;
        if (res.ok) {
            const data = await res.json();
            helperState = { items: data.items || [], groups: data.groups || [], mine: data.mine || {}, others: data.others || {}, loaded: true, denied: false };
        }
        helperAccessRetries = 0;
        if (helperRequested() && typeof switchTab === 'function' && !document.getElementById('panel-helper').classList.contains('active')) switchTab('helper');
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
            if (res.status === 403) { root.innerHTML = helperRequestCard(); return; }
            if (!res.ok) { root.innerHTML = '<p class="input-help">' + helperEsc((data.error && data.error.message) || 'אין גישה.') + '</p>'; return; }
            helperState = { items: data.items || [], groups: data.groups || [], mine: data.mine || {}, others: data.others || {}, loaded: true, denied: false };
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
    const needle = helperNorm(q);
    const hit = (it) => !needle || helperNorm(it.name).includes(needle) || helperNorm(it.sub || '').includes(needle) || helperSyn(needle).some((w) => helperNorm(it.name).includes(w));
    helperCounter();
    const items = helperState.items;
    const basics = items.filter((it) => it.basic);
    const custom = items.filter((it) => !it.basic && !it.group);
    const catalogue = items.filter((it) => it.group);
    const sections = [];
    if (!needle) {
        // Without a search: the basics, the helpers' own rows, and one line that
        // says the rest of the catalogue is a search away — not 660 rows.
        sections.push({ name: 'הבסיס — 16 עבודות', rows: basics, note: 'מספר אחד לשורה, לפני מע"מ. אין חובה למלא הכל.' });
        if (custom.length) sections.push({ name: 'סעיפים שהוספתם', rows: custom });
    } else {
        const rows = items.filter(hit);
        if (!rows.length) { root.innerHTML = '<p class="input-help">לא נמצא סעיף כזה — תוסיף אותו למטה (השם כבר שם).</p>'; helperPrefillAdd(q); return; }
        const inBasics = rows.filter((it) => it.basic), inCustom = rows.filter((it) => !it.basic && !it.group);
        if (inBasics.length) sections.push({ name: 'הבסיס', rows: inBasics });
        for (const g of helperState.groups || []) { const inG = rows.filter((it) => it.group === g.id); if (inG.length) sections.push({ name: g.name, rows: inG }); }
        if (inCustom.length) sections.push({ name: 'סעיפים שהוספתם', rows: inCustom });
    }
    root.innerHTML = sections.map((sec) => `<h4 class="helper-group">${helperEsc(sec.name)} <span class="input-help">· ${sec.rows.length}</span></h4>${sec.note ? `<p class="helper-basics">${helperEsc(sec.note)}</p>` : ''}` + sec.rows.map(helperRow).join('')).join('')
        + (!needle && catalogue.length ? `<p class="helper-more">יש עוד ${catalogue.length} סעיפים מהמחירון המלא — חפש למעלה (למשל "שקע", "מזגן", "לוח").</p>` : '');
}

// The counter is a goal, not a verdict: the basics are the unit.
function helperCounter() {
    const counter = document.getElementById('helper-progress'); if (!counter) return;
    const basics = helperState.items.filter((it) => it.basic);
    const doneBasics = basics.filter((it) => helperState.mine[it.id]).length;
    const extra = Object.keys(helperState.mine).length - doneBasics;
    counter.textContent = basics.length ? `${doneBasics} מתוך ${basics.length} הבסיסיים${extra > 0 ? ` · ועוד ${extra}` : ''}` : `${Object.keys(helperState.mine).length} מחירים`;
}

// Search in the trade's words: a few synonyms so "שקע" finds "בית תקע".
const HELPER_SYN = { 'שקע': ['בית תקע', 'בתי תקע'], 'שקעים': ['בית תקע'], 'מזגן': ['מיזוג'], 'לוח': ['לוח חשמל', 'לוחות'], 'מאז': ['מא"ז'], 'פחת': ['ממסר פחת'], 'נורה': ['גוף תאורה', 'מנורה'], 'ספוט': ['שקוע'], 'דוד': ['מים חמים'], 'חציבה': ['חריצה'], 'הארקה': ['הארקת'], 'תעלה': ['תעלות'], 'צנרת': ['צינור', 'צינורות'], 'כבל': ['כבלי'] };
function helperNorm(s) { return String(s || '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function helperSyn(needle) { return Object.entries(HELPER_SYN).filter(([k]) => needle.includes(k)).flatMap(([, v]) => v.map(helperNorm)); }
let helperSearchTimer = null;
function helperSearchChanged() { clearTimeout(helperSearchTimer); helperSearchTimer = setTimeout(() => renderHelperPanel(), 160); }
function helperPrefillAdd(q) { const el = document.getElementById('helper-new-name'); if (el && !el.value) el.value = q.trim(); }

// Signed in, not (yet) a helper: the one screen a friend must never hit is
// an empty one. This says what to send Stav, with the address ready to copy.
function helperRequestCard() {
    let email = ''; try { email = (typeof getActiveUser === 'function' && getActiveUser()) || ''; } catch (e) { /* not signed in */ }
    return `<div class="helper-request">
        <p><b>המסך הזה נפתח לחברים שסתיו הזמין.</b> נכנסת עם ${email ? `<code>${helperEsc(email)}</code>` : 'חשבון Google'} — שלח לו את הכתובת הזאת בוואטסאפ והוא פותח לך תוך דקה.</p>
        ${email ? `<button type="button" class="btn btn-small btn-accent" onclick="navigator.clipboard&&navigator.clipboard.writeText('${helperEsc(email)}').then(()=>showToast('הכתובת הועתקה — שלח לסתיו','success'))">העתק את הכתובת</button>` : ''}
    </div>`;
}

function helperRow(it) {
    const mine = helperState.mine[it.id];
    const others = helperState.others[it.id];
    return `
    <div class="helper-row${mine ? ' has-price' : ''}" id="helper-row-${helperEsc(it.id)}">
        <div class="helper-row-name">${helperEsc(it.name)} <span class="helper-unit">${helperEsc(it.unit)}</span>${mine && it.sj ? ` <span class="helper-sj">המחיר שלנו: ${helperFmt(it.sj)} ₪ — לא חייב להסכים</span>` : ''}</div>
        <div class="helper-row-input">
            <input type="number" inputmode="numeric" min="1" step="1" class="model-select-input" style="width:110px"
                   value="${mine ? helperEsc(mine.price) : ''}" placeholder="₪"
                   id="helper-price-${helperEsc(it.id)}" data-saved="${mine ? helperEsc(mine.price) : ''}"
                   onblur="helperBlur('${helperEsc(it.id)}')"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();saveHelperPrice('${helperEsc(it.id)}', true)}">
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

// Leaving a field with a new number in it saves it — a friend on a phone
// should not need a third tap per row.
function helperBlur(itemId) {
    const input = document.getElementById('helper-price-' + itemId); if (!input) return;
    if (input.value && String(input.value) !== String(input.dataset.saved || '')) saveHelperPrice(itemId);
}
function helperFocusNext(itemId) {
    const inputs = [...document.querySelectorAll('#helper-list input[id^="helper-price-"]')];
    const i = inputs.findIndex((x) => x.id === 'helper-price-' + itemId);
    const next = inputs.slice(i + 1).find((x) => !x.value);
    if (next) { next.focus(); next.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
async function saveHelperPrice(itemId, andNext) {
    const input = document.getElementById('helper-price-' + itemId);
    const price = Math.round(Number(input && input.value));
    if (!price || price <= 0) { showToast('תרשום מחיר.', 'error'); return; }
    if (input && input.dataset.saving === '1') return;
    if (input) input.dataset.saving = '1';
    try {
        const res = await adminRes('/api/helper-prices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, price }),
        });
        const data = await res.json();
        if (!res.ok) { showToast((data.error && data.error.message) || 'לא נשמר.', 'error'); return; }
        const wasNew = !helperState.mine[itemId];
        helperState.mine[itemId] = data.mine;
        if (data.others) helperState.others[itemId] = data.others; else delete helperState.others[itemId];
        const row = document.getElementById('helper-row-' + itemId);
        if (row) row.outerHTML = helperRow(helperState.items.find((x) => x.id === itemId));
        helperCounter();
        const n = Object.keys(helperState.mine).length;
        if (wasNew && n === 10) showToast('10 מחירים — תודה! זה כבר משפר את המחירון של כולם.', 'success');
        else if (wasNew && n === helperState.items.filter((it) => it.basic).length) showToast('כל הבסיס מלא. תודה ענקית — סתיו רואה את זה.', 'success');
        else showToast('נשמר ✓', 'success');
        if (andNext) helperFocusNext(itemId);
    } catch (e) {
        showToast('לא נשמר — התחבר שוב לגוגל.', 'error');
    } finally { const inp = document.getElementById('helper-price-' + itemId); if (inp) delete inp.dataset.saving; }
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
// Two containers, two screens: the helpers themselves (add/remove) sit with
// the users, every price they wrote sits with the prices. One fetch feeds both.

async function renderAdminHelpers() {
    const body = document.getElementById('admin-helpers-body');
    const pricesBox = document.getElementById('admin-helper-prices-body');
    if (!body || typeof isAdmin !== 'function' || !isAdmin()) return;
    body.innerHTML = '<p class="input-help">טוען…</p>';
    if (pricesBox) pricesBox.innerHTML = '<p class="input-help">טוען…</p>';
    let data;
    try {
        const res = await adminRes('/api/helper-prices?admin=1');
        data = await res.json();
        if (!res.ok) { body.innerHTML = '<p class="input-help">' + helperEsc((data.error && data.error.message) || 'שגיאה') + '</p>'; if (pricesBox) pricesBox.innerHTML = body.innerHTML; return; }
    } catch (e) {
        body.innerHTML = '<p class="input-help">לא נטען.</p>';
        if (pricesBox) pricesBox.innerHTML = body.innerHTML;
        return;
    }
    const helpers = data.helpers || [];
    const prices = data.prices || {};
    const items = data.items || [];
    const byId = Object.fromEntries(items.map((it) => [it.id, it]));
    const list = helpers.length
        ? helpers.map((em) => `<li>${helperEsc(em)} <span class="input-help">· ${Object.keys(prices[em] || {}).length} מחירים · מאז ההתחלה</span>
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
        ? `<p class="input-help" style="margin:0 0 8px">${rows.length} מחירים מ-${Object.keys(prices).length} עוזרים · מאז ההתחלה</p>
          <div class="table-scroll"><table style="width:100%;font-size:var(--fs-sm);border-collapse:collapse"><thead><tr><th style="text-align:right">סעיף</th><th style="text-align:right">מי</th><th style="text-align:left">₪</th></tr></thead><tbody>`
          + rows.map((r) => `<tr><td>${helperEsc(r.name)} <span class="input-help">${helperEsc(r.unit)}</span></td><td>${helperEsc(r.em.split('@')[0])}</td><td style="text-align:left">${helperFmt(r.price)}</td></tr>`).join('')
          + '</tbody></table></div>'
        : '<p class="input-help">עוד לא נרשם אף מחיר.</p>';
    body.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
            <input type="email" id="admin-helper-email" class="model-select-input" placeholder="מייל של חבר (חשבון גוגל)" style="flex:1;min-width:220px">
            <button type="button" class="btn btn-small btn-accent" onclick="setHelper(null, true)">הוסף עוזר</button>
        </div>
        <ul style="margin:0;padding-inline-start:18px;line-height:2">${list}</ul>`;
    if (pricesBox) pricesBox.innerHTML = table;
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
window.helperSearchChanged = helperSearchChanged;
window.helperBlur = helperBlur;
window.renderHelperPanel = renderHelperPanel;
window.saveHelperPrice = saveHelperPrice;
window.addHelperItem = addHelperItem;
window.renderAdminHelpers = renderAdminHelpers;
window.setHelper = setHelper;
