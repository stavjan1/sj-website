// ============================================================================
//  מחירון השוק — what the trade charges, next to what you charge
// ============================================================================
// Lifted out of sale/app.js on 25/08/2026, unchanged. The anonymous per-item
// benchmark: collection, the comparison table, and adopting a price into your
// own book.

// ==========================================================================
// Market prices: what the trade charges for each line item, next to what you
// charge. Fed by the anonymous per-item samples every PDF export contributes
// (stats:items:electrician:<name> in KV) — names and prices only, never a
// customer. Sorting is the whole point: the gap column is where money hides.
// ==========================================================================
let marketData = null;          // { items:[{name, count, median, low, high}] }
let marketSort = 'gap';
// The market opens first. Stav, 28/08: the screen used to open on an empty
// list with a form on it, which is the product asking HIM for data before
// giving him any — while the one view that is worth something the moment you
// arrive, and needs nothing from you, was hidden behind a tab.
let catalogView = 'market';

function setCatalogView(view) {
    catalogView = view === 'market' ? 'market' : view === 'sj' ? 'sj' : 'mine';
    const mine = document.getElementById('catalog-view-mine');
    const market = document.getElementById('catalog-view-market');
    const sj = document.getElementById('catalog-view-sj');
    if (mine) mine.hidden = catalogView !== 'mine';
    if (market) market.hidden = catalogView !== 'market';
    if (sj) sj.hidden = catalogView !== 'sj';
    if (catalogView === 'sj') renderSjCatalog();
    document.querySelectorAll('#catalog-subtabs .subtab').forEach(b => {
        const on = b.dataset.sub === catalogView;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    if (catalogView === 'market') renderMarketPrices();
}

// ── מחירון SJ: the decided price for every everyday item, in two modes ──
// Mode A (default): the item's price, all in. Mode B: hours × the hourly
// rate + materials — shown for the same rows, so the customer sees why.
let sjMode = 'A';
// The whole book, ~3,000 rows. Loaded the first time this tab opens and kept
// apart from sjPriceBook (app.js), which holds only the agent's slice — the
// starter strip and the chase curve — and would render as a thirty-row
// catalogue if it were mistaken for this one.
let sjPriceBookFull = null;
function setSjMode(m) { sjMode = m === 'B' ? 'B' : 'A'; document.querySelectorAll('#sj-modes .chip').forEach((c) => c.classList.toggle('on', c.dataset.mode === sjMode)); renderSjCatalog(); }
async function renderSjCatalog() {
    const box = document.getElementById('sj-list');
    if (!box) return;
    if (!sjPriceBookFull) {
        box.innerHTML = '<p class="input-help">טוען…</p>';
        try { const r = await fetch('data/sj-prices.json'); if (r.ok) sjPriceBookFull = await r.json(); } catch (e) { /* offline */ }
        if (!sjPriceBookFull) { box.innerHTML = '<p class="input-help">המחירון לא נטען. נסה שוב עם קליטה.</p>'; return; }
    }
    const book = sjPriceBookFull, d = book.decisions || {};
    const rate = (d.hourly_mode && d.hourly_mode.rate) || 250, visit = d.visit || 350;
    const q = ((document.getElementById('sj-search') || {}).value || '').trim();
    const rows = book.rows.filter((r) => r.price && (!q || r.name.includes(q) || (book.subs && book.subs[r.s] || '').includes(q)));
    const note = document.getElementById('sj-note');
    if (note) note.textContent = sjMode === 'A'
        ? `לפי סעיפים: מספר אחד לפריט, כולל עבודה וחומר. הגעה ${visit} ₪ פעם אחת לביקור.`
        : `לפי שעות: הגעה ${visit} ₪ + ${rate} ₪ לשעה + חומר. לאיתור תקלות ועבודה פתוחה.`;
    const groups = book.groups || [];
    const fmt = (n) => Number(n).toLocaleString('he-IL');
    const line = (r) => {
        const sub = book.subs ? (book.subs[r.s] || '') : '';
        let price;
        if (sjMode === 'B' && r.basis === 'work' && r.hours != null) price = `${r.hours} שע׳ × ${rate} + חומר ${fmt(r.materials || 0)} = <b>${fmt(Math.round(r.hours * rate + (r.materials || 0)))}</b>`;
        else if (r.basis === 'chase') price = `<b>${fmt(r.price)}</b> למטר 1–2, ${fmt(r.next_m)} מהשלישי`;
        else price = `<b>${fmt(r.price)}</b>`;
        return `<div class="market-row"><div class="market-name">${escapeHtml(r.name)} <span class="input-help">${escapeHtml(r.unit || '')}${sub ? ' · ' + escapeHtml(sub) : ''}</span></div><div class="market-nums">${price} ₪</div></div>`;
    };
    const sections = [];
    const starter = rows.filter((r) => r.starter);
    if (starter.length && !q) sections.push({ name: 'הכי בשימוש', rows: starter });
    for (const g of groups) {
        const inG = rows.filter((r) => r.group === g.id && !(r.starter && !q));
        if (inG.length) sections.push({ name: g.name, rows: inG });
    }
    box.innerHTML = sections.length
        ? sections.map((sec) => `<details class="sj-group" ${sec.name === 'הכי בשימוש' || q ? 'open' : ''}><summary>${escapeHtml(sec.name)} <span class="input-help">· ${sec.rows.length}</span></summary>${sec.rows.map(line).join('')}</details>`).join('')
        : '<p class="input-help">אין סעיף כזה.</p>';
}
window.setSjMode = setSjMode;
window.renderSjCatalog = renderSjCatalog;

// My price for an item name, from the personal catalog (system catalog is
// merged into priceCatalog on boot, so this is "what I would quote").
function myPriceFor(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    const exact = (priceCatalog || []).find(c => String(c.name || '').trim().toLowerCase() === n);
    if (exact) return Number(exact.price) || null;
    const loose = (priceCatalog || []).find(c => {
        const cn = String(c.name || '').trim().toLowerCase();
        return cn && (cn.includes(n) || n.includes(cn));
    });
    return loose ? (Number(loose.price) || null) : null;
}

async function renderMarketPrices(force) {
    const box = document.getElementById('market-list');
    if (!box) return;
    if (force) marketData = null;
    if (!marketData) {
        box.innerHTML = '<p class="input-help">טוען…</p>';
        try {
            const headers = {};
            if (googleAccessToken && !isGuestUser()) headers['Authorization'] = 'Bearer ' + googleAccessToken;
            const res = await fetch('/api/stats?market=1', { headers });
            marketData = await res.json();
        } catch (e) { marketData = { items: [] }; }
    }
    const items = (marketData && marketData.items) || [];
    if (!items.length) {
        box.innerHTML = `<div class="catalog-empty">עדיין אין מספיק נתוני שוק.<br>
            <span class="input-help">כל הצעת מחיר שמופקת מהמערכת מוסיפה מחירי סעיפים אנונימיים למאגר הזה, וככל שיהיו יותר, ההשוואה כאן תהיה שווה יותר.</span></div>`;
        return;
    }
    const q = (document.getElementById('market-search')?.value || '').trim().toLowerCase();
    const onlyMine = !!document.getElementById('market-only-mine')?.checked;
    const rows = items.map(it => {
        const mine = myPriceFor(it.name);
        const gap = (mine != null && it.median) ? mine - it.median : null;
        const gapPct = (gap != null && it.median) ? Math.round((gap / it.median) * 100) : null;
        return { ...it, mine, gap, gapPct };
    }).filter(r => (!q || r.name.toLowerCase().includes(q)) && (!onlyMine || r.mine != null));

    rows.sort((x, y) => {
        if (marketSort === 'uses') return y.count - x.count;
        if (marketSort === 'price') return y.median - x.median;
        if (marketSort === 'name') return x.name.localeCompare(y.name, 'he');
        // gap: the biggest distance from the market, in percent, first — items
        // with no personal price fall to the bottom (nothing to compare).
        const gx = x.gapPct == null ? -Infinity : Math.abs(x.gapPct);
        const gy = y.gapPct == null ? -Infinity : Math.abs(y.gapPct);
        return gy - gx;
    });

    const nis = (n) => '₪' + Math.round(n).toLocaleString('he-IL');
    const body = rows.slice(0, 300).map(r => {
        const cls = r.gap == null ? '' : r.gap > 0 ? 'is-high' : r.gap < 0 ? 'is-low' : '';
        const gapTxt = r.gap == null ? '<span class="mk-none">אין לי מחיר</span>'
            : `${r.gap > 0 ? '+' : ''}${nis(r.gap)} <small>(${r.gapPct > 0 ? '+' : ''}${r.gapPct}%)</small>`;
        return `<tr class="${cls}">
            <td class="mk-name">${escapeHtml(r.name)}</td>
            <td class="num" data-l="שלי">${r.mine != null ? nis(r.mine) : '—'}</td>
            <td class="num" data-l="בשוק">${nis(r.median)}<small class="mk-range">${nis(r.low)}–${nis(r.high)}</small></td>
            <td class="num mk-gap" data-l="פער">${gapTxt}</td>
            <td class="num" data-l="דגימות">${r.count}</td>
            <td>${r.mine == null ? `<button class="btn btn-secondary btn-small" onclick="marketAdoptPrice('${escapeHtml(r.name).replace(/'/g, "\\'")}', ${Math.round(r.median)})">הוסף למאגר</button>` : ''}</td>
        </tr>`;
    }).join('');

    const above = rows.filter(r => r.gap != null && r.gap > 0).length;
    const below = rows.filter(r => r.gap != null && r.gap < 0).length;
    box.innerHTML = `
        <div class="market-summary">
            <span>${rows.length} סעיפים</span>
            <span class="is-high">${above} מעל השוק</span>
            <span class="is-low">${below} מתחת לשוק</span>
            <span class="input-help">חציון על בסיס ${marketData.minSamples || 5}+ דגימות אנונימיות</span>
        </div>
        <div class="table-scroll">
        <table class="mk-table">
            <thead><tr><th>סעיף</th><th>המחיר שלי</th><th>חציון בשוק</th><th>הפער</th><th>דגימות</th><th></th></tr></thead>
            <tbody>${body}</tbody>
        </table>
        </div>`;
    document.querySelectorAll('#market-sorts .chip').forEach(b => {
        b.classList.toggle('on', b.dataset.msort === marketSort);
        b.onclick = () => { marketSort = b.dataset.msort; renderMarketPrices(); };
    });
}

// One click to take a market price into your own catalog.
function marketAdoptPrice(name, price) {
    if (!name || !(price > 0)) return;
    priceCatalog.push({ name: String(name).slice(0, 120), price: Math.round(price), unit: 'יח\u0027' });
    savePriceCatalog();
    renderMarketPrices();
    showToast(`נשמר: מעכשיו אתה מתמחר "${name}" ב-${Math.round(price)} ₪`);
}

function renderPriceCatalog() {
    const list = document.getElementById('catalog-list');
    const countEl = document.getElementById('catalog-count');
    if (countEl) countEl.textContent = priceCatalog.length;
    // The tab carries the number too: "המחירים שלי (0)" says at a glance that
    // there is nothing there yet, without having to open it to find out.
    const tabCount = document.getElementById('catalog-count-tab');
    if (tabCount) tabCount.textContent = priceCatalog.length;
    if (!list) return;
    const q = (document.getElementById('catalog-search')?.value || '').toLowerCase().trim();
    if (priceCatalog.length === 0) {
        list.innerHTML = '<div class="catalog-empty">עדיין לא שינית שום מחיר, וזה בסדר: הסוכן מתמחר לפי מחירון המערכת.<br><span class="input-help">במחירון השוק תראה איפה אתה יקר או זול מהאחרים, וכל מחיר שתאמץ מופיע כאן.</span></div>';
        return;
    }
    const items = priceCatalog.filter(it => !q || it.name.toLowerCase().includes(q));
    if (items.length === 0) { list.innerHTML = '<div class="catalog-empty">לא נמצאו פריטים תואמים.</div>'; return; }
    list.innerHTML = items.map(it => {
        const idx = priceCatalog.indexOf(it);
        return `<div class="catalog-row">
            <span class="cr-name">${escapeHtml(it.name)}</span>
            <span class="cr-price">${it.price} ₪${it.unit ? ` <em>(${escapeHtml(it.unit)})</em>` : ''}</span>
            <button class="cr-del" onclick="deleteCatalogItem(${idx})" title="מחק"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }).join('');
}

function deleteCatalogItem(idx) {
    if (idx < 0 || idx >= priceCatalog.length) return;
    priceCatalog.splice(idx, 1);
    savePriceCatalog();
    renderPriceCatalog();
}

async function clearPriceCatalog() {
    if (priceCatalog.length === 0) return;
    if (!await askConfirm({
        title: 'לרוקן את המחירים שלך?',
        body: `${priceCatalog.length} פריטים יימחקו, והסוכן יחזור לתמחר לפי מחירון המערכת.`,
        note: 'פעולה זו אינה הפיכה.',
        confirmLabel: 'רוקן', danger: true,
    })) return;
    priceCatalog = [];
    savePriceCatalog();
    renderPriceCatalog();
    showToast('המאגר רוקן');
}

// Send this user's price catalog to the SJ inbox for review. If verified, it can
// be promoted into the shared system catalog. Google gives us the sender's name
// and email (never a phone: that scope doesn't exist), so we ask for a phone
// optionally. Delivered by email server-side (/api/share-catalog), which works
// across devices immediately without extra infrastructure.
// Sender identity per the chosen share mode: named (Google details) or anonymous.
function _shareSenderDetails() {
    const mode = document.querySelector('input[name="catalog-share-mode"]:checked')?.value || 'named';
    const phone = (document.getElementById('catalog-share-phone')?.value || '').trim();
    if (mode === 'anonymous') return { name: 'אנונימי', email: '', phone };
    const activeUser = getActiveUser() || '';
    const senderEmail = isGuestUser() ? '' : (activeUser.includes('@') ? activeUser : '');
    return {
        name: isGuestUser() ? 'אורח' : (localStorage.getItem('gsi_name') || senderEmail.split('@')[0] || 'משתמש'),
        email: senderEmail,
        phone
    };
}

async function _postCatalogShare(statusEl, payload, successMsg) {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = ''; statusEl.textContent = 'שולח…'; }
    try {
        const res = await fetch('/api/share-catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        // The endpoint formats the mail but cannot post it, web3forms rejects
        // server-to-server calls on the free plan, so the browser sends it.
        let delivered = res.ok && data.ok;
        if (delivered && data.notify) {
            const w3 = await fetch(data.notify.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(data.notify.payload)
            }).catch(() => null);
            delivered = !!(w3 && w3.ok);
        }
        if (delivered) {
            if (statusEl) { statusEl.style.color = 'var(--color-success)'; statusEl.textContent = successMsg; }
            showToast(successMsg);
        } else {
            const msg = (data && data.error && data.error.message) || 'השליחה נכשלה. נסה שוב מאוחר יותר.';
            if (statusEl) { statusEl.style.color = 'var(--color-danger)'; statusEl.textContent = msg; }
        }
    } catch (e) {
        if (statusEl) { statusEl.style.color = 'var(--color-danger)'; statusEl.textContent = 'שגיאת רשת, נסה שוב.'; }
    }
}

