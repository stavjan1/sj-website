// ============================================================================
//  מחירון השוק — what the trade charges, next to what you charge
// ============================================================================
// Lifted out of sale/app.js on 25/08/2026, unchanged. The anonymous per-item
// benchmark: collection, the comparison table, and adopting a price into your
// own book.

// ==========================================================================
// Market prices: what the trade charges for each line item, next to what you
// charge. Fed by the anonymous per-item samples every PDF export contributes
// (stats:items:<profession>:<name> in KV) — names and prices only, never a
// customer. Sorting is the whole point: the gap column is where money hides.
// ==========================================================================
let marketData = null;          // { items:[{name, count, median, low, high}] }
let marketSort = 'gap';
let catalogView = 'mine';

function setCatalogView(view) {
    catalogView = view === 'market' ? 'market' : 'mine';
    const mine = document.getElementById('catalog-view-mine');
    const market = document.getElementById('catalog-view-market');
    if (mine) mine.hidden = catalogView === 'market';
    if (market) market.hidden = catalogView !== 'market';
    document.querySelectorAll('#catalog-subtabs .subtab').forEach(b => {
        const on = b.dataset.sub === catalogView;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
    });
    if (catalogView === 'market') renderMarketPrices();
}

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
            const prof = (appState.settings && appState.settings.profession) || 'general';
            const headers = {};
            if (googleAccessToken && !isGuestUser()) headers['Authorization'] = 'Bearer ' + googleAccessToken;
            const res = await fetch('/api/stats?market=1&prof=' + encodeURIComponent(prof), { headers });
            marketData = await res.json();
        } catch (e) { marketData = { items: [] }; }
    }
    const items = (marketData && marketData.items) || [];
    if (!items.length) {
        box.innerHTML = `<div class="catalog-empty">עדיין אין מספיק נתוני שוק בתחום שלך.<br>
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
    showToast(`"${name}" נוסף למאגר לפי מחיר השוק`);
}

function renderPriceCatalog() {
    const list = document.getElementById('catalog-list');
    const countEl = document.getElementById('catalog-count');
    if (countEl) countEl.textContent = priceCatalog.length;
    if (!list) return;
    const q = (document.getElementById('catalog-search')?.value || '').toLowerCase().trim();
    if (priceCatalog.length === 0) {
        list.innerHTML = '<div class="catalog-empty">המאגר ריק. סרוק דף ספק או הוסף פריט ידנית.</div>';
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

function clearPriceCatalog() {
    if (priceCatalog.length === 0) return;
    if (!confirm('לרוקן את כל מאגר המחירים? פעולה זו אינה הפיכה.')) return;
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
    if (mode === 'anonymous') return { name: 'אנונימי', email: '', phone, profession: '' };
    const activeUser = getActiveUser() || '';
    const senderEmail = isGuestUser() ? '' : (activeUser.includes('@') ? activeUser : '');
    return {
        name: isGuestUser() ? 'אורח' : (localStorage.getItem('gsi_name') || senderEmail.split('@')[0] || 'משתמש'),
        email: senderEmail,
        phone,
        profession: (appState.settings && appState.settings.profession) || ''
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
        vatType: 'exempt',
        finalPrice: 0,
        summary: appState.settings.businessDetails.terms,
        showItemizedPrices: false
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
    document.getElementById('form-vat-type').value = val(q.vatType, 'exempt');
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
// Quotes are escaped too: this helper is used inside double-quoted attributes
// (value="...", title="...", data-email="...") in several places, and without
// quote-escaping a value like `" onfocus=alert(1) x="` breaks straight out of
// the attribute without ever needing a "<". In text position `&quot;` simply
// renders as a normal quote, so escaping it everywhere is free.
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) {
    return escapeHtml(s);
}

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
                <input type="number" class="item-price-input" placeholder="מחיר" value="${price || ''}" oninput="calculateItemizedTotal()">
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

function getWorkItemsFromForm(includeEmpty) {
    const items = [];
    const container = document.getElementById('work-items-container');
    
    Array.from(container.children).forEach(row => {
        const title = row.querySelector('.item-title-input').value.trim();
        const desc = row.querySelector('.item-desc-input').value.trim();
        const priceInput = row.querySelector('.item-price-input');
        const price = priceInput ? (parseFloat(priceInput.value) || 0) : 0;
        
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

function calculateTotal() {
    const basePriceInput = document.getElementById('form-base-price').value;
    const basePrice = parseFloat(basePriceInput) || 0;
    const vatType = document.getElementById('form-vat-type').value;

    let finalPrice = basePrice;
    let vatLabel = 'פטור ממע"מ (עוסק פטור)';

    if (vatType === 'exclude') {
        finalPrice = basePrice * (1 + VAT_RATE);
        vatLabel = `לא כולל מע"מ (נוסף ${VAT_PCT}% מע"מ)`;
    } else if (vatType === 'include') {
        vatLabel = `כולל מע"מ (בשיעור ${VAT_PCT}%)`;
    }
    
    const roundedPrice = Number(finalPrice.toFixed(2));
    
    document.getElementById('form-final-price').value = formatPriceString(roundedPrice) + ' ש"ח';
    document.getElementById('pdf-total-price').textContent = formatPriceString(roundedPrice) + ' ש"ח';
    document.getElementById('pdf-vat-label').textContent = vatLabel;
    
    appState.currentQuote.basePrice = basePriceInput;
    appState.currentQuote.vatType = vatType;
    appState.currentQuote.finalPrice = roundedPrice;
    
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
        const res = await fetch('/api/quote-share?t=' + encodeURIComponent(proj.shareToken));
        const body = await res.json().catch(() => ({}));
        const approved = body && body.data && body.data.approved;
        if (!approved || !approved.at) return;
        proj.approvedAt = approved.at;
        proj.approvedBy = approved.name || '';
        // The status vocabulary stays as it is (draft / sent / done / paid) —
        // approval is a fact about the quote, shown as its own mark, not a
        // fifth status that every filter and board would have to learn.
        saveProjects();
        filterProjectsList();
        showToast(`הלקוח אישר את ההצעה${approved.name ? ': ' + approved.name : ''}`);
    } catch (e) { /* offline, or the link was deleted */ }
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
                ${PAYMENT_PRESETS.map((t, i) => `<button type="button" class="chip" onclick="pickPaymentPreset(${i})">${escapeHtml(t.length > 34 ? t.slice(0, 34) + '…' : t)}</button>`).join('')}
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
        const input = row.querySelector('.item-price-input');
        if (input) { input.value = String(value).replace(/[^\d.]/g, ''); calculateItemizedTotal(); }
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
function openClientPicker() {
    const old = document.getElementById('client-picker');
    if (old) old.remove();
    const dlg = document.createElement('dialog');
    dlg.id = 'client-picker';
    dlg.className = 'ck-dialog';
    const rows = (clientsList || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'he'));
    dlg.innerHTML = `
        <h3>בחירת לקוח</h3>
        <div class="search-bar">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input type="text" id="cl-pick-q" placeholder="חיפוש לקוח…" oninput="renderClientPicker()">
        </div>
        <div class="cp-list" id="cl-pick-list"></div>
        <div class="ck-dialog-actions">
            <button type="button" class="btn btn-accent" onclick="pickNewClient()">
                <i class="fa-solid fa-plus" aria-hidden="true"></i> הוספת לקוח חדש
            </button>
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('client-picker').close()">ביטול</button>
        </div>`;
    document.body.appendChild(dlg);
    renderClientPicker();
    dlg.showModal();
}

