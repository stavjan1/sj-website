// ZEREM PRO — cash-flow dashboard (תזרים מזומנים): bank/card accounts, anchor-day
// cycles, safety floor, past+forecast curve, Financy connector; + Telegram report import.
// Loads after app.js and uses its globals (isAdmin, showToast, getStorageKey,
// switchTab, escapeHtml). Server side: /api/finance (admin-gated).
(function () {
    'use strict';

    // ── auth: the same token the app already holds ─────────────────────────
    function activeUser() {
        // app.js owns identity — fall back to raw storage only if it's absent
        if (typeof getActiveUser === 'function') return (getActiveUser() || '').toLowerCase();
        return (localStorage.getItem('sj_logged_in_user') || sessionStorage.getItem('sj_logged_in_user') || '').toLowerCase();
    }
    function authToken() {
        const u = activeUser();
        if (!u) return null;
        // Prefer the app's LIVE token (it silently refreshes after boot) over
        // whatever storage still holds — this is what 401-raced before.
        if (typeof googleAccessToken !== 'undefined' && googleAccessToken) return googleAccessToken;
        if (typeof getStorageKey === 'function' && typeof getSessionOrLocalStorageItem === 'function') {
            return getSessionOrLocalStorageItem(getStorageKey('sj_drive_access_token')) || null;
        }
        const key = 'sj_user_' + u + '_sj_drive_access_token';
        return localStorage.getItem(key) || sessionStorage.getItem(key) || null;
    }

    // PRO gate: the owner always; paying plans on their own numbers.
    function hasProAccess() {
        if (typeof isAdmin === 'function' && isAdmin()) return true;
        const tier = (typeof userTier !== 'undefined' && userTier && userTier.tier) || '';
        return tier === 'pro' || tier === 'business';
    }

    const fmtILS = (n) => (typeof nisFmt === 'function') ? nisFmt(n) : '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));

    let finMonth = null;     // 'YYYY-MM' shown in the monthly view (default: this month)
    let fin = null;          // the KV record
    let invoiceIncome = [];  // derived from ZEREM invoices (server)
    let saveTimer = null;

    // ── data ───────────────────────────────────────────────────────────────
    async function liveToken() {
        // ensureGoogleToken() refreshes an expired token on demand; without it
        // an hour-old session shows "נדרשת התחברות" while the avatar still smiles.
        if (typeof ensureGoogleToken === 'function') {
            try { const t = await ensureGoogleToken(); if (t) return t; } catch (e) { /* fall through */ }
        }
        return authToken();
    }

    class NoTokenError extends Error {}

    // The out-loud Google sign-in must start on the click itself (popup rules),
    // so this runs from the card's button, then waits for the token to land.
    window.proSignIn = function proSignIn(btn) {
        if (btn) { btn.disabled = true; btn.textContent = 'מתחבר…'; }
        try {
            if (typeof adminSignInNow === 'function') adminSignInNow(btn);
            else if (typeof handleGoogleLogin === 'function') handleGoogleLogin();
        } catch (e) { /* the poll below decides */ }
        const started = Date.now();
        const poll = setInterval(() => {
            const fresh = (typeof _tokenIsFresh === 'function') ? _tokenIsFresh() : !!authToken();
            if (fresh) { clearInterval(poll); fin = null; window.renderFinance(); }
            else if (Date.now() - started > 25000) {
                clearInterval(poll);
                if (btn) { btn.disabled = false; btn.textContent = 'התחבר מחדש'; }
            }
        }, 500);
    };

    async function loadFinance(retried) {
        const token = await liveToken();
        if (!token) throw new NoTokenError('no-token');
        const res = await fetch('/api/finance', { headers: { Authorization: 'Bearer ' + token } });
        if (res.status === 401 && !retried) {
            // The app refreshes its Google token silently right after boot —
            // wait for it once instead of failing on a token that just expired.
            await new Promise(r => setTimeout(r, 2500));
            return loadFinance(true);
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(res.status === 401
            ? 'ההתחברות התיישנה · התנתקו והתחברו שוב, ואז פתחו את הלשונית מחדש'
            : (data.error && data.error.message) || 'שגיאה בטעינה');
        fin = data.data || { accounts: [], entries: [], recurring: [], settings: {} };
        invoiceIncome = Array.isArray(data.invoiceIncome) ? data.invoiceIncome : [];
    }

    async function saveNow(useKeepalive) {
        const token = useKeepalive ? authToken() : await liveToken();
        if (!token || !fin) return;
        try {
            const res = await fetch('/api/finance', {
                method: 'PUT',
                keepalive: !!useKeepalive,
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ data: fin }),
            });
            if (!res.ok && typeof showToast === 'function' && !useKeepalive) {
                showToast(res.status === 401 ? 'השמירה נכשלה, ההתחברות פגה, רעננו והתחברו שוב' : 'שמירת הנתונים הפיננסיים נכשלה', 'error');
            }
        } catch (e) { if (typeof showToast === 'function' && !useKeepalive) showToast('שמירת הנתונים הפיננסיים נכשלה, בדקו חיבור', 'error'); }
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveNow(false), 1200);
    }
    // A pending edit must not die with the tab — flush it on the way out.
    addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(true); } });

    // ── settings with defaults (stored in the KV record, per account) ─────
    const BANKS = {
        leumi:    { label: 'לאומי',        color: '#1E5AA8', mark: 'L' },
        hapoalim: { label: 'הפועלים',      color: '#D9272E', mark: 'P' },
        discount: { label: 'דיסקונט',      color: '#0A7A3E', mark: 'D' },
        mizrahi:  { label: 'מזרחי-טפחות',  color: '#E8770F', mark: 'M' },
        onezero:  { label: 'OneZero',      color: '#111111', mark: '0' },
        pepper:   { label: 'פפר',          color: '#E3007D', mark: 'p' },
        yahav:    { label: 'יהב',          color: '#7A4B9E', mark: 'Y' },
        jerusalem:{ label: 'ירושלים',      color: '#1F6F8B', mark: 'J' },
        max:      { label: 'MAX',          color: '#5A2D82', mark: 'mx' },
        isracard: { label: 'ישראכרט',      color: '#0A66C2', mark: 'IC' },
        cal:      { label: 'כאל',          color: '#00A19B', mark: 'C' },
        amex:     { label: 'אמריקן אקספרס', color: '#2E77BB', mark: 'AX' },
        other:    { label: 'אחר',          color: '#79716B', mark: '·' },
    };
    const HE_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
    let finCycleOffset = 0;
    let finView = 'open';      // 'open' (Financy bank feed) | 'manual' (hand-kept books)   // 0 = the current cycle, -1 = the one before…

    function settings() {
        fin.settings = fin.settings || {};
        const s = fin.settings;
        if (!Number(s.anchorDay)) s.anchorDay = 10;
        if (typeof s.safetyFloor !== 'number') s.safetyFloor = 0;
        if (!Array.isArray(s.selected)) s.selected = [];
        if (typeof s.multi !== 'boolean') s.multi = false;
        if (!s.viewYear) s.viewYear = new Date().getFullYear();
        return s;
    }
    const accounts = () => (fin.accounts || []);
    const isCard = (a) => a.kind === 'card';
    function selectedAccounts() {
        const s = settings();
        const all = accounts();
        const sel = all.filter(a => s.selected.includes(a.id));
        return sel.length ? sel : all;
    }
    function bankOf(a) { return BANKS[a.institution] || BANKS.other; }
    function localISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };

    // ── cycles: anchor day to anchor day (credit-card charge / salary day) ──
    function anchorOnOrBefore(d) {
        const a = settings().anchorDay;
        const x = new Date(d.getFullYear(), d.getMonth(), Math.min(a, 28), 12);
        if (x > d) x.setMonth(x.getMonth() - 1);
        return x;
    }
    function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
    function cycleAt(offset) {
        const start = addMonths(anchorOnOrBefore(today()), offset);
        const end = addMonths(start, 1);            // exclusive
        return { start, end, label: `${start.getDate()}.${start.getMonth() + 1} – ${end.getDate()}.${end.getMonth() + 1}` };
    }

    // Everything that lands in a window [from, to): actuals (entries + paid
    // documents), expected documents (by terms), fixed charges, card charges.
    function itemsBetween(from, to) {
        const fromISO = localISO(from), toISO = localISO(to);
        const inWin = (iso) => typeof iso === 'string' && iso >= fromISO && iso < toISO;
        const sel = new Set(selectedAccounts().map(a => a.id));
        const items = [];
        (fin.entries || []).forEach(e => {
            if (e.accountId && !sel.has(e.accountId)) return;
            if (inWin(e.date)) items.push({ date: e.date, desc: e.desc, amount: Number(e.amount) || 0, kind: 'actual' });
        });
        invoiceIncome.forEach(inv => {
            if (inv.paid) { if (inWin(inv.date)) items.push({ date: inv.date, desc: inv.desc, amount: inv.amount, kind: 'actual' }); }
            else if (inWin(inv.dueDate)) items.push({ date: inv.dueDate, desc: inv.desc + ' (לפי תנאי התשלום)', amount: inv.amount, kind: 'expected' });
        });
        // fixed charges: once per calendar month in the window, on their day
        for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d < to; d = addMonths(d, 1)) {
            const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            (fin.recurring || []).forEach(r => {
                const day = Math.min(Math.max(Number(r.dayOfMonth) || 1, 1), dim);
                const iso = localISO(new Date(d.getFullYear(), d.getMonth(), day, 12));
                if (inWin(iso) && iso >= localISO(today())) items.push({ date: iso, desc: r.name || 'חיוב קבוע', amount: Number(r.amount) || 0, kind: 'recurring' });
            });
        }
        // credit cards: the outstanding balance is charged on the next anchor day
        const nextAnchor = addMonths(anchorOnOrBefore(today()), 1);
        const nextISO = localISO(nextAnchor);
        selectedAccounts().filter(isCard).forEach(c => {
            const due = -Math.abs(Number(c.balance) || 0);
            const when = (c.dueDate && c.dueDate >= localISO(today())) ? c.dueDate : nextISO;
            if (due && inWin(when)) items.push({ date: when, desc: `חיוב ${bankOf(c).label}${c.mask ? ' ' + c.mask : ''}`, amount: due, kind: 'card' });
        });
        return items.sort((a, b) => a.date.localeCompare(b.date));
    }

    // ── the curve: actual balance reconstructed backwards, forecast forwards ──
    function buildCurve() {
        const s = settings();
        const now = today();
        const cashNow = selectedAccounts().filter(a => !isCard(a)).reduce((t, a) => t + (Number(a.balance) || 0), 0);
        const yearStart = new Date(s.viewYear, 0, 1, 12);
        const from = (s.viewYear === now.getFullYear()) ? (now - yearStart > 120 * 864e5 ? new Date(now - 120 * 864e5) : yearStart) : yearStart;
        const pastEnd = (s.viewYear === now.getFullYear()) ? now : new Date(s.viewYear, 11, 31, 12);
        // actuals by day (selected accounts)
        const sel = new Set(selectedAccounts().map(a => a.id));
        const byDay = {};
        (fin.entries || []).forEach(e => { if (e.date && !(e.accountId && !sel.has(e.accountId))) byDay[e.date] = (byDay[e.date] || 0) + (Number(e.amount) || 0); });
        invoiceIncome.forEach(inv => { if (inv.paid && inv.date) byDay[inv.date] = (byDay[inv.date] || 0) + inv.amount; });
        const past = [];
        let bal = cashNow;
        for (let d = new Date(pastEnd); d >= from; d.setDate(d.getDate() - 1)) {
            const iso = localISO(d);
            past.unshift({ date: iso, bal });
            bal -= (byDay[iso] || 0);
        }
        const future = [];
        if (s.viewYear === now.getFullYear()) {
            const horizon = addMonths(anchorOnOrBefore(now), 2); // through the end of the next full cycle
            const fut = itemsBetween(new Date(now.getTime() + 864e5), horizon);
            let f = cashNow;
            for (let d = new Date(now.getTime() + 864e5); d < horizon; d.setDate(d.getDate() + 1)) {
                const iso = localISO(d);
                fut.forEach(i => { if (i.date === iso) f += i.amount; });
                future.push({ date: iso, bal: f });
            }
        }
        return { past, future, cashNow };
    }

    function curveSvg() {
        const { past, future } = buildCurve();
        const s = settings();
        const pts = [...past, ...future];
        if (pts.length < 2) return '<div class="empty"><h3>אין עדיין נתונים לעקומה</h3><p>חברו בנק (Financy) או הוסיפו חשבון ותנועות.</p></div>';
        const W = 760, H = 240, PL = 44, PR = 16, PT = 26, PB = 28;
        const vals = pts.map(p => p.bal);
        let min = Math.min(...vals, 0, s.safetyFloor || 0), max = Math.max(...vals, 1, s.safetyFloor || 0);
        if (max === min) max = min + 1;
        const x = (i) => PL + (W - PL - PR) * (i / (pts.length - 1));
        const y = (v) => H - PB - (H - PT - PB) * ((v - min) / (max - min));
        const line = (arr, off) => arr.map((p, i) => `${x(i + off).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ');
        const todayX = x(past.length - 1);
        const grid = [min, (min + max) / 2, max];
        // month labels where the month changes
        const labels = [];
        pts.forEach((p, i) => { if (i === 0 || p.date.slice(5, 7) !== pts[i - 1].date.slice(5, 7)) labels.push({ x: x(i), t: HE_MONTHS[Number(p.date.slice(5, 7)) - 1] }); });
        const floorY = s.safetyFloor ? y(s.safetyFloor) : null;
        const dips = s.safetyFloor ? future.some(p => p.bal < s.safetyFloor) : false;
        return `
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="עקומת המזומן, עבר וצפי" style="width:100%;height:auto;direction:ltr;">
            ${grid.map(v => `<line x1="${PL}" x2="${W - PR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
            <text x="${PL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-3)">${Math.round(v / 1000)}k</text>`).join('')}
            ${labels.map(l => `<text x="${l.x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">${l.t}</text>`).join('')}
            ${floorY !== null ? `<line x1="${PL}" x2="${W - PR}" y1="${floorY.toFixed(1)}" y2="${floorY.toFixed(1)}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="4 4"/>
            <text x="${W - PR}" y="${(floorY - 5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--danger)">סף ביטחון</text>` : ''}
            <line x1="${todayX.toFixed(1)}" x2="${todayX.toFixed(1)}" y1="${PT}" y2="${H - PB}" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${todayX.toFixed(1)}" y="${PT - 8}" text-anchor="middle" font-size="10" fill="var(--text-2)">היום</text>
            <polyline points="${line(past, 0)}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
            ${future.length ? `<polyline points="${line([past[past.length - 1], ...future], past.length - 1)}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-dasharray="6 5" opacity="0.8"/>` : ''}
        </svg>
        ${dips ? `<p class="fin-warn">הצפי יורד מתחת לסף הביטחון במהלך המחזור הבא.</p>` : ''}`;
    }

    // ── pieces of the screen ────────────────────────────────────────────────
    function accountsHtml() {
        const s = settings();
        const all = accounts();
        if (!all.length) return `<div class="fin-accounts-empty"><p class="fin-muted">עוד אין חשבונות. חברו את הבנקים דרך Financy, או הוסיפו חשבון ידנית למטה.</p></div>`;
        const selected = new Set(s.selected.length ? s.selected : all.map(a => a.id));
        return `<div class="fin-accounts">${all.map(a => {
            const b = bankOf(a);
            const on = selected.has(a.id);
            const amt = Number(a.balance) || 0;
            return `<button type="button" class="fin-acc ${on ? 'on' : ''} ${isCard(a) ? 'card' : ''}" data-acc-pick="${esc(a.id)}" title="${on ? 'מוצג' : 'לחץ להצגה'}">
                <span class="bank-badge" style="--bank:${b.color}">${esc(b.mark)}</span>
                <span class="fin-acc-text"><b>${esc(a.name || b.label)}</b><small>${esc(isCard(a) ? 'חיוב קרוב' : 'יתרה')}${a.mask ? ' · ' + esc(a.mask) : ''}</small></span>
                <span class="fin-acc-amt num ${isCard(a) ? 'status-danger' : ''}">${fmtILS(isCard(a) ? -Math.abs(amt) : amt)}</span>
                <span class="fin-acc-check" aria-hidden="true">${on ? '✓' : ''}</span>
            </button>`;
        }).join('')}</div>`;
    }

    function chipsHtml() {
        const s = settings();
        const years = Array.from(new Set([new Date().getFullYear(), ...(fin.entries || []).map(e => Number(String(e.date || '').slice(0, 4))).filter(Boolean)])).sort();
        return `<div class="fin-chips">
            <span class="fin-chip-label">יום עוגן</span>
            ${[1, 10, 15].map(d => `<button type="button" class="chip ${s.anchorDay === d ? 'on' : ''}" data-anchor="${d}">${d}</button>`).join('')}
            <input class="input fin-anchor-custom" type="number" min="1" max="28" value="${[1, 10, 15].includes(s.anchorDay) ? '' : s.anchorDay}" placeholder="אחר" data-anchor-custom aria-label="יום עוגן אחר">
            <span class="fin-chip-sep"></span>
            <button type="button" class="chip ${s.multi ? 'on' : ''}" data-multi>בחירה מרובה</button>
            <span class="fin-chip-sep"></span>
            ${years.map(y => `<button type="button" class="chip ${s.viewYear === y ? 'on' : ''}" data-year="${y}">${y}</button>`).join('')}
            <span class="fin-chip-sep"></span>
            <label class="fin-floor">סף ביטחון <input class="input num" type="number" step="500" value="${s.safetyFloor || ''}" placeholder="₪" data-floor></label>
        </div>`;
    }

    function cycleCardHtml() {
        const c = cycleAt(finCycleOffset);
        const items = itemsBetween(c.start, c.end);
        const inSum = items.filter(i => i.amount > 0).reduce((t, i) => t + i.amount, 0);
        const outSum = items.filter(i => i.amount < 0).reduce((t, i) => t + i.amount, 0);
        const title = finCycleOffset === 0 ? 'המחזור הנוכחי' : finCycleOffset < 0 ? 'מחזור שנסגר' : 'מחזור עתידי';
        const rows = items.length ? items.map(i => `<li class="${i.kind}">
                <span>${esc(i.desc)}</span>
                <span class="num ${i.amount >= 0 ? 'status-ok' : 'status-danger'}">${fmtILS(i.amount)}</span>
                <small>${esc(i.date.slice(8, 10))}.${esc(i.date.slice(5, 7))}${i.kind === 'expected' ? ' · צפוי' : i.kind === 'recurring' ? ' · קבוע' : i.kind === 'card' ? ' · אשראי' : ''}</small>
            </li>`).join('') : '<li class="fin-muted">אין תנועות או צפי במחזור הזה.</li>';
        return `
        <div class="card fin-month-card">
            <div class="fin-month-head">
                <button type="button" class="btn btn-ghost btn-sm" data-cycle="1" aria-label="המחזור הבא">‹</button>
                <h3>${title} <small>${esc(c.label)}</small></h3>
                <button type="button" class="btn btn-ghost btn-sm" data-cycle="-1" aria-label="המחזור הקודם">›</button>
            </div>
            <div class="fin-cards fin-month-kpis">
                <div><div class="fin-kpi-label">נכנס</div><div class="fin-kpi num status-ok">${fmtILS(inSum)}</div></div>
                <div><div class="fin-kpi-label">יוצא</div><div class="fin-kpi num status-danger">${fmtILS(Math.abs(outSum))}</div></div>
                <div><div class="fin-kpi-label">נטו</div><div class="fin-kpi num">${fmtILS(inSum + outSum)}</div></div>
            </div>
            <ul class="fin-list">${rows}</ul>
        </div>`;
    }

    function financyCardHtml() {
        const fz = (fin.settings && fin.settings.financy) || {};
        const connected = !!fz.connected || !!(fz.clientId && fz.userId);
        const status = connected
            ? `<span class="status-ok">מחובר</span> · נתוני בנק נכון ל-${fz.dataDate ? esc(new Date(fz.dataDate).toLocaleDateString('he-IL')) : '—'} · סנכרון אחרון ${fz.lastSync ? esc(new Date(fz.lastSync).toLocaleString('he-IL')) : 'עדיין לא'}${fz.lastError ? ` · <span class="status-danger">${esc(fz.lastError)}</span>` : ''}`
            : '<span class="fin-muted">לא מחובר</span>';
        return `
        <div class="card fin-financy">
            <h3>חיבור לבנקים · Financy (בנקאות פתוחה)</h3>
            <p class="fin-muted">היתרות והתנועות של הבנקים והאשראי נמשכות לבד, בקריאה בלבד, בפיקוח בנק ישראל. נרשמים ב-Financy, מחברים שם את הבנקים, ומדביקים כאן את שלושת פרטי הגישה מהגדרות Financy → "גישה ל-API". הגישה ל-API דורשת את תוכנית Starter (₪49 לחודש); קופון מהמדריך של אילון: JC4Y-ASF5-DJTH.</p>
            <p class="fin-financy-status">${status}</p>
            <div class="fin-form-row fin-financy-fields">
                <input class="input" type="text" id="fin-fz-user" placeholder="User ID" autocomplete="off" dir="ltr">
                <input class="input" type="text" id="fin-fz-client" placeholder="Client ID" autocomplete="off" dir="ltr">
                <input class="input" type="password" id="fin-fz-secret" placeholder="Client Secret" autocomplete="off" dir="ltr">
            </div>
            <div class="fin-form-row">
                <button type="button" class="btn btn-primary" data-financy="saveCreds">שמור פרטי גישה</button>
                <button type="button" class="btn btn-quiet" data-financy="sync" ${connected ? '' : 'disabled'}>סנכרן עכשיו</button>
                <button type="button" class="btn btn-ghost" data-financy="refresh" ${connected ? '' : 'disabled'} title="מבקש מ-Financy למשוך נתונים טריים מהבנקים, עולה 20 קרדיטים">רענון מהבנקים</button>
                ${connected ? '<button type="button" class="btn btn-ghost" data-financy="disconnect">ניתוק</button>' : ''}
            </div>
            <p class="fin-muted"><a href="https://financy.open-finance.ai?ref=eilon" target="_blank" rel="noopener">להרשמה ולחיבור הבנקים ב-Financy ↗</a> · הנתונים מתעדכנים אצלם פעם ביום בבוקר (Starter) או כל 6 שעות (Pro).</p>
        </div>`;
    }

    // ── ניהול כספי: the owner's spreadsheet, as a screen ──────────────────────
    // Monthly income per client → provisions (מס הכנסה, ביטוח לאומי, קרן
    // השתלמות, פנסיה) at configurable rates with a "paid" box per month → net;
    // plus expenses per month and yearly totals. Stored additively in the
    // finance record under `books`.
    const BOOK_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const PROVISIONS = [
        { id: 'tax',     label: 'מס הכנסה',    rate: 7 },
        { id: 'bituach', label: 'ביטוח לאומי', rate: 8.61 },
        { id: 'keren',   label: 'קרן השתלמות', rate: 22.85 },
        { id: 'pension', label: 'פנסיה',       rate: 8.27 },
    ];
    let bookYear = new Date().getFullYear();
    function books() {
        fin.books = fin.books || {};
        const b = fin.books;
        if (!Array.isArray(b.incomes)) b.incomes = [];
        if (!Array.isArray(b.expenses)) b.expenses = [];
        if (!b.rates) b.rates = {};
        PROVISIONS.forEach(pv => { if (typeof b.rates[pv.id] !== 'number') b.rates[pv.id] = pv.rate; });
        if (!b.paid) b.paid = {};
        return b;
    }
    const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    function monthRows(year) {
        const b = books();
        return Array.from({ length: 12 }, (_, i) => {
            const key = ym(year, i + 1);
            const incomes = b.incomes.filter(x => x.month === key);
            const expenses = b.expenses.filter(x => x.month === key);
            const income = incomes.reduce((t, x) => t + (Number(x.amount) || 0), 0);
            const prov = {};
            PROVISIONS.forEach(pv => { prov[pv.id] = Math.round(income * (Number(b.rates[pv.id]) || 0) / 100); });
            const provTotal = Object.values(prov).reduce((t, v) => t + v, 0);
            const expense = expenses.reduce((t, x) => t + (Number(x.amount) || 0), 0);
            return { key, i, incomes, expenses, income, prov, provTotal, net: income - provTotal, expense, paid: b.paid[key] || {} };
        });
    }

    function booksSectionHtml() {
        const b = books();
        const years = Array.from(new Set([new Date().getFullYear(), ...b.incomes.map(x => Number(String(x.month).slice(0, 4))), ...b.expenses.map(x => Number(String(x.month).slice(0, 4)))].filter(Boolean))).sort();
        if (!years.includes(bookYear)) years.push(bookYear), years.sort();
        const rows = monthRows(bookYear);
        const tot = rows.reduce((t, r) => { t.income += r.income; t.prov += r.provTotal; t.net += r.net; t.expense += r.expense; PROVISIONS.forEach(pv => { t[pv.id] = (t[pv.id] || 0) + r.prov[pv.id]; }); return t; }, { income: 0, prov: 0, net: 0, expense: 0 });
        const rateTotal = PROVISIONS.reduce((t, pv) => t + (Number(b.rates[pv.id]) || 0), 0);
        const cur = ym(new Date().getFullYear(), new Date().getMonth() + 1);
        const unpaidDue = rows.filter(r => r.key <= cur && r.income > 0).flatMap(r => PROVISIONS.filter(pv => !r.paid[pv.id]).map(pv => ({ r, pv }))).length;

        const tableRows = rows.map(r => `
            <tr class="${r.key === cur ? 'is-current' : ''} ${r.income ? '' : 'is-empty'}">
                <th>${BOOK_MONTHS[r.i]}</th>
                <td class="num"><button type="button" class="bk-cell" data-bk-month="${r.key}" title="הכנסות החודש">${r.income ? fmtILS(r.income) : '—'}</button>
                    ${r.incomes.length ? `<small>${r.incomes.map(x => esc(x.client)).join(' · ')}</small>` : ''}</td>
                ${PROVISIONS.map(pv => `<td class="num bk-prov">
                    <label class="bk-paid ${r.paid[pv.id] ? 'on' : ''}"><input type="checkbox" data-bk-paid="${r.key}" data-prov="${pv.id}" ${r.paid[pv.id] ? 'checked' : ''} ${r.income ? '' : 'disabled'}> <span>${r.income ? fmtILS(r.prov[pv.id]) : '—'}</span></label>
                </td>`).join('')}
                <td class="num bk-net">${r.income ? fmtILS(r.net) : '—'}</td>
                <td class="num"><button type="button" class="bk-cell" data-bk-exp-month="${r.key}" title="הוצאות החודש">${r.expense ? fmtILS(r.expense) : '—'}</button></td>
            </tr>`).join('');

        return `
        <div class="card fin-books">
            <div class="fin-month-head">
                <h3>ניהול כספי <small>הכנסות, הפרשות והוצאות לפי חודש</small></h3>
                <div class="fin-chips" style="margin:0">${years.map(y => `<button type="button" class="chip ${y === bookYear ? 'on' : ''}" data-bk-year="${y}">${y}</button>`).join('')}</div>
            </div>
            <div class="fin-cards fin-month-kpis">
                <div><div class="fin-kpi-label">הכנסות ${bookYear}</div><div class="fin-kpi num">${fmtILS(tot.income)}</div></div>
                <div><div class="fin-kpi-label">הפרשות (${rateTotal.toFixed(2)}%)</div><div class="fin-kpi num status-danger">${fmtILS(tot.prov)}</div></div>
                <div><div class="fin-kpi-label">נטו (${(100 - rateTotal).toFixed(2)}%)</div><div class="fin-kpi num status-ok">${fmtILS(tot.net)}</div></div>
                <div><div class="fin-kpi-label">הוצאות</div><div class="fin-kpi num">${fmtILS(tot.expense)}</div></div>
            </div>
            ${unpaidDue ? `<p class="fin-warn">${unpaidDue} הפרשות של חודשים שעברו עדיין לא סומנו כשולמו.</p>` : ''}
            <div class="table-scroll">
            <table class="bk-table">
                <thead><tr><th>חודש</th><th>הכנסות</th>${PROVISIONS.map(pv => `<th>${pv.label}<br><input class="input bk-rate" type="number" step="0.01" min="0" max="100" value="${Number(b.rates[pv.id])}" data-bk-rate="${pv.id}" aria-label="אחוז ${pv.label}">%</th>`).join('')}<th>נטו</th><th>הוצאות</th></tr></thead>
                <tbody>${tableRows}</tbody>
                <tfoot><tr><th>סה"כ</th><td class="num">${fmtILS(tot.income)}</td>${PROVISIONS.map(pv => `<td class="num">${fmtILS(tot[pv.id] || 0)}</td>`).join('')}<td class="num">${fmtILS(tot.net)}</td><td class="num">${fmtILS(tot.expense)}</td></tr></tfoot>
            </table>
            </div>
            <p class="fin-muted">סימון ✓ ליד הפרשה = שולמה לחודש הזה. לחיצה על סכום הכנסות/הוצאות פותחת את פירוט החודש.</p>
            <div class="fin-grid" style="margin-block-start: var(--sp-3);">
                <form id="bk-income-form" class="bk-form">
                    <h4>הכנסה חדשה</h4>
                    <div class="fin-form-row">
                        <input class="input" type="month" id="bk-inc-month" value="${cur}" required>
                        <input class="input" type="text" id="bk-inc-client" placeholder="לקוח / מקור" required>
                        <input class="input num" type="number" id="bk-inc-amount" placeholder="סכום" min="0" required>
                        <button class="btn btn-primary" type="submit">הוסף</button>
                    </div>
                </form>
                <form id="bk-expense-form" class="bk-form">
                    <h4>הוצאה חדשה</h4>
                    <div class="fin-form-row">
                        <input class="input" type="month" id="bk-exp-month" value="${cur}" required>
                        <input class="input" type="text" id="bk-exp-desc" placeholder="על מה" required>
                        <input class="input num" type="number" id="bk-exp-amount" placeholder="סכום" min="0" required>
                        <button class="btn btn-primary" type="submit">הוסף</button>
                    </div>
                </form>
            </div>
            <div id="bk-detail"></div>
        </div>`;
    }

    function booksDetailHtml(key, kind) {
        const b = books();
        const list = (kind === 'exp' ? b.expenses : b.incomes).filter(x => x.month === key);
        const [y, m] = key.split('-').map(Number);
        return `<div class="bk-detail card">
            <h4>${kind === 'exp' ? 'הוצאות' : 'הכנסות'} · ${BOOK_MONTHS[m - 1]} ${y}</h4>
            ${list.length ? `<ul class="fin-list">${list.map(x => `<li><span>${esc(kind === 'exp' ? x.desc : x.client)}</span><span class="num">${fmtILS(x.amount)}</span>
                <button class="fin-x" data-bk-del="${esc(x.id)}" data-kind="${kind}" title="מחיקה">×</button></li>`).join('')}</ul>` : '<p class="fin-muted">אין רשומות בחודש הזה.</p>'}
        </div>`;
    }

    function wireBooks(root) {
        const b = books();
        const rerender = () => { scheduleSave(); window.renderFinance(); };
        root.querySelectorAll('[data-bk-year]').forEach(el => el.addEventListener('click', () => { bookYear = Number(el.dataset.bkYear); window.renderFinance(); }));
        root.querySelectorAll('[data-bk-rate]').forEach(el => el.addEventListener('change', () => { b.rates[el.dataset.bkRate] = Math.max(0, Math.min(100, Number(el.value) || 0)); rerender(); }));
        root.querySelectorAll('[data-bk-paid]').forEach(el => el.addEventListener('change', () => {
            const key = el.dataset.bkPaid; b.paid[key] = b.paid[key] || {}; b.paid[key][el.dataset.prov] = el.checked; rerender();
        }));
        const inc = root.querySelector('#bk-income-form');
        if (inc) inc.addEventListener('submit', (e) => {
            e.preventDefault();
            const month = root.querySelector('#bk-inc-month').value, client = root.querySelector('#bk-inc-client').value.trim(), amount = Number(root.querySelector('#bk-inc-amount').value);
            if (!/^\d{4}-\d{2}$/.test(month) || !client || !(amount > 0)) return;
            b.incomes.push({ id: 'bi' + Date.now(), month, client, amount }); bookYear = Number(month.slice(0, 4)); rerender();
        });
        const exp = root.querySelector('#bk-expense-form');
        if (exp) exp.addEventListener('submit', (e) => {
            e.preventDefault();
            const month = root.querySelector('#bk-exp-month').value, desc = root.querySelector('#bk-exp-desc').value.trim(), amount = Number(root.querySelector('#bk-exp-amount').value);
            if (!/^\d{4}-\d{2}$/.test(month) || !desc || !(amount > 0)) return;
            b.expenses.push({ id: 'be' + Date.now(), month, desc, amount }); bookYear = Number(month.slice(0, 4)); rerender();
        });
        const detail = root.querySelector('#bk-detail');
        const showDetail = (key, kind) => {
            if (!detail) return;
            detail.innerHTML = booksDetailHtml(key, kind);
            detail.querySelectorAll('[data-bk-del]').forEach(x => x.addEventListener('click', () => {
                if (x.dataset.kind === 'exp') b.expenses = b.expenses.filter(r => r.id !== x.dataset.bkDel);
                else b.incomes = b.incomes.filter(r => r.id !== x.dataset.bkDel);
                rerender();
            }));
        };
        root.querySelectorAll('[data-bk-month]').forEach(el => el.addEventListener('click', () => showDetail(el.dataset.bkMonth, 'inc')));
        root.querySelectorAll('[data-bk-exp-month]').forEach(el => el.addEventListener('click', () => showDetail(el.dataset.bkExpMonth, 'exp')));
    }

    // ── render ─────────────────────────────────────────────────────────────
    window.renderFinance = async function renderFinance() {
        const root = document.getElementById('finance-root');
        if (!root) return;
        if (!hasProAccess()) {
            root.innerHTML = `<div class="card fin-locked">
                <h3>תזרים מזומנים — תכונת PRO</h3>
                <p>הבנקים והאשראי שלך במקום אחד, מזומן זמין עכשיו, עקומת מזומן עבר וצפי, מחזורי חיוב לפי יום עוגן, סף ביטחון, והכנסות שנמשכות ישירות מהמסמכים שהפקת כאן.</p>
                <div class="fin-locked-actions">
                    <button class="btn btn-primary" onclick="typeof showUpgradeModal === 'function' ? showUpgradeModal('general') : null">שדרוג ל-PRO</button>
                </div>
            </div>`;
            return;
        }
        if (!fin) {
            root.innerHTML = '<div class="empty"><h3>טוען נתונים…</h3></div>';
            try { await loadFinance(); }
            catch (e) {
                if (e instanceof NoTokenError) {
                    root.innerHTML = `<div class="card fin-auth">
                        <h3>צריך חיבור חי לחשבון Google</h3>
                        <p>החיבור הקודם פג (גוגל מחדשת אותו רק לפעמים בשקט). לחיצה אחת ואני טוען את התזרים.</p>
                        <button type="button" class="btn btn-primary" onclick="proSignIn(this)">התחבר מחדש</button>
                    </div>`;
                    return;
                }
                root.innerHTML = `<div class="empty"><h3>לא הצלחתי לטעון</h3><p>${esc(e.message)}</p>
                    <button class="btn btn-quiet" onclick="renderFinance()">נסה שוב</button></div>`;
                return;
            }
        }

        const s = settings();
        const { cashNow } = buildCurve();
        const closed = cycleAt(-1);
        const closedItems = itemsBetween(closed.start, closed.end).filter(i => i.kind === 'actual');
        const closedNet = closedItems.reduce((t, i) => t + i.amount, 0);
        const openDocs = invoiceIncome.filter(i => !i.paid);
        const openSum = openDocs.reduce((t, i) => t + i.amount, 0);
        const fz = (s.financy || {});
        const stamp = fz.lastSync ? new Date(fz.lastSync) : new Date();
        const stampTxt = stamp.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

        root.className = 'fin-view-' + finView;
        root.innerHTML = `
        <div class="fin-subtabs" role="tablist">
            <button type="button" class="subtab ${finView === 'open' ? 'active' : ''}" role="tab" data-view="open">Open Finance · בנקים</button>
            <button type="button" class="subtab ${finView === 'manual' ? 'active' : ''}" role="tab" data-view="manual">ניהול ידני</button>
        </div>
        <div class="fin-head">
            <div>
                <h3 class="fin-title">תזרים מזומנים</h3>
                <p class="fin-sub">${fz.connected ? 'מהפיד החי של הבנקים' : 'מהנתונים שהוזנו כאן'} • עבר = יתרות בפועל, קדימה = צפי</p>
            </div>
            <span class="fin-stamp num">${esc(stampTxt)}</span>
        </div>

        <div class="fin-open-only">${accountsHtml()}</div>
        ${chipsHtml()}

        <div class="fin-cards">
            <div class="card"><div class="fin-kpi-label">מזומן זמין עכשיו</div><div class="fin-kpi num">${fmtILS(cashNow)}</div>
                <div class="fin-kpi-sub">${selectedAccounts().filter(a => !isCard(a)).length} חשבונות${selectedAccounts().some(isCard) ? ' · אשראי נפרד' : ''}</div></div>
            <div class="card"><div class="fin-kpi-label">מחזור אחרון שנסגר ← (${closed.end.getDate()}.${closed.end.getMonth() + 1})</div><div class="fin-kpi num ${closedNet >= 0 ? 'status-ok' : 'status-danger'}">${fmtILS(closedNet)}</div>
                <div class="fin-kpi-sub">נטו ${esc(closed.label)}</div></div>
            <div class="card"><div class="fin-kpi-label">ממתין לתשלום מלקוחות</div><div class="fin-kpi num status-ok">${fmtILS(openSum)}</div>
                <div class="fin-kpi-sub">${openDocs.length} מסמכים פתוחים${(() => { const n = openDocs.map(i => i.dueDate).filter(Boolean).sort()[0]; return n ? ' · הקרוב ' + new Date(n).toLocaleDateString('he-IL') : ''; })()}</div></div>
        </div>

        <div class="card fin-chart-card">
            <h3>עקומת המזומן • עבר וצפי</h3>
            ${curveSvg()}
            <div class="fin-legend"><span><i class="fin-dot solid"></i> בפועל</span><span><i class="fin-dot dashed"></i> צפי: מסמכים לפי תנאי תשלום, חיובים קבועים, חיוב אשראי ביום העוגן</span></div>
        </div>

        ${cycleCardHtml()}

        <div class="fin-open-only">${financyCardHtml()}</div>

        <div class="fin-manual-only">${booksSectionHtml()}</div>
        <details class="card fin-manual fin-manual-only" ${finView === 'manual' ? 'open' : ''}>
            <summary>נתונים ידניים · חשבונות, תנועות, חיובים קבועים</summary>
            <div class="fin-grid">
                <div>
                    <h4>הוספה מהירה</h4>
                    <form id="fin-add-form">
                        <div class="fin-form-row">
                            <input class="input" type="date" id="fin-f-date" value="${todayISO()}" required>
                            <input class="input num" type="number" id="fin-f-amount" placeholder="סכום (מינוס = הוצאה)" required>
                        </div>
                        <div class="fin-form-row">
                            <input class="input" type="text" id="fin-f-desc" placeholder="תיאור" required>
                            <button class="btn btn-primary" type="submit">הוסף</button>
                        </div>
                    </form>
                    <details class="fin-details"><summary>ייבוא CSV (תאריך,סכום,תיאור)</summary>
                        <textarea class="textarea" id="fin-csv" rows="4" placeholder="2026-08-01,-450,דלק&#10;2026-08-03,5200,קאנטרי רעננה"></textarea>
                        <button class="btn btn-quiet btn-sm" id="fin-csv-go">ייבוא</button>
                    </details>
                </div>
                <div>
                    <h4>חשבונות ויתרות</h4>
                    <div id="fin-accounts">${accounts().map(a => `
                        <div class="fin-form-row" data-acc="${esc(a.id)}">
                            <select class="input" data-f="institution" aria-label="בנק">${Object.keys(BANKS).map(k => `<option value="${k}" ${(a.institution || 'other') === k ? 'selected' : ''}>${esc(BANKS[k].label)}</option>`).join('')}</select>
                            <select class="input" data-f="kind" aria-label="סוג"><option value="bank" ${a.kind !== 'card' ? 'selected' : ''}>עו"ש</option><option value="card" ${a.kind === 'card' ? 'selected' : ''}>אשראי</option></select>
                            <input class="input" type="text" value="${esc(a.name || '')}" data-f="name" placeholder="שם">
                            <input class="input num" type="number" value="${Number(a.balance) || 0}" data-f="balance" placeholder="${a.kind === 'card' ? 'חיוב קרוב' : 'יתרה'}">
                            <button class="fin-x" data-delacc="${esc(a.id)}" title="מחיקה">×</button>
                        </div>`).join('')}</div>
                    <button class="btn btn-quiet btn-sm" id="fin-acc-add">הוסף חשבון</button>
                    <h4 style="margin-block-start: var(--sp-4);">חיובים קבועים</h4>
                    <div id="fin-recurring">${(fin.recurring || []).map(r => `
                        <div class="fin-form-row" data-rec="${esc(r.id)}">
                            <input class="input" type="text" value="${esc(r.name)}" data-f="name" placeholder="שם">
                            <input class="input num" type="number" value="${Number(r.amount) || 0}" data-f="amount" placeholder="סכום (מינוס=חיוב)">
                            <input class="input num" type="number" min="1" max="28" value="${Number(r.dayOfMonth) || 1}" data-f="dayOfMonth" placeholder="יום בחודש">
                            <button class="fin-x" data-delrec="${esc(r.id)}" title="מחיקה">×</button>
                        </div>`).join('')}</div>
                    <button class="btn btn-quiet btn-sm" id="fin-rec-add">הוסף חיוב קבוע</button>
                </div>
            </div>
            <p class="fin-muted" style="margin-block-start: var(--sp-3);">טיפ: בוט ההוצאות של SUMIT בוואטסאפ מתייק קבלות לבד, חינם, נוח להצמיד את השיחה למעלה.</p>
        </details>`;

        wire(root);
        wireBooks(root);
    };

    function wire(root) {
        const s = settings();
        const rerender = () => { scheduleSave(); window.renderFinance(); };
        root.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { finView = b.dataset.view; window.renderFinance(); }));
        root.querySelectorAll('[data-acc-pick]').forEach(b => b.addEventListener('click', () => {
            const id = b.dataset.accPick;
            const all = accounts().map(a => a.id);
            const cur = s.selected.length ? s.selected.slice() : all.slice();
            if (s.multi) {
                const i = cur.indexOf(id);
                if (i >= 0) { if (cur.length > 1) cur.splice(i, 1); } else cur.push(id);
            } else {
                cur.splice(0, cur.length, id);
            }
            s.selected = (cur.length === all.length) ? [] : cur;
            rerender();
        }));
        root.querySelectorAll('[data-anchor]').forEach(b => b.addEventListener('click', () => { s.anchorDay = Number(b.dataset.anchor); finCycleOffset = 0; rerender(); }));
        const custom = root.querySelector('[data-anchor-custom]');
        if (custom) custom.addEventListener('change', () => { const v = Number(custom.value); if (v >= 1 && v <= 28) { s.anchorDay = v; finCycleOffset = 0; rerender(); } });
        const multi = root.querySelector('[data-multi]');
        if (multi) multi.addEventListener('click', () => { s.multi = !s.multi; rerender(); });
        root.querySelectorAll('[data-year]').forEach(b => b.addEventListener('click', () => { s.viewYear = Number(b.dataset.year); rerender(); }));
        const floor = root.querySelector('[data-floor]');
        if (floor) floor.addEventListener('change', () => { s.safetyFloor = Number(floor.value) || 0; rerender(); });
        root.querySelectorAll('[data-cycle]').forEach(b => b.addEventListener('click', () => { finCycleOffset += Number(b.dataset.cycle); window.renderFinance(); }));

        root.querySelectorAll('[data-financy]').forEach(b => b.addEventListener('click', async () => {
            const action = b.dataset.financy;
            const val = (id) => ((root.querySelector(id) || {}).value || '').trim();
            const payload = { action };
            if (action === 'saveCreds') {
                Object.assign(payload, { userId: val('#fin-fz-user'), clientId: val('#fin-fz-client'), clientSecret: val('#fin-fz-secret') });
                if (!payload.userId || !payload.clientId || !payload.clientSecret) { if (typeof showToast === 'function') showToast('מלאו את שלושת הפרטים מהגדרות Financy → גישה ל-API', 'error'); return; }
            }
            if (action === 'disconnect' && !confirm('לנתק את Financy ולהסיר את נתוני הבנקים מהתזרים?')) return;
            b.disabled = true; const label = b.textContent; b.textContent = action === 'saveCreds' ? 'שומר…' : action === 'sync' ? 'מסנכרן…' : 'רגע…';
            try {
                const token = await liveToken();
                const res = await fetch('/api/financy', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                    body: JSON.stringify(payload) });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error((data.error && data.error.message) || 'נכשל');
                if (typeof showToast === 'function') showToast(data.message || 'בוצע');
                fin = null; window.renderFinance();
            } catch (e) {
                if (typeof showToast === 'function') showToast('Financy: ' + e.message, 'error');
                b.disabled = false; b.textContent = label;
            }
        }));

        const form = root.querySelector('#fin-add-form');
        if (form) form.addEventListener('submit', (e) => {
            e.preventDefault();
            const amount = Number(root.querySelector('#fin-f-amount').value);
            const desc = root.querySelector('#fin-f-desc').value.trim();
            const date = root.querySelector('#fin-f-date').value;
            if (!amount || !desc || !date) return;
            fin.entries.push({ id: 'e' + Date.now(), date, amount, desc, category: '', source: 'manual' });
            rerender();
        });
        const csvGo = root.querySelector('#fin-csv-go');
        if (csvGo) csvGo.addEventListener('click', () => {
            const lines = (root.querySelector('#fin-csv').value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let added = 0;
            lines.forEach(l => {
                const m = l.match(/^\s*(\d{4}-\d{2}-\d{2})\s*,\s*(-?[\d,]+(?:\.\d+)?)\s*,\s*(.+)$/);
                if (!m) return;
                const amt = Number(m[2].replace(/,/g, ''));
                if (!amt) return;
                fin.entries.push({ id: 'e' + Date.now() + '_' + added, date: m[1], amount: amt, desc: m[3].trim(), category: '', source: 'csv' });
                added++;
            });
            if (typeof showToast === 'function') showToast(added ? `נוספו ${added} תנועות` : 'לא זוהו שורות תקינות (תאריך,סכום,תיאור)');
            if (added) rerender();
        });
        root.querySelectorAll('[data-delacc]').forEach(b => b.addEventListener('click', () => { fin.accounts = fin.accounts.filter(a => a.id !== b.dataset.delacc); rerender(); }));
        root.querySelectorAll('[data-delrec]').forEach(b => b.addEventListener('click', () => { fin.recurring = fin.recurring.filter(r => r.id !== b.dataset.delrec); rerender(); }));
        const accAdd = root.querySelector('#fin-acc-add');
        if (accAdd) accAdd.addEventListener('click', () => { fin.accounts.push({ id: 'a' + Date.now(), name: '', kind: 'bank', institution: 'other', balance: 0, asOf: todayISO(), source: 'manual' }); window.renderFinance(); });
        const recAdd = root.querySelector('#fin-rec-add');
        if (recAdd) recAdd.addEventListener('click', () => { fin.recurring.push({ id: 'r' + Date.now(), name: '', amount: 0, dayOfMonth: s.anchorDay }); window.renderFinance(); });
        root.querySelectorAll('[data-acc] .input, [data-rec] .input').forEach(inp => {
            inp.addEventListener('change', () => {
                const row = inp.closest('[data-acc], [data-rec]');
                const list = row.dataset.acc ? fin.accounts : fin.recurring;
                const item = list.find(x => x.id === (row.dataset.acc || row.dataset.rec));
                if (!item) return;
                const f = inp.dataset.f;
                item[f] = (f === 'name' || f === 'institution' || f === 'kind') ? inp.value : Number(inp.value) || 0;
                if (row.dataset.acc) item.asOf = todayISO();
                scheduleSave();
                if (f === 'kind' || f === 'institution') window.renderFinance();
            });
        });
    }

    // ── Admin usage funnel (renders into #admin-funnel-body) ───────────────
    window.renderAdminFunnel = async function renderAdminFunnel() {
        const body = document.getElementById('admin-funnel-body');
        if (!body) return;
        try {
            // Through the app's admin fetch: it earns a live token first and
            // retries once if the hour lapsed, instead of printing "נדרשת
            // התחברות" at a signed-in admin.
            const res = window.adminRes
                ? await window.adminRes('/api/funnel')
                : await fetch('/api/funnel', { headers: { Authorization: 'Bearer ' + authToken() } });
            const data = await res.json();
            if (!res.ok) throw new Error((data.error && data.error.message) || 'שגיאה');
            const f = data.funnel;
            const steps = [
                ['נרשמו', f.signedUp],
                ['פתחו פרויקט', f.openedProject],
                ['דיברו עם ה-AI', f.talkedToAI],
                ['הפיקו הצעה', f.producedQuote],
            ];
            const maxV = Math.max(f.signedUp, 1);
            body.innerHTML = `
                <div class="fin-funnel">${steps.map(([label, v]) => `
                    <div class="fin-funnel-row">
                        <span class="ff-label">${label}</span>
                        <span class="ff-bar"><i style="inline-size:${Math.round(100 * v / maxV)}%"></i></span>
                        <b class="num">${v}</b>
                    </div>`).join('')}
                </div>
                <p class="fin-muted" style="margin-block-start:8px;">
                    פעילים בשבוע האחרון: <b class="num">${f.activeLast7d}</b> ·
                    נעצרו אחרי הודעה-שתיים: <b class="num">${f.oneMessageOnly}</b> ·
                    ייצאו PDF החודש: <b class="num">${f.pdfThisMonth}</b>${f.capped ? ' · (מוצגים 200 הראשונים)' : ''}
                </p>
                <details class="fin-details"><summary>פירוט לפי משתמש (${data.users.length})</summary>
                    <div class="table-scroll"><table class="fin-table">
                        <thead><tr><th>משתמש</th><th>פרויקטים</th><th>הודעות צ'אט</th><th>הצעות</th><th>מאגר</th><th>פעילות אחרונה</th></tr></thead>
                        <tbody>${data.users.map(u => `
                            <tr><td>${esc(u.email)}</td><td class="num">${u.projects}</td><td class="num">${u.chatMsgs}</td>
                            <td class="num">${u.quotes}</td><td class="num">${u.catalogItems}</td>
                            <td>${u.lastUpdated ? new Date(u.lastUpdated).toLocaleDateString('he-IL') : '—'}</td></tr>`).join('')}
                        </tbody>
                    </table></div>
                </details>`;
        } catch (e) {
            // The same failure, wearing the same face as every other card on
            // the panel. This one used to grow its own "התחבר מחדש", so one
            // routine expired hour put two buttons on the screen doing the same
            // job — and recovering from here would have refreshed the funnel
            // alone, leaving the other six cards exactly as empty as before.
            body.innerHTML = window.adminErrorHtml
                ? window.adminErrorHtml(e)
                : '<p class="input-help">שגיאה בטעינת המשפך: ' + esc(e.message) + '</p>';
        }
    };

    // ── Telegram report import: /sale/?tgreport=<token> ────────────────────
    async function checkTgReport() {
        let token = '';
        try { token = new URLSearchParams(location.search).get('tgreport') || ''; } catch { return; }
        if (!token || !/^[a-z2-9]{8,20}$/.test(token)) return;
        const u = activeUser();
        if (!u || u === 'guest') {
            // Keep the token in the URL so the link still works after sign-in.
            if (typeof showToast === 'function') showToast('כדי לייבא את הדוח מהטלגרם, התחברו עם Google ופתחו את הקישור שוב', 'error');
            return;
        }
        try { history.replaceState({}, '', location.pathname); } catch { }
        try {
            const res = await fetch('/api/telegram?record=' + token);
            if (!res.ok) throw new Error();
            const raw = await res.text();
            if (raw.length > 3.5 * 1024 * 1024) {
                if (typeof showToast === 'function') showToast('הדוח גדול מדי לייבוא, פתחו אותו בקישור הצפייה וההדפסה', 'error');
                return;
            }
            const rec = JSON.parse(raw);
            if (!rec || !Array.isArray(rec.findings)) throw new Error();
            const key = (typeof getStorageKey === 'function') ? getStorageKey('sj_reports') : null;
            if (!key) return;
            let reports = [];
            try { reports = JSON.parse(localStorage.getItem(key) || '[]'); } catch { }
            reports.unshift({
                type: rec.type || 'defects', title: rec.title || '', client: rec.client || '',
                site: rec.site || '', date: rec.date || todayISO(), number: rec.number || '',
                intro: rec.intro || '', warning: rec.warning || '', blocks: rec.blocks || [],
                findings: rec.findings, summary: rec.summary || '', savedAt: Date.now(),
            });
            localStorage.setItem(key, JSON.stringify(reports.slice(0, 30)));
            if (typeof showToast === 'function') showToast('דוח הליקויים מהטלגרם נשמר, פתחו אותו בלשונית הדוחות');
        } catch {
            if (typeof showToast === 'function') showToast('לא הצלחתי לייבא את הדוח מהטלגרם', 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(checkTgReport, 1600); // after app.js finishes booting the session
    });
})();