async function shareCatalogWithSystem() {
    if (!priceCatalog || priceCatalog.length === 0) {
        showToast('אין פריטים במאגר לשיתוף', 'error');
        return;
    }
    const statusEl = document.getElementById('catalog-share-status');
    await _postCatalogShare(statusEl,
        { ..._shareSenderDetails(), catalog: priceCatalog.slice(0, 500) },
        'תודה! המאגר נשלח לבדיקה 🙂');
}

// "Send a price file", any file from the user's computer (their supplier's
// Excel/CSV/PDF price list). Text formats are embedded for review; binary
// formats send the file name + a note to contact the sender.
function shareCatalogFile(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('catalog-share-status');
    if (file.size > 2 * 1024 * 1024) {
        if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = 'var(--color-danger)'; statusEl.textContent = 'הקובץ גדול מ-2MB, שלח קובץ קטן יותר או את המאגר עצמו.'; }
        input.value = '';
        return;
    }
    const isTextLike = /\.(csv|txt)$/i.test(file.name);
    if (isTextLike) {
        readFileOrExplain(file, async (text) => {
            await _postCatalogShare(statusEl,
                { ..._shareSenderDetails(), fileName: file.name, fileText: String(text).slice(0, 60000) },
                'תודה! הקובץ נשלח לבדיקה 🙂');
            input.value = '';
        }, 'הקובץ');
    } else {
        _postCatalogShare(statusEl, { ..._shareSenderDetails(), fileName: file.name, fileText: '' }, 'תודה! שם הקובץ נשלח, ניצור קשר להעברתו 🙂').then(() => { input.value = ''; });
    }
}

