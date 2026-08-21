// ZEREM — finance dashboard (תזרים מזומנים, owner only) + Telegram report import.
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

    const fmtILS = (n) => (typeof nisFmt === 'function') ? nisFmt(n) : '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));

    let fin = null;          // the KV record
    let invoiceIncome = [];  // derived from ZEREM invoices (server)
    let saveTimer = null;

    // ── data ───────────────────────────────────────────────────────────────
    async function loadFinance(retried) {
        const token = authToken();
        if (!token) throw new Error('נדרשת התחברות');
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
        const token = authToken();
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

    // ── math: running balance, past + forecast ─────────────────────────────
    function buildCurve() {
        const days = 60, ahead = 30;
        const now = new Date(); now.setHours(12, 0, 0, 0);
        const base = (fin.accounts || []).reduce((s, a) => s + (Number(a.balance) || 0), 0);
        const all = [...(fin.entries || [])];
        // paid ZEREM invoices count as real income history
        invoiceIncome.forEach(inv => { if (inv.paid) all.push(inv); });

        const byDay = {};
        all.forEach(e => {
            if (!e.date) return;
            byDay[e.date] = (byDay[e.date] || 0) + (Number(e.amount) || 0);
        });

        // Past: walk BACK from today's known balance.
        const past = [];
        let bal = base;
        for (let i = 0; i <= days; i++) {
            const d = new Date(now); d.setDate(d.getDate() - i);
            const iso = d.toISOString().slice(0, 10);
            past.unshift({ date: iso, bal });
            bal -= (byDay[iso] || 0);
        }

        // Forecast: recurring charges + unpaid ZEREM invoices as expected income.
        const future = [];
        let fbal = base;
        for (let i = 1; i <= ahead; i++) {
            const d = new Date(now); d.setDate(d.getDate() + i);
            const iso = d.toISOString().slice(0, 10);
            (fin.recurring || []).forEach(r => {
                if (Number(r.dayOfMonth) === d.getDate()) fbal += (Number(r.amount) || 0);
            });
            // Open documents have no due date — book them as expected income
            // two weeks out (a single honest bump, not per-day guesswork).
            if (i === 14) {
                fbal += invoiceIncome.filter(inv => !inv.paid).reduce((s, inv) => s + inv.amount, 0);
            }
            future.push({ date: iso, bal: fbal });
        }
        return { past, future };
    }

    function curveSvg() {
        const { past, future } = buildCurve();
        const pts = [...past, ...future.map(p => ({ ...p, f: true }))];
        if (!pts.length) return '';
        const W = 720, H = 220, PAD = 34;
        const vals = pts.map(p => p.bal);
        let min = Math.min(...vals, 0), max = Math.max(...vals, 1);
        if (max === min) max = min + 1;
        const x = (i) => PAD + (W - PAD * 2) * (i / (pts.length - 1));
        const y = (v) => H - PAD - (H - PAD * 2) * ((v - min) / (max - min));
        const line = (arr, off) => arr.map((p, i) => `${x(i + off).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ');
        const zeroY = y(0);
        const todayX = x(past.length - 1);
        const gridVals = [min, (min + max) / 2, max];
        // RTL page, LTR time axis inside the SVG — dates flow left→right.
        return `
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="עקומת מזומן · 60 יום אחורה ו-30 קדימה" style="width:100%;height:auto;direction:ltr;">
            ${gridVals.map(v => `<line x1="${PAD}" x2="${W - PAD}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
            <text x="${PAD - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-3)">${Math.round(v / 1000)}k</text>`).join('')}
            ${min < 0 ? `<line x1="${PAD}" x2="${W - PAD}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="2 4"/>` : ''}
            <line x1="${todayX.toFixed(1)}" x2="${todayX.toFixed(1)}" y1="${PAD}" y2="${H - PAD}" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${todayX.toFixed(1)}" y="${PAD - 8}" text-anchor="middle" font-size="10" fill="var(--text-3)">היום</text>
            <polyline points="${line(past, 0)}" fill="none" stroke="var(--accent)" stroke-width="2"/>
            <polyline points="${line(future, past.length)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4" opacity="0.75"/>
        </svg>`;
    }

    // ── render ─────────────────────────────────────────────────────────────
    window.renderFinance = async function renderFinance() {
        const root = document.getElementById('finance-root');
        if (!root) return;
        if (typeof isAdmin === 'function' && !isAdmin()) {
            root.innerHTML = '<div class="empty"><h3>אזור פרטי</h3><p>הדשבורד הפיננסי זמין לבעל המערכת בלבד.</p></div>';
            return;
        }
        if (!fin) {
            root.innerHTML = '<div class="empty"><h3>טוען נתונים…</h3></div>';
            try { await loadFinance(); }
            catch (e) {
                root.innerHTML = `<div class="empty"><h3>לא הצלחתי לטעון</h3><p>${esc(e.message)}</p>
                    <button class="btn btn-quiet" onclick="renderFinance()">נסה שוב</button></div>`;
                return;
            }
        }

        const cash = (fin.accounts || []).reduce((s, a) => s + (Number(a.balance) || 0), 0);
        const monthlyRecurring = (fin.recurring || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const openInvoices = invoiceIncome.filter(i => !i.paid);
        const openSum = openInvoices.reduce((s, i) => s + i.amount, 0);

        const upcoming = (fin.recurring || []).map(r => {
            const d = new Date();
            const day = Math.min(Math.max(Number(r.dayOfMonth) || 1, 1), 28);
            if (d.getDate() >= day) d.setMonth(d.getMonth() + 1);
            d.setDate(day);
            return { ...r, next: d.toISOString().slice(0, 10) };
        }).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 8);

        const recent = [...(fin.entries || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);

        root.innerHTML = `
        <div class="fin-cards">
            <div class="card"><div class="fin-kpi-label">מזומן זמין עכשיו</div><div class="fin-kpi num">${fmtILS(cash)}</div>
                <div class="fin-kpi-sub">${(fin.accounts || []).length ? (fin.accounts || []).map(a => `${esc(a.name)}: ${fmtILS(a.balance)}`).join(' · ') : 'עדיין לא הוגדרו חשבונות'}</div></div>
            <div class="card"><div class="fin-kpi-label">ממתין לתשלום (הצעות/חשבוניות)</div><div class="fin-kpi num status-ok">${fmtILS(openSum)}</div>
                <div class="fin-kpi-sub">${openInvoices.length} מסמכים פתוחים מהמערכת</div></div>
            <div class="card"><div class="fin-kpi-label">הוצאות קבועות בחודש</div><div class="fin-kpi num status-danger">${fmtILS(Math.abs(monthlyRecurring))}</div>
                <div class="fin-kpi-sub">${(fin.recurring || []).length} חיובים קבועים</div></div>
        </div>

        <div class="card fin-chart-card">
            <h3>עקומת המזומן · עבר וצפי</h3>
            ${((fin.entries || []).length || (fin.accounts || []).length) ? curveSvg() : '<div class="empty"><h3>אין עדיין נתונים לעקומה</h3><p>הוסיפו חשבון עם יתרה ותנועות, או ייבאו CSV, והעקומה תופיע כאן.</p></div>'}
            <div class="fin-legend"><span><i class="fin-dot solid"></i> בפועל</span><span><i class="fin-dot dashed"></i> צפי (חיובים קבועים + מסמכים פתוחים)</span></div>
        </div>

        <div class="fin-grid">
            <div class="card">
                <h3>חיובים קרובים</h3>
                ${upcoming.length ? `<ul class="fin-list">${upcoming.map(u => `<li><span>${esc(u.name)}</span><span class="num">${fmtILS(u.amount)}</span><small>${esc(u.next)}</small></li>`).join('')}</ul>` : '<p class="fin-muted">אין חיובים קבועים. הוסיפו למטה, שכירות, תוכנות, ביטוחים.</p>'}
            </div>
            <div class="card">
                <h3>תנועות אחרונות</h3>
                ${recent.length ? `<ul class="fin-list">${recent.map(e => `<li><span>${esc(e.desc)}</span><span class="num ${e.amount >= 0 ? 'status-ok' : 'status-danger'}">${fmtILS(e.amount)}</span><small>${esc(e.date)}</small>
                    <button class="fin-x" data-del="${esc(e.id)}" title="מחיקה">×</button></li>`).join('')}</ul>` : '<p class="fin-muted">אין תנועות עדיין.</p>'}
            </div>
        </div>

        <div class="fin-grid">
            <div class="card">
                <h3>הוספה מהירה</h3>
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
                <details class="fin-details"><summary>חשבונות ויתרות</summary>
                    <div id="fin-accounts">${(fin.accounts || []).map(a => `
                        <div class="fin-form-row" data-acc="${esc(a.id)}">
                            <input class="input" type="text" value="${esc(a.name)}" data-f="name" placeholder="שם החשבון">
                            <input class="input num" type="number" value="${Number(a.balance) || 0}" data-f="balance" placeholder="יתרה">
                            <button class="fin-x" data-delacc="${esc(a.id)}" title="מחיקה">×</button>
                        </div>`).join('')}</div>
                    <button class="btn btn-quiet btn-sm" id="fin-acc-add">הוסף חשבון</button>
                </details>
                <details class="fin-details"><summary>חיובים קבועים</summary>
                    <div id="fin-recurring">${(fin.recurring || []).map(r => `
                        <div class="fin-form-row" data-rec="${esc(r.id)}">
                            <input class="input" type="text" value="${esc(r.name)}" data-f="name" placeholder="שם">
                            <input class="input num" type="number" value="${Number(r.amount) || 0}" data-f="amount" placeholder="סכום (מינוס=חיוב)">
                            <input class="input num" type="number" min="1" max="28" value="${Number(r.dayOfMonth) || 1}" data-f="dayOfMonth" placeholder="יום בחודש">
                            <button class="fin-x" data-delrec="${esc(r.id)}" title="מחיקה">×</button>
                        </div>`).join('')}</div>
                    <button class="btn btn-quiet btn-sm" id="fin-rec-add">הוסף חיוב קבוע</button>
                </details>
            </div>
            <div class="card">
                <h3>חיבורים</h3>
                <p class="fin-muted">הכנסות נמשכות אוטומטית מהמסמכים שהפקת במערכת (הנהלת חשבונות).</p>
                <div class="fin-connector">
                    <b>בנקאות פתוחה (Financy)</b>
                    <p class="fin-muted">חיבור קריאה-בלבד לבנקים ולאשראי, בפיקוח בנק ישראל, היתרות והתנועות יתעדכנו לבד. דורש הרשמה חד-פעמית שלך ב-financy.open-finance.ai; אחרי שיהיו מפתחות, החיבור כאן.</p>
                </div>
                <div class="fin-connector">
                    <b>טיפ: בוט ההוצאות של SUMIT בוואטסאפ</b>
                    <p class="fin-muted">שולחים צילום קבלה לוואטסאפ של SUMIT, והכל מתויק לבד באתר שלהם, חינם. נוח להצמיד את השיחה למעלה ולשמור קבלות מהשטח בשנייה.</p>
                </div>
            </div>
        </div>`;

        wire(root);
    };

    function wire(root) {
        const form = root.querySelector('#fin-add-form');
        if (form) form.addEventListener('submit', (e) => {
            e.preventDefault();
            const amount = Number(root.querySelector('#fin-f-amount').value);
            const desc = root.querySelector('#fin-f-desc').value.trim();
            const date = root.querySelector('#fin-f-date').value;
            if (!amount || !desc || !date) return;
            fin.entries.push({ id: 'e' + Date.now(), date, amount, desc, category: '', source: 'manual' });
            scheduleSave(); window.renderFinance();
        });
        const csvGo = root.querySelector('#fin-csv-go');
        if (csvGo) csvGo.addEventListener('click', () => {
            const lines = (root.querySelector('#fin-csv').value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let added = 0;
            lines.forEach(l => {
                // date,amount,desc — amount may carry thousands separators ("1,250")
                const m = l.match(/^\s*(\d{4}-\d{2}-\d{2})\s*,\s*(-?[\d,]+(?:\.\d+)?)\s*,\s*(.+)$/);
                if (!m) return;
                const amt = Number(m[2].replace(/,/g, ''));
                if (!amt) return;
                fin.entries.push({ id: 'e' + Date.now() + '_' + added, date: m[1], amount: amt, desc: m[3].trim(), category: '', source: 'csv' });
                added++;
            });
            if (typeof showToast === 'function') showToast(added ? `נוספו ${added} תנועות` : 'לא זוהו שורות תקינות (תאריך,סכום,תיאור)');
            if (added) { scheduleSave(); window.renderFinance(); }
        });
        root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
            fin.entries = fin.entries.filter(e => e.id !== b.dataset.del);
            scheduleSave(); window.renderFinance();
        }));
        root.querySelectorAll('[data-delacc]').forEach(b => b.addEventListener('click', () => {
            fin.accounts = fin.accounts.filter(a => a.id !== b.dataset.delacc);
            scheduleSave(); window.renderFinance();
        }));
        root.querySelectorAll('[data-delrec]').forEach(b => b.addEventListener('click', () => {
            fin.recurring = fin.recurring.filter(r => r.id !== b.dataset.delrec);
            scheduleSave(); window.renderFinance();
        }));
        const accAdd = root.querySelector('#fin-acc-add');
        if (accAdd) accAdd.addEventListener('click', () => {
            fin.accounts.push({ id: 'a' + Date.now(), name: '', kind: 'bank', balance: 0, asOf: todayISO() });
            window.renderFinance();
        });
        const recAdd = root.querySelector('#fin-rec-add');
        if (recAdd) recAdd.addEventListener('click', () => {
            fin.recurring.push({ id: 'r' + Date.now(), name: '', amount: 0, dayOfMonth: 1 });
            window.renderFinance();
        });
        // inline edits on accounts/recurring
        root.querySelectorAll('[data-acc] .input, [data-rec] .input').forEach(inp => {
            inp.addEventListener('change', () => {
                const row = inp.closest('[data-acc], [data-rec]');
                const list = row.dataset.acc ? fin.accounts : fin.recurring;
                const item = list.find(x => x.id === (row.dataset.acc || row.dataset.rec));
                if (!item) return;
                const f = inp.dataset.f;
                item[f] = (f === 'name') ? inp.value : Number(inp.value) || 0;
                if (row.dataset.acc) item.asOf = todayISO();
                scheduleSave();
            });
        });
    }

    // ── Admin usage funnel (renders into #admin-funnel-body) ───────────────
    window.renderAdminFunnel = async function renderAdminFunnel() {
        const body = document.getElementById('admin-funnel-body');
        if (!body) return;
        const token = authToken();
        if (!token) { body.innerHTML = '<p class="input-help">נדרשת התחברות.</p>'; return; }
        try {
            const res = await fetch('/api/funnel', { headers: { Authorization: 'Bearer ' + token } });
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
            body.innerHTML = '<p class="input-help">שגיאה בטעינת המשפך: ' + esc(e.message) + '</p>';
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