function renderClientPicker() {
    const box = document.getElementById('cl-pick-list');
    if (!box) return;
    const q = ((document.getElementById('cl-pick-q') || {}).value || '').trim().toLowerCase();
    const rows = (clientsList || []).filter((c) => !q || String(c.name || '').toLowerCase().includes(q)
        || String(c.phone || '').includes(q));
    if (!rows.length) {
        box.innerHTML = `<p class="input-help">${(clientsList || []).length ? 'לא נמצא לקוח תואם.' : 'עוד אין לקוחות שמורים. אפשר להוסיף אחד עכשיו.'}</p>`;
        return;
    }
    box.innerHTML = rows.map((c) => `
        <button type="button" class="cp-row" onclick="pickClient('${escapeHtml(c.id)}')">
            <span class="cp-name">${escapeHtml(c.name)}</span>
            <span class="cp-price">${escapeHtml([c.phone, c.city].filter(Boolean).join(' · '))}</span>
        </button>`).join('');
}

function pickClient(id) {
    const client = (clientsList || []).find((c) => c.id === id);
    const dlg = document.getElementById('client-picker');
    if (dlg) { dlg.close(); dlg.remove(); }
    if (!client) return;
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

function pickNewClient() {
    const name = (window.prompt('שם הלקוח:') || '').trim();
    if (!name) return;
    const phone = (window.prompt('טלפון (אפשר להשאיר ריק):') || '').trim();
    const address = (window.prompt('כתובת (אפשר להשאיר ריק):') || '').trim();
    const client = { id: 'cli' + Date.now(), name, phone, email: '', address, city: '', dealerNumber: '', tags: [] };
    clientsList.unshift(client);
    saveClients();
    pickClient(client.id);
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
    
    const footerTextElement = document.querySelector('.pdf-company-footer');
    if (footerTextElement && biz) {
        footerTextElement.innerHTML = `
            <div class="footer-row font-bold">
                <span>${biz.name}</span>
                <span class="bullet">|</span>
                <span>${biz.owner}</span>
                <span class="bullet">|</span>
                <span>${biz.id}</span>
            </div>
            <div class="footer-row text-secondary">
                <span>אימייל: ${biz.email}</span>
                <span class="bullet">|</span>
                <span>סלולרי: ${biz.phone}</span>
                <span class="bullet">|</span>
                <span>אתר: ${biz.web}</span>
            </div>
            <div class="footer-row text-secondary">
                <span>כתובת: ${biz.address}</span>
            </div>
            <div class="footer-notice">
                הצעת מחיר זו תקפה לשלושה חודשים. עם אישור וחתימת הלקוח תשמש כהסכם לביצוע העבודה בהתאם לאמור בה.
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

    const settingsToggle = document.getElementById('set-show-itemized-prices');
    if (settingsToggle) settingsToggle.checked = checked;
    
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