function getNextQuoteNumber() {
    const year = new Date().getFullYear();
    const prefix = year + '-';
    // Robust: one past the highest existing number this year (survives deletions,
    // unlike a count-based scheme which could reuse a number).
    let maxNum = 100;
    appState.history.forEach(q => {
        if (q.quoteNumber && q.quoteNumber.startsWith(prefix)) {
            const n = parseInt(q.quoteNumber.slice(prefix.length), 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
        }
    });
    return `${year}-${maxNum + 1}`;
}

// Guarantee the quote has a running number, auto-fill it if the field is empty
// (e.g. when editing the form directly instead of via "new quote").
function ensureQuoteNumber() {
    const el = document.getElementById('form-quote-number');
    if (el && !el.value.trim()) {
        el.value = getNextQuoteNumber();
        if (appState.currentQuote) appState.currentQuote.quoteNumber = el.value;
    }
    return el ? el.value : '';
}

function initNewQuote() {
    appState.currentQuote = {
        id: null,
        clientName: '',
        clientSub: '',
        quoteNumber: getNextQuoteNumber(),
        date: getTodayDateString(),
        subject: '',
        items: [
            { title: 'פרק א\': עבודות הכנה', description: 'ביצוע עבודות הכנה והתארגנות בשטח.', price: 0 }
        ],
        basePrice: 0,
        // Same reasoning as the appState default: עוסק מורשה is the common case
        // and this is a NEW blank quote. The load fallback below deliberately
        // stays 'exempt' — an old saved quote with no vatType was displayed and
        // sent as exempt, and re-opening it must not silently add 18% to a
        // price a customer has already been given.
        vatType: 'exclude',
        finalPrice: 0,
        summary: appState.settings.businessDetails.terms,
        showItemizedPrices: false,
        customerType: 'private'
    };
    
    fillFormFromState();
    updatePreviewFromForm();
}

function fillFormFromState() {
    const q = appState.currentQuote;

    // Assigning undefined to an <input> stores the STRING "undefined", and the
    // A4 preview then printed "הצעת מחיר ל-undefined" on a customer's document.
    // Any field a project predates: or that the agent left empty: comes
    // through as undefined, so every one of them is coerced here.
    const val = (v, fallback) => (v === undefined || v === null ? (fallback === undefined ? '' : fallback) : v);

    document.getElementById('form-client-name').value = val(q.clientName);
    document.getElementById('form-client-sub').value = val(q.clientSub);
    document.getElementById('form-quote-number').value = val(q.quoteNumber);
    document.getElementById('form-quote-date').value = val(q.date, getTodayDateString());
    document.getElementById('form-quote-subject').value = val(q.subject);
    document.getElementById('form-base-price').value = val(q.basePrice, 0);
    // The select knows exempt / exclude / include only. A project born with the
    // old 'plus' constant (or anything else unknown) reads as 'exclude' — the
    // value it meant — instead of a blank select and the exempt branch.
    const vatType = ['exempt', 'exclude', 'include'].includes(q.vatType) ? q.vatType : (q.vatType ? 'exclude' : 'exempt');
    document.getElementById('form-vat-type').value = vatType;
    document.getElementById('form-summary').value = val(q.summary);
    
    const container = document.getElementById('work-items-container');
    container.innerHTML = '';
    
    if (q.items && q.items.length > 0) {
        q.items.forEach((item) => {
            addWorkItemRow(item.title, item.description, item.price);
        });
    } else {
        addWorkItemRow('', '', 0);
    }
    
    calculateTotal();
}

// Escape user/AI text before inserting via innerHTML / attributes, so a quote,
// "<", or "&" in a title/description can't break the editor or the PDF.
// escapeHtml / escapeAttr live in app.js, the first script, so every file
// shares the one escaper.

// Reorder quote work items with up/down arrows (deliberate: arrows, not
// drag-and-drop — reliable with a thumb on a phone).
function moveWorkItemRow(btn, dir) {
    const row = btn.closest('.work-item-form-row');
    if (!row) return;
    const sibling = dir === -1 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (dir === -1) row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
    updateRowIndices();
    updatePreviewFromForm();
}

function addWorkItemRow(title = '', description = '', price = 0) {
    const container = document.getElementById('work-items-container');
    const index = container.children.length + 1;
    const isItemized = appState.currentQuote.showItemizedPrices;

    const row = document.createElement('div');
    row.className = 'work-item-form-row';
    // The row remembers its own price even when there is no visible field for
    // it. Without this, every save made while per-item prices are switched off
    // wrote 0 over the real number — see getWorkItemsFromForm.
    row.dataset.price = String(Number(price) || 0);
    row.innerHTML = `
        <div class="work-item-form-grid ${isItemized ? '' : 'no-price-col'}">
            <div class="row-index">${index}</div>
            <div class="form-group" style="margin-bottom:0">
                <input type="text" class="item-title-input" placeholder="נושא הסעיף (למשל: חיווט כבלי תקשורת)" value="${escapeAttr(title)}" oninput="updatePreviewFromForm()">
            </div>
            <div class="form-group" style="margin-bottom:0">
                <textarea class="item-desc-input" rows="2" placeholder="פירוט תכולת העבודה..." oninput="updatePreviewFromForm()">${escapeHtml(description)}</textarea>
            </div>
            ${isItemized ? `
            <div class="form-group" style="margin-bottom:0">
                <input type="number" class="item-price-input" placeholder="מחיר" value="${price || ''}"
                       oninput="this.closest('.work-item-form-row').dataset.price = (parseFloat(this.value) || 0); calculateItemizedTotal()">
            </div>
            ` : ''}
            <div class="work-item-actions">
                <button type="button" class="btn btn-secondary btn-small wi-move" onclick="moveWorkItemRow(this, -1)" title="הזז למעלה">
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <button type="button" class="btn btn-secondary btn-small wi-move" onclick="moveWorkItemRow(this, 1)" title="הזז למטה">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <button type="button" class="btn btn-danger btn-small" onclick="deleteWorkItemRow(this)" style="height:38px; width:38px; padding:0; justify-content:center;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>
    `;

    container.appendChild(row);
    updateRowIndices();
    updatePreviewFromForm();
}

function deleteWorkItemRow(button) {
    const row = button.closest('.work-item-form-row');
    const container = document.getElementById('work-items-container');
    
    if (container.children.length <= 1) {
        showToast('חובה להשאיר לפחות סעיף עבודה אחד בהצעת המחיר', 'error');
        return;
    }
    
    row.remove();
    updateRowIndices();
    
    if (appState.currentQuote.showItemizedPrices) {
        calculateItemizedTotal();
    } else {
        calculateTotal();
    }
    updatePreviewFromForm();
}

function updateRowIndices() {
    const container = document.getElementById('work-items-container');
    Array.from(container.children).forEach((row, idx) => {
        row.querySelector('.row-index').textContent = idx + 1;
    });
}

// Cut at a space, not at a letter. The exclusion preset read
// "לא כולל עבודות בנייה, טיח, צבע ושחז…" with the last word sliced through
// the middle, which reads as a rendering fault rather than as an abbreviation.
// The full text goes in the tooltip, so nothing is actually hidden.
function clipWords(t, max) {
    const str = String(t || '');
    if (str.length <= max) return str;
    const cut = str.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;־-]+$/, '') + '…';
}

function getWorkItemsFromForm(includeEmpty) {
    const items = [];
    const container = document.getElementById('work-items-container');
    
    Array.from(container.children).forEach(row => {
        const title = row.querySelector('.item-title-input').value.trim();
        const desc = row.querySelector('.item-desc-input').value.trim();
        // With per-item prices OFF — which is the default — addWorkItemRow does
        // not render .item-price-input at all. This used to read that missing
        // element and fall back to 0, so a quote that HAD prices lost every one
        // of them the next time anything saved, silently and permanently. The
        // row keeps the value in a data attribute for exactly this case.
        const priceInput = row.querySelector('.item-price-input');
        const price = priceInput
            ? (parseFloat(priceInput.value) || 0)
            : (parseFloat(row.dataset.price) || 0);
        
        if (title || desc || includeEmpty) {
            items.push({ title, description: desc, price });
        }
    });
    
    return items;
}

function calculateItemizedTotal() {
    const container = document.getElementById('work-items-container');
    let sum = 0;
    Array.from(container.children).forEach(row => {
        const priceInput = row.querySelector('.item-price-input');
        if (priceInput) {
            sum += parseFloat(priceInput.value) || 0;
        }
    });
    
    const basePriceInput = document.getElementById('form-base-price');
    basePriceInput.value = sum;
    basePriceInput.readOnly = true;
    basePriceInput.classList.add('readonly-highlight');
    
    calculateTotal();
}

// Israeli VAT rate (18% since 2025-01-01). Single source of truth.
const VAT_RATE = 0.18;
const VAT_PCT = Math.round(VAT_RATE * 100);

// The three numbers behind every total: net, VAT, gross. 'exclude' adds VAT
// to the base, 'include' peels it out of the base, 'exempt' has none.
function quoteVatSplit(basePrice, vatType) {
    const base = Number(basePrice) || 0;
    if (vatType === 'exclude') return { net: base, vat: base * VAT_RATE, gross: base * (1 + VAT_RATE) };
    if (vatType === 'include') { const net = base / (1 + VAT_RATE); return { net, vat: base - net, gross: base }; }
    return { net: base, vat: 0, gross: base };
}

// Who is paying. A household reads one number — what it hands over, VAT in;
// a business books the net and adds VAT itself. Default private, because
// most callers are households. Stored on the quote next to the client name.
function customerTypeOf(q) {
    return q && q.customerType === 'business' ? 'business' : 'private';
}

// What the document shows for the money: which number is the big one, and
// the small lines around it. Pure — the DOM writer below reads it, and so
// do the tests.
function quoteTotalsLayout(basePrice, vatType, customerType) {
    const s = quoteVatSplit(basePrice, vatType);
    const nis = (n) => formatPriceString(Number(Number(n).toFixed(2))) + ' ש"ח';
    const vatLine = { label: `מע"מ ${VAT_PCT}%`, value: nis(s.vat) };
    if (vatType !== 'exclude' && vatType !== 'include') {
        return { big: s.gross, bigLabel: 'סה"כ לתשלום:', above: [], below: [],
                 vatLabel: 'פטור ממע"מ (עוסק פטור)', showVatLabel: true };
    }
    if (customerType === 'business') {
        return {
            big: s.net, bigLabel: 'סה"כ לפני מע"מ:',
            above: [],
            below: [vatLine, { label: 'סה"כ כולל מע"מ', value: nis(s.gross), strong: true }],
            // Read by the share link and the WhatsApp text next to finalPrice
            // (the gross), so it must describe the gross — the sheet itself
            // hides it, the lines above already say it.
            vatLabel: `כולל מע"מ ${VAT_PCT}% (לפני מע"מ: ${nis(s.net)})`,
            showVatLabel: false,
        };
    }
    return {
        big: s.gross, bigLabel: 'סה"כ לתשלום כולל מע"מ:',
        above: [{ label: 'לפני מע"מ', value: nis(s.net) }, vatLine],
        below: [],
        vatLabel: `כולל מע"מ ${VAT_PCT}%`,
        showVatLabel: true,
    };
}

function renderQuoteTotals(layout) {
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const lines = (id, rows) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = rows.map((r) =>
            `<div class="pdf-price-line${r.strong ? ' is-strong' : ''}"><span>${escapeHtml(r.label)}</span><span class="pdf-price-num">${escapeHtml(r.value)}</span></div>`).join('');
        el.hidden = !rows.length;
    };
    setTxt('pdf-total-label', layout.bigLabel);
    setTxt('pdf-total-price', formatPriceString(Number(Number(layout.big).toFixed(2))) + ' ש"ח');
    lines('pdf-price-above', layout.above);
    lines('pdf-price-below', layout.below);
    const vl = document.getElementById('pdf-vat-label');
    if (vl) { vl.textContent = layout.vatLabel; vl.hidden = !layout.showVatLabel; }
    const chips = document.querySelectorAll('#form-customer-type [data-type]');
    chips.forEach((b) => b.classList.toggle('on', b.dataset.type === customerTypeOf(appState.currentQuote)));
}

function setCustomerType(type) {
    appState.currentQuote.customerType = type === 'business' ? 'business' : 'private';
    calculateTotal();
}

function calculateTotal() {
    const basePriceInput = document.getElementById('form-base-price').value;
    const basePrice = parseFloat(basePriceInput) || 0;
    const vatType = document.getElementById('form-vat-type').value;

    // finalPrice keeps its meaning: what the customer pays (VAT in when
    // there is VAT). The share link, the WhatsApp text and the invoice all
    // read it, and the customer type only changes which number is printed big.
    const split = quoteVatSplit(basePrice, vatType);
    const roundedPrice = Number(split.gross.toFixed(2));

    document.getElementById('form-final-price').value = formatPriceString(roundedPrice) + ' ש"ח';
    renderQuoteTotals(quoteTotalsLayout(basePrice, vatType, customerTypeOf(appState.currentQuote)));

    appState.currentQuote.basePrice = basePriceInput;
    appState.currentQuote.vatType = vatType;
    appState.currentQuote.finalPrice = roundedPrice;
    appState.currentQuote.customerType = customerTypeOf(appState.currentQuote);

    syncCurrentQuoteToProject();
}

function formatPriceString(val) {
    if (val === undefined || val === null) return '0';
    return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Did the customer press the button? The link the app created is the same one
// the customer holds, so asking is a single public GET. Called when a project
// opens: an approval that arrived while he was driving shows up by itself.
async function checkQuoteApproval(proj) {
    if (!proj || !proj.shareToken || proj.approvedAt) return;
    try {
        const approved = await fetchQuoteApproval(proj);
        if (!applyQuoteApproval(proj, approved)) return;
        saveProjects();
        filterProjectsList();
    } catch (e) { /* offline, or the link was deleted */ }
}

// The one GET. Resolves to the approval stamp `{ at, name, note }` or null;
// throws on a network failure so the caller decides what silence means. The
// home's batched refresh (refreshApprovals in app.js) uses this too, so the
// server is asked in exactly one way.
async function fetchQuoteApproval(proj) {
    if (!proj || !proj.shareToken) return null;
    const res = await fetch('/api/quote-share?t=' + encodeURIComponent(proj.shareToken));
    const body = await res.json().catch(() => ({}));
    const approved = body && body.data && body.data.approved;
    return approved && approved.at ? approved : null;
}

// Stamp the project, and say so ONCE. The status vocabulary stays as it is
// (draft / sent / done / paid) — approval is a fact about the quote, shown as
// its own mark, not a fifth status that every filter and board would have to
// learn. approvalToastAt is the flag that keeps a refresh from repeating the
// toast on every render after the first. Returns true when something changed;
// the caller saves.
function applyQuoteApproval(proj, approved) {
    if (!proj || !approved || !approved.at) return false;
    const fresh = !proj.approvedAt;
    proj.approvedAt = approved.at;
    proj.approvedBy = approved.name || '';
    if (fresh && !proj.approvalToastAt) {
        proj.approvalToastAt = Date.now();
        const who = (approved.name || (proj.quoteData && proj.quoteData.clientName) || '').trim();
        showToast(who ? `הלקוח ${who} אישר את ההצעה!` : 'הלקוח אישר את ההצעה!');
    }
    return fresh;
}

// ── The terms that decide arguments later ───────────────────────────────────
//
// Six lines Stav approved, in the order they matter: how long the price holds,
// how it is paid, when the work starts and how long it takes, what the warranty
// covers, and what the price does NOT include. Each has a default he sets once,
// each can be edited on the document for a specific job, and the exclusions
// paragraph is the most valuable one in the file.
const QUOTE_TERM_DEFAULTS = {
    validityDays: 14,
    paymentTerms: '50% מקדמה עם אישור ההצעה, 50% בסיום העבודה ומסירה.',
    startWithinDays: 7,
    warranty: 'שנה על העבודה. על הציוד חלה אחריות היצרן.',
    exclusions: 'המחיר אינו כולל איתור או תיקון תקלות קיימות שיתגלו במהלך העבודה, עבודות בנייה וגמר, ואגרות או בדיקות של חברת החשמל.',
};

const PAYMENT_PRESETS = [
    '50% מקדמה עם אישור ההצעה, 50% בסיום העבודה ומסירה.',
    'תשלום מלא בסיום העבודה.',
    'שוטף + 30 מיום החשבונית.',
    '30% מקדמה, 40% באמצע העבודה, 30% במסירה.',
];

function quoteDefaults() {
    const d = (appState.settings && appState.settings.quoteDefaults) || {};
    return { ...QUOTE_TERM_DEFAULTS, ...d };
}
function setQuoteDefault(field, value) {
    appState.settings.quoteDefaults = { ...quoteDefaults(), [field]: value };
    persistSettings();
}

// A quote's terms: its own if it has them, the defaults if it does not.
function quoteTerms(q) {
    const d = quoteDefaults();
    const v = q || appState.currentQuote || {};
    return {
        validityDays: v.validityDays === undefined || v.validityDays === '' ? d.validityDays : v.validityDays,
        paymentTerms: v.paymentTerms === undefined ? d.paymentTerms : v.paymentTerms,
        startWithinDays: v.startWithinDays === undefined || v.startWithinDays === '' ? d.startWithinDays : v.startWithinDays,
        durationDays: v.durationDays || 0,
        warranty: v.warranty === undefined ? d.warranty : v.warranty,
        exclusions: v.exclusions === undefined ? d.exclusions : v.exclusions,
    };
}

function setQuoteTerm(field, value) {
    appState.currentQuote[field] = value;
    syncCurrentQuoteToProject();
    renderQuoteTerms();
    try { applySheetEditing(); } catch (e) {}
}

function _daysWord(n) {
    const x = Number(n) || 0;
    if (x === 1) return 'יום עבודה אחד';
    if (x === 1.5) return 'יום וחצי';
    return `${heNum(x)} ימי עבודה`;
}

function renderQuoteDefaults() {
    const box = document.getElementById('quote-defaults-body');
    if (!box) return;
    const d = quoteDefaults();
    box.innerHTML = `
        <p class="input-help" style="margin-block-start:0;">אלה הברירות מחדל. בכל הצעה אפשר לשנות אותן על המסמך עצמו, בלי לגעת כאן.</p>
        <div class="form-grid-2">
            <div class="form-group">
                <label for="qd-validity">תוקף ההצעה (ימים)</label>
                <input type="number" id="qd-validity" min="1" max="365" value="${d.validityDays}" onchange="setQuoteDefault('validityDays', parseInt(this.value, 10) || 14)">
            </div>
            <div class="form-group">
                <label for="qd-start">תחילת עבודה תוך (ימים מאישור)</label>
                <input type="number" id="qd-start" min="0" max="180" value="${d.startWithinDays}" onchange="setQuoteDefault('startWithinDays', parseInt(this.value, 10) || 0)">
            </div>
        </div>
        <div class="form-group">
            <label for="qd-pay">תנאי תשלום</label>
            <div class="qd-presets">
                ${PAYMENT_PRESETS.map((t, i) => `<button type="button" class="chip" title="${escapeHtml(t)}" onclick="pickPaymentPreset(${i})">${escapeHtml(clipWords(t, 34))}</button>`).join('')}
            </div>
            <textarea id="qd-pay" rows="2" onchange="setQuoteDefault('paymentTerms', this.value)">${escapeHtml(d.paymentTerms)}</textarea>
        </div>
        <div class="form-group">
            <label for="qd-warranty">אחריות</label>
            <textarea id="qd-warranty" rows="2" onchange="setQuoteDefault('warranty', this.value)">${escapeHtml(d.warranty)}</textarea>
        </div>
        <div class="form-group">
            <label for="qd-excl">מה לא כלול</label>
            <textarea id="qd-excl" rows="3" onchange="setQuoteDefault('exclusions', this.value)">${escapeHtml(d.exclusions)}</textarea>
            <p class="input-help">הפסקה הכי חשובה במסמך מבחינה משפטית. מה שלא כתוב כאן, הלקוח מניח שכלול.</p>
        </div>`;
}

function pickPaymentPreset(i) {
    const text = PAYMENT_PRESETS[i];
    if (!text) return;
    setQuoteDefault('paymentTerms', text);
    const ta = document.getElementById('qd-pay');
    if (ta) ta.value = text;
    showToast('תנאי התשלום עודכנו');
}

function renderQuoteTerms() {
    const box = document.getElementById('pdf-terms-box');
    const warn = document.getElementById('pdf-exclusions');
    if (!box) return;
    const t = quoteTerms();

    const line = (label, field, text) => `
        <div class="pdf-term-row">
            <span class="pdf-term-k">${escapeHtml(label)}</span>
            <span class="pdf-term-v" data-term-field="${field}">${escapeHtml(text)}</span>
        </div>`;

    const duration = t.durationDays ? `, משך העבודה כ־${_daysWord(t.durationDays)}` : '';
    box.innerHTML = `
        ${line('תוקף ההצעה', 'validityDays', `${heNum(t.validityDays)} ימים מתאריך ההצעה`)}
        ${line('תנאי תשלום', 'paymentTerms', t.paymentTerms)}
        ${line('מועד ביצוע', 'startWithinDays', `תחילת עבודה תוך ${heNum(t.startWithinDays)} ימים מאישור ההצעה${duration}`)}
        ${line('אחריות', 'warranty', t.warranty)}`;

    if (warn) {
        warn.innerHTML = `<span data-term-field="exclusions">${escapeHtml(t.exclusions)}</span>`;
    }
}

// The document's term lines are editable like everything else on it. A number
// typed into "14 ימים" is read back out of the sentence, so he never has to
// know which part of the line is the field.
function bindTermFields(bind) {
    document.querySelectorAll('[data-term-field]').forEach((el) => {
        const field = el.dataset.termField;
        bind(el, (text) => {
            if (field === 'validityDays' || field === 'startWithinDays') {
                const n = parseInt(String(text).replace(/[^\d]/g, ''), 10);
                setQuoteTerm(field, Number.isFinite(n) ? n : quoteDefaults()[field]);
            } else {
                setQuoteTerm(field, text);
            }
        }, { multiline: field === 'exclusions' || field === 'paymentTerms' || field === 'warranty' });
    });
}

// ── Editing on the document itself ──────────────────────────────────────────
//
// Stav: "אני מדמיין מסך כמו שההצעה תצא, אבל עם תיבות טקסט, ופלוס למטה להוסיף
// שורה". So the sheet IS the editor: the same A4 that becomes the PDF, with
// its fields open for typing. The form underneath stays the source of truth,
// so nothing here invents a second copy of the quote — a field edited on the
// page writes into the form and the page re-renders from it.
let _sheetEditing = false;

function sheetEditable() { return _sheetEditing; }

function toggleSheetEdit(on) {
    _sheetEditing = on === undefined ? !_sheetEditing : !!on;
    const sheet = document.getElementById('quote-pdf-sheet');
    if (sheet) sheet.classList.toggle('sheet-editing', _sheetEditing);
    const btn = document.getElementById('btn-sheet-edit');
    if (btn) {
        btn.classList.toggle('active', _sheetEditing);
        const label = btn.querySelector('span');
        if (label) label.textContent = _sheetEditing ? 'סיום עריכה על המסמך' : 'עריכה על המסמך';
    }
    // Re-render: an empty description has no line on a finished document, and
    // needs one the moment you are allowed to type into it.
    try { updatePreviewFromForm(); } catch (e) { applySheetEditing(); }
    try { localStorage.setItem('sj_sheet_edit', _sheetEditing ? '1' : '0'); } catch (e) {}
}

// Wire the editable spots after every re-render of the sheet.
function applySheetEditing() {
    const sheet = document.getElementById('quote-pdf-sheet');
    if (!sheet) return;
    const on = _sheetEditing;

    const bind = (el, onSave, opts) => {
        if (!el) return;
        el.contentEditable = on ? 'true' : 'false';
        el.classList.toggle('sheet-field', on);
        if (on && !el.dataset.sheetBound) {
            el.dataset.sheetBound = '1';
            el.setAttribute('role', 'textbox');
            el.addEventListener('blur', () => onSave(el.textContent.trim()));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !(opts && opts.multiline)) { e.preventDefault(); el.blur(); }
                if (e.key === 'Escape') { el.blur(); }
            });
        }
    };
    const setForm = (id, value, after) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.value = value;
        if (after) after();
        updatePreviewFromForm();
        syncCurrentQuoteToProject();
    };

    bind(sheet.querySelector('#pdf-subject'), (v) => setForm('form-quote-subject', v));
    bind(sheet.querySelector('#pdf-client-name'), (v) => setForm('form-client-name', v));
    bind(sheet.querySelector('#pdf-client-sub'), (v) => setForm('form-client-sub', v), { multiline: true });
    bind(sheet.querySelector('#pdf-summary'), (v) => setForm('form-summary', v), { multiline: true });
    bindTermFields(bind);

    // Rows: the title, the detail and the price are the three things anyone
    // actually edits on a quote.
    const rows = sheet.querySelectorAll('[data-item-index]');
    rows.forEach((row) => {
        const i = Number(row.dataset.itemIndex);
        bind(row.querySelector('[data-item-field="title"]'), (v) => sheetSetItem(i, 'title', v));
        bind(row.querySelector('[data-item-field="description"]'), (v) => sheetSetItem(i, 'description', v), { multiline: true });
        bind(row.querySelector('[data-item-field="price"]'), (v) => sheetSetItem(i, 'price', v));
    });

    const adder = document.getElementById('sheet-add-row');
    if (adder) adder.hidden = !on;
    const picker = document.getElementById('sheet-pick-client');
    if (picker) picker.hidden = !on;
}

// A field on the page writes into its row in the form, which is what the PDF
// and every total already read.
function sheetSetItem(index, field, value) {
    const container = document.getElementById('work-items-container');
    const row = container && container.children[index];
    if (!row) return;
    if (field === 'title') row.querySelector('.item-title-input').value = value;
    if (field === 'description') row.querySelector('.item-desc-input').value = value;
    if (field === 'price') {
        const clean = String(value).replace(/[^\d.]/g, '');
        // The row's own copy is updated whether or not the input is on screen —
        // the sheet lets you edit a price in place even when the per-item column
        // is switched off, and that edit used to go nowhere.
        row.dataset.price = String(parseFloat(clean) || 0);
        const input = row.querySelector('.item-price-input');
        if (input) { input.value = clean; calculateItemizedTotal(); }
    }
    updatePreviewFromForm();
    syncCurrentQuoteToProject();
}

function sheetAddRow() {
    addWorkItemRow('', '', 0);
    if (appState.currentQuote.showItemizedPrices) calculateItemizedTotal();
    updatePreviewFromForm();
    syncCurrentQuoteToProject();
    // Put the cursor in the new row's title, on the document.
    setTimeout(() => {
        const rows = document.querySelectorAll('#quote-pdf-sheet [data-item-index]');
        const last = rows[rows.length - 1];
        const title = last && last.querySelector('[data-item-field="title"]');
        if (title) { title.focus(); document.getSelection().selectAllChildren(title); }
    }, 60);
}

function sheetDeleteRow(index) {
    const container = document.getElementById('work-items-container');
    const row = container && container.children[index];
    if (!row) return;
    row.remove();
    if (appState.currentQuote.showItemizedPrices) calculateItemizedTotal();
    updatePreviewFromForm();
    syncCurrentQuoteToProject();
}

// ── Choosing the customer, from the customers he has ────────────────────────
// Opened from two places: the quote editor, which wants the chosen customer
// written onto the sheet, and a row on the work list, which wants the project
// linked. Both go through the one picker dialog now, so the customer list and
// the category list cannot look like two different products.
let _clientPickFor = null;
// Which customer the picker should show a tick against — the job's, whether the
// picker was opened from a work row or from the quote editor's own project.
function _pickerCurrentClient(projectId) {
    const proj = projectsList.find((p) => p.id === (projectId || activeProjectId));
    return (proj && proj.clientId) || '';
}

function openClientPicker(projectId) {
    _clientPickFor = projectId || null;
    openPickerDialog({
        title: 'בחירת לקוח',
        searchPlaceholder: 'חיפוש לקוח…',
        empty: 'עוד אין לקוחות שמורים. אפשר להוסיף אחד עכשיו.',
        addLabel: 'לקוח חדש',
        // The dropdown this replaced had a "ללא לקוח" option, and detaching a
        // customer from a job you mis-linked is not a thing to lose.
        rows: [{ id: '', name: 'ללא לקוח', active: !_pickerCurrentClient(projectId) }]
            .concat((clientsList || []).slice()
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'))
            .map((c) => ({
                id: c.id,
                name: c.name,
                sub: [c.phone, c.city].filter(Boolean).join(' · '),
                active: c.id === _pickerCurrentClient(projectId),
            }))),
        onPick: (row) => pickClient(row.id),
        onAdd: () => pickNewClient(),
    });
}


function pickClient(id) {
    const client = (clientsList || []).find((c) => c.id === id);
    // openPickerDialog closes itself before it calls back, so there is nothing
    // left to dismiss here.
    const target = _clientPickFor;
    _clientPickFor = null;
    // id === '' is the "ללא לקוח" row: a real choice, not a miss.
    if (!client) {
        if (id !== '') return;
        if (target) { try { assignProjectClient(target, ''); } catch (e) {} return; }
        const p0 = projectsList.find((p) => p.id === activeProjectId);
        if (p0) { p0.clientId = null; saveProjects(); }
        const n = document.getElementById('form-client-name');
        const sb = document.getElementById('form-client-sub');
        if (n) n.value = '';
        if (sb) sb.value = '';
        updatePreviewFromForm();
        syncCurrentQuoteToProject();
        try { filterProjectsList(); } catch (e) {}
        showToast('השיוך ללקוח הוסר');
        return;
    }

    // Opened from a row on the work list: link the project and let
    // assignProjectClient do the rest — it is the one place that knows how a
    // linked customer reaches the quote header and the reminders.
    if (target) { try { assignProjectClient(target, client.id); } catch (e) {} return; }

    // Opened from the quote editor: the sheet in front of him is the thing to
    // fill in.
    const proj = projectsList.find((p) => p.id === activeProjectId);
    if (proj) { proj.clientId = client.id; saveProjects(); }
    const name = document.getElementById('form-client-name');
    const sub = document.getElementById('form-client-sub');
    if (name) name.value = client.name || '';
    if (sub) sub.value = [client.address, client.city, client.phone].filter(Boolean).join(' · ');
    updatePreviewFromForm();
    syncCurrentQuoteToProject();
    try { filterProjectsList(); } catch (e) {}
    showToast(`ההצעה על שם ${client.name}`);
}

// Was three browser prompts in a row — name, then phone, then address, each a
// modal box you had to dismiss to see the next. One form, the same form the
// work list uses, and the quote picks the customer up when it closes.
function pickNewClient() {
    const target = _clientPickFor;                 // survive the picker closing
    openNewClient(target);
    if (!target) _newClientThen = (client) => pickClient(client.id);
}

function updatePreviewFromForm() {
    const biz = appState.settings.businessDetails;
    try { applyQuoteLayout(); } catch (e) {} // manual block design (order/align/size/dir)

    const clientName = document.getElementById('form-client-name').value || 'שם הלקוח';
    const clientSub = document.getElementById('form-client-sub').value || 'כתובת הלקוח / טלפון';
    const quoteNumber = document.getElementById('form-quote-number').value || '2026-101';
    const quoteDate = document.getElementById('form-quote-date').value;
    const subject = document.getElementById('form-quote-subject').value || 'נושא הצעה';
    const summary = document.getElementById('form-summary').value;
    
    document.getElementById('pdf-client-name').textContent = clientName;
    document.getElementById('pdf-client-sub').textContent = clientSub;
    document.getElementById('pdf-number').textContent = quoteNumber;
    document.getElementById('pdf-date').textContent = formatHebrewDate(quoteDate);
    document.getElementById('pdf-subject').textContent = subject;
    document.getElementById('pdf-summary').textContent = summary;
    
    // THE MASTHEAD. These three fields had ZERO writers anywhere in the codebase
    // -- verified by grep -- so they printed whatever was typed into the markup,
    // forever, while the footer six inches below them printed the real business.
    // One A4, two different companies, and the prominent one was the placeholder.
    // A reviewer: "זה לא באג עיצובי, זה נראה כמו הצעה מזויפת."
    const setTxt = (id, v) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = v || '';
        // An empty line still takes its leading and still leaves a gap that
        // reads as something missing. No text, no line.
        el.hidden = !v;
    };
    setTxt('pdf-comp-title', (biz && biz.name) || 'שם העסק שלך');
    setTxt('pdf-comp-sub', biz && biz.tagline);
    setTxt('pdf-comp-owner', biz && biz.owner);

    const footerTextElement = document.querySelector('.pdf-company-footer');
    if (footerTextElement && biz) {
        footerTextElement.innerHTML = `
            ${(() => {
                const row = (cls, parts) => {
                    const bits = parts.filter(Boolean);
                    if (!bits.length) return '';
                    return `<div class="footer-row ${cls}">` + bits.map((b, i) =>
                        `${i ? '<span class="bullet">|</span>' : ''}<span>${b}</span>`).join('') + '</div>';
                };
                return [
                    row('font-bold', [biz.name, biz.owner, biz.id]),
                    // The licence number belongs beside the identity, not buried.
                    // It is the one credential an Israeli customer can verify, and
                    // for most of the work in this app it is a legal requirement
                    // that the tradesman holds it.
                    row('text-secondary', [biz.license && `רישיון חשמלאי: ${biz.license}`]),
                    row('text-secondary', [
                        biz.email && `אימייל: ${biz.email}`,
                        biz.phone && `סלולרי: ${biz.phone}`,
                        biz.web && `אתר: ${biz.web}`,
                    ]),
                    row('text-secondary', [biz.address && `כתובת: ${biz.address}`]),
                ].join('');
            })()}
            <div class="footer-notice">
                עם אישור וחתימת הלקוח תשמש הצעה זו כהסכם לביצוע העבודה בהתאם לאמור בה.
            </div>
            ${zeremCreditHtml()}
        `;
    }
    
    // A finished document hides an empty row; an editor must show it, or a row
    // you just added has nowhere to be typed.
    const itemsList = sheetEditable() ? getWorkItemsFromForm(true) : getWorkItemsFromForm();
    const pdfItemsContainer = document.getElementById('pdf-work-items');
    pdfItemsContainer.innerHTML = '';
    
    const isItemized = appState.currentQuote.showItemizedPrices;
    
    if (isItemized) {
        const table = document.createElement('table');
        table.className = 'pdf-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="width: 8%; text-align: center;">סעיף</th>
                    <th style="width: 72%;">תיאור ותכולת העבודה</th>
                    <th style="width: 20%; text-align: left;">מחיר (₪)</th>
                </tr>
            </thead>
            <tbody>
            </tbody>
        `;
        const tbody = table.querySelector('tbody');
        
        itemsList.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.dataset.itemIndex = idx;
            // While editing, an empty description still needs somewhere to
            // click, so the line exists (empty) instead of vanishing.
            const showDesc = item.description || sheetEditable();
            tr.innerHTML = `
                <td style="font-family: 'Outfit', sans-serif; font-weight: 700; text-align: center;">${idx + 1}</td>
                <td>
                    <div data-item-field="title" style="font-weight: 700; color: var(--pdf-primary); text-decoration: underline; margin-bottom: 4px;">${escapeHtml(item.title) || 'סעיף ללא כותרת'}</div>
                    ${showDesc ? `<div data-item-field="description" style="white-space: pre-line; line-height: 1.5; color: var(--pdf-text-main); font-size: 0.9rem;">${escapeHtml(item.description)}</div>` : ''}
                </td>
                <td style="font-family: 'Outfit', 'Rubik', sans-serif; font-weight: 700; text-align: left; color: var(--pdf-primary);">
                    <span data-item-field="price">${formatPriceString(item.price || 0)}</span> ₪
                    ${sheetEditable() ? `<button type="button" class="sheet-row-del" onclick="sheetDeleteRow(${idx})" title="מחיקת שורה" aria-label="מחיקת שורה">✕</button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
        pdfItemsContainer.appendChild(table);
    } else {
        itemsList.forEach((item, idx) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'pdf-work-item';
            itemEl.dataset.itemIndex = idx;
            const showDesc = item.description || sheetEditable();
            itemEl.innerHTML = `
                <div class="pdf-item-title">${idx + 1}. <span data-item-field="title">${escapeHtml(item.title) || 'סעיף ללא כותרת'}</span>
                    ${sheetEditable() ? `<button type="button" class="sheet-row-del" onclick="sheetDeleteRow(${idx})" title="מחיקת שורה" aria-label="מחיקת שורה">✕</button>` : ''}
                </div>
                ${showDesc ? `<div class="pdf-item-desc" data-item-field="description">${escapeHtml(item.description)}</div>` : ''}
            `;
            pdfItemsContainer.appendChild(itemEl);
        });
    }
    
    syncCurrentQuoteToProject();
    renderPageGuides();

    // The terms live on the same sheet and follow the same data.
    try { renderQuoteTerms(); } catch (e) {}
    // Whatever was just re-rendered has to be typeable again.
    try { applySheetEditing(); } catch (e) {}
}

// ── Where the paper actually ends ────────────────────────────────────────────
// The preview is one continuous A4-shaped sheet, so a quote that runs long
// looks fine on screen and then arrives as two pages — the second one holding
// nothing but the footer. Nothing in the editor said so until the PDF existed.
//
// html2pdf captures the sheet at its full height and slices it across A4 pages
// with a 10mm margin, so one page holds the source pixels that map to the
// 190×277mm content box — NOT the sheet's own 1123px height. Deriving it from
// the same numbers the export uses keeps the line honest.
const PDF_PAGE = { widthMm: 210, heightMm: 297, marginMm: 10 };

function pdfPageHeightPx(sheetWidthPx) {
    const contentW = PDF_PAGE.widthMm - 2 * PDF_PAGE.marginMm;
    const contentH = PDF_PAGE.heightMm - 2 * PDF_PAGE.marginMm;
    return sheetWidthPx * (contentH / contentW);
}

function renderPageGuides() {
    const sheet = document.getElementById('quote-pdf-sheet');
    if (!sheet) return;
    sheet.querySelectorAll('.page-guide').forEach((el) => el.remove());

    const pageH = pdfPageHeightPx(sheet.offsetWidth);
    if (!isFinite(pageH) || pageH <= 0) return;
    const total = Math.max(sheet.scrollHeight, sheet.offsetHeight);
    const pages = Math.ceil(total / pageH);

    for (let i = 1; i < pages; i++) {
        const guide = document.createElement('div');
        guide.className = 'page-guide';
        guide.style.top = `${Math.round(pageH * i)}px`;
        guide.setAttribute('aria-hidden', 'true');
        guide.innerHTML = `<span class="page-guide-label">עמוד ${i + 1}</span>`;
        sheet.appendChild(guide);
    }

    const warn = document.getElementById('page-overflow-warning');
    if (!warn) return;

    // A real quote: five items and a full exclusions list: measures about
    // 1,850px against a 1,158px page, so running to two pages is the normal
    // case, not the exception. Warning every time would make this noise, and a
    // warning that always fires is one nobody reads.
    //
    // What is actually worth saying is the ugly case: a last page holding a
    // scrap, which is how the company footer ended up alone on page two. Below
    // a fifth of a page, that tail is worth trimming away; above it, the quote
    // simply is two pages and the dashed guide is all anyone needs.
    const tail = total - pageH * (pages - 1);
    const ORPHAN = pageH * 0.2;
    if (pages > 1 && tail < ORPHAN) {
        // In lines, not pixels: the number has to mean something to the person
        // holding the paper.
        const lineH = parseFloat(getComputedStyle(sheet).lineHeight) || 17;
        const spillLines = Math.max(1, Math.round(tail / lineH));
        // Hebrew does not take a bare numeral for one. "1 שורות" reads as
        // machine output, which is the opposite of what this product is for.
        const spilled = spillLines === 1
            ? 'שורה אחת בלבד גלשה'
            : `רק <strong>${spillLines}</strong> שורות גלשו`;
        warn.style.display = 'flex';
        warn.innerHTML = `<i class="fa-solid fa-scissors"></i>`
            + `<span>${spilled} לעמוד ${pages}. `
            + `קיצור קל של ההערות או של אחד הסעיפים יחזיר את ההצעה לעמוד אחד.</span>`;
    } else {
        warn.style.display = 'none';
    }
}

// The user's LAST choice in the editor becomes the default for the next new
// quote/project (Stav: "יזכור את השינויים ויעשה כמו המצב האחרון שבחרתי").
function rememberQuotePref(key, value) {
    if (!appState.settings) appState.settings = {};
    if (!appState.settings.lastQuotePrefs) appState.settings.lastQuotePrefs = {};
    appState.settings.lastQuotePrefs[key] = value;
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
}
function lastQuotePref(key, fallback) {
    const p = appState.settings && appState.settings.lastQuotePrefs;
    return p && key in p ? p[key] : fallback;
}

function toggleItemizedPrices(checked, syncProject = true) {
    appState.currentQuote.showItemizedPrices = checked;
    // Only a real user action updates the sticky default (loading a project
    // passes syncProject=false and must not overwrite the preference).
    if (syncProject) rememberQuotePref('showItemizedPrices', checked);

    // Sync checkmarks
    const editToggle = document.getElementById('form-itemized-prices-toggle');
    if (editToggle) editToggle.checked = checked;

    const items = getWorkItemsFromForm();
    
    const container = document.getElementById('work-items-container');
    container.innerHTML = '';
    items.forEach(item => {
        addWorkItemRow(item.title, item.description, item.price || 0);
    });
    
    const basePriceInput = document.getElementById('form-base-price');
    if (checked) {
        basePriceInput.readOnly = true;
        basePriceInput.classList.add('readonly-highlight');
        calculateItemizedTotal();
    } else {
        basePriceInput.readOnly = false;
        basePriceInput.classList.remove('readonly-highlight');
        calculateTotal();
    }
    
    if (syncProject) {
        syncCurrentQuoteToProject();
    }
    updatePreviewFromForm();
}
