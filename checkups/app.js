// בדיקות תקופתיות — client tracker with Google Calendar / ICS reminders.
//
// Data lives locally (localStorage) and, when signed in with Google, syncs to
// the site's KV via /api/checkups — same identity model as the ZEREM app, so
// any Google account gets its own private list.
//
// Reminders are delegated to the calendar: a recurring Google Calendar event
// (or downloadable ICS for Apple Calendar) with alerts 28/7/1 days before the
// due date. The calendar then does the emailing/phone-notifying forever — no
// server cron needed.

'use strict';

const STORAGE_KEY = 'sj_checkups_v1';
const TOKEN_KEY = 'sj_checkups_token';
const CAL_TOKEN_KEY = 'sj_checkups_cal_token';
const CLIENT_ID_KEY = 'sj_global_google_client_id';
const DEFAULT_CLIENT_ID = '4351198135-oltod8jremuq7pgn2e5bad4ahkupufkp.apps.googleusercontent.com';
const SOON_DAYS = 60;

let clients = [];
let authToken = null;
let authEmail = null;
let saveTimer = null;

// ---------- boot ----------

init();

function init() {
    if (!localStorage.getItem(CLIENT_ID_KEY)) localStorage.setItem(CLIENT_ID_KEY, DEFAULT_CLIENT_ID);
    try { clients = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { clients = []; }
    if (!Array.isArray(clients)) clients = [];
    render();

    const saved = safeParse(localStorage.getItem(TOKEN_KEY));
    if (saved && saved.token && saved.exp > Date.now()) {
        authToken = saved.token;
        authEmail = saved.email;
        renderAuth();
        cloudLoad();
    }
}

// ---------- dates ----------

// The arithmetic and the file formats are shared with the same feature inside
// /sale/ (assets/checkups-core.js). Two copies of "when is this due" is a
// missed visit waiting to happen; the screens keep their own words and their
// own rendering, and agree on the dates.
function todayStr() { return SJ_CK.today(); }
function pad(n) { return SJ_CK.pad(n); }
function addMonths(dateStr, months) { return SJ_CK.addMonths(dateStr, months); }
function nextDue(c) { return SJ_CK.nextDue(c); }
function daysUntil(dateStr) { return SJ_CK.daysUntil(dateStr); }
function fmtDate(dateStr) { return SJ_CK.fmtDate(dateStr); }
function intervalLabel(months) { return SJ_CK.intervalLabel(months); }

// ---------- rendering ----------

function statusOf(c) { return SJ_CK.statusOf(c, SOON_DAYS); }

function render() {
    const q = (document.getElementById('search').value || '').trim().toLowerCase();
    const list = document.getElementById('list');

    const visible = liveClients().filter((c) =>
        !q || [c.name, c.phone, c.site, c.type].some((v) => (v || '').toLowerCase().includes(q)));

    // Most urgent first: missing dates, then by due date ascending.
    visible.sort((a, b) => {
        const da = nextDue(a), db = nextDue(b);
        if (!da && !db) return (a.name || '').localeCompare(b.name || '');
        if (!da) return -1;
        if (!db) return 1;
        return da.localeCompare(db);
    });

    const counts = { overdue: 0, soon: 0, ok: 0, missing: 0 };
    liveClients().forEach((c) => counts[statusOf(c)]++);
    document.getElementById('stats').innerHTML = `
        <div class="stat"><b>${liveClients().length}</b><span>לקוחות במעקב</span></div>
        <div class="stat overdue"><b>${counts.overdue + counts.missing}</b><span>באיחור / חסר תאריך</span></div>
        <div class="stat soon"><b>${counts.soon}</b><span>קרובים (${SOON_DAYS} יום)</span></div>
        <div class="stat ok"><b>${counts.ok}</b><span>בסדר</span></div>`;

    renderDueStrip();

    if (visible.length === 0) {
        list.innerHTML = `<div class="empty">${liveClients().length === 0
            ? 'אין עדיין לקוחות במעקב.<br>הוסף לקוח ראשון או ייבא רשימה מאקסל.'
            : 'לא נמצאו תוצאות לחיפוש.'}</div>`;
        return;
    }

    list.innerHTML = visible.map((c) => {
        const due = nextDue(c);
        const st = statusOf(c);
        const dotCls = st === 'overdue' || st === 'missing' ? 'red' : st === 'soon' ? 'amber' : 'green';
        let dueHtml;
        if (!due) {
            dueHtml = '<b class="overdue">חסר תאריך</b><small>קבע מועד בדיקה</small>';
        } else {
            const days = daysUntil(due);
            const label = days < 0 ? 'באיחור של ' + Math.abs(days) + ' יום'
                : days === 0 ? 'היום!' : 'בעוד ' + days + ' יום';
            dueHtml = `<b class="${st === 'overdue' ? 'overdue' : st === 'soon' ? 'soon' : ''}">${fmtDate(due)}</b><small>${label}</small>`;
        }
        return `
        <div class="row">
            <div class="dot ${dotCls}"></div>
            <div class="name">${esc(c.name)}<small>${esc([c.type, c.site].filter(Boolean).join(' · '))}</small></div>
            <div class="interval">${intervalLabel(c.months)}${c.last ? `<br><small>אחרונה: ${fmtDate(c.last)}</small>` : ''}</div>
            <div class="due">${dueHtml}</div>
            <div class="actions">
                <button class="icon-btn cal ${c.eventId ? 'synced' : ''}" title="${c.eventId ? 'מסונכרן ליומן Google · לחץ לעדכון' : 'הוסף תזכורת ליומן Google'}" onclick="syncCalendar('${c.id}')">📅</button>
                <button class="icon-btn" title="הורדת תזכורת לאייפון / Apple Calendar (קובץ ICS)" onclick="downloadIcs('${c.id}')">⬇</button>
                ${c.phone ? `<button class="icon-btn" title="וואטסאפ ללקוח" style="color:#25d366" onclick="whatsapp('${c.id}')">💬</button>` : ''}
                ${c.email ? `<button class="icon-btn" title="טיוטת מייל ללקוח" onclick="mailto('${c.id}')">✉</button>` : ''}
                <button class="icon-btn" title="הבדיקה בוצעה · קדם לתאריך הבא" onclick="markDone('${c.id}')">✔</button>
                <button class="icon-btn" title="עריכה" onclick="openEditor('${c.id}')">✏</button>
                <button class="icon-btn danger" title="מחיקה" onclick="removeClient('${c.id}')">✕</button>
            </div>
        </div>`;
    }).join('');
}

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (ch) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- CRUD ----------

let editingId = null;

function openEditor(id) {
    editingId = id || null;
    const c = clients.find((x) => x.id === id) || {};
    document.getElementById('editor-title').textContent = id ? 'עריכת לקוח' : 'לקוח חדש';
    document.getElementById('f-name').value = c.name || '';
    document.getElementById('f-phone').value = c.phone || '';
    document.getElementById('f-email').value = c.email || '';
    document.getElementById('f-type').value = c.type || 'בדיקה תקופתית';
    document.getElementById('f-site').value = c.site || '';
    const months = c.months || 12;
    const preset = [12, 24, 36, 60].includes(months);
    document.getElementById('f-months').value = preset ? String(months) : 'custom';
    document.getElementById('f-custom-wrap').style.display = preset ? 'none' : '';
    document.getElementById('f-custom').value = preset ? 6 : months;
    document.getElementById('f-last').value = c.last || '';
    document.getElementById('f-next').value = c.next || '';
    document.getElementById('f-notes').value = c.notes || '';
    document.getElementById('editor').showModal();
}

function saveClient(ev) {
    ev.preventDefault();
    const monthsSel = document.getElementById('f-months').value;
    const months = monthsSel === 'custom'
        ? Math.max(1, Math.min(120, parseInt(document.getElementById('f-custom').value, 10) || 12))
        : parseInt(monthsSel, 10);
    const rec = {
        name: document.getElementById('f-name').value.trim(),
        phone: document.getElementById('f-phone').value.trim(),
        email: document.getElementById('f-email').value.trim(),
        type: document.getElementById('f-type').value,
        site: document.getElementById('f-site').value.trim(),
        months,
        last: document.getElementById('f-last').value || null,
        next: document.getElementById('f-next').value || null,
        notes: document.getElementById('f-notes').value.trim(),
        updatedAt: Date.now(),
    };
    if (!rec.name) return;
    if (editingId) {
        const c = clients.find((x) => x.id === editingId);
        if (c) Object.assign(c, rec);
    } else {
        clients.push({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 7), eventId: null, ...rec });
    }
    document.getElementById('editor').close();
    persist();
    render();
}

function markDone(id) {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    c.last = todayStr();
    c.next = null; // back to computed: today + interval
    c.updatedAt = Date.now();
    persist();
    render();
    toast('עודכן · הבדיקה הבאה: ' + fmtDate(nextDue(c)) +
        (c.eventId ? '. כדאי ללחוץ 📅 לעדכן גם את היומן' : ''));
}

function removeClient(id) {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    if (!confirm('למחוק את "' + c.name + '" מהמעקב?')) return;
    const eventId = c.eventId;
    // Tombstone, not removal: the record stays (hidden) so the deletion wins
    // the union-merge on every other device instead of being resurrected.
    c.deleted = Date.now();
    c.updatedAt = Date.now();
    persist();
    render();
    if (eventId && confirm('למחוק גם את התזכורת מיומן Google?')) {
        ensureCalendarToken().then((token) =>
            fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/' + eventId, {
                method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
            })
        ).then(() => toast('התזכורת נמחקה מהיומן')).catch(() => toast('מחיקת האירוע מהיומן נכשלה'));
    }
}

// ---------- persistence: local + cloud ----------

function liveClients() { return clients.filter((c) => !c.deleted); }

function persist() {
    // Purge tombstones after 90 days — by then every device has synced.
    const cutoff = Date.now() - 90 * 86400000;
    clients = clients.filter((c) => !c.deleted || c.deleted > cutoff);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
    if (!authToken) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(cloudSave, 1500);
}

async function cloudSave() {
    if (!authToken) return;
    try {
        const res = await fetch('/api/checkups', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
            body: JSON.stringify({ data: { clients } }),
        });
        if (res.status === 401) { logoutLocal(); toast('פג תוקף החיבור ל-Google, התחבר שוב'); }
    } catch { /* offline — local copy is intact, next change retries */ }
}

async function cloudLoad() {
    if (!authToken) return;
    try {
        const res = await fetch('/api/checkups', { headers: { Authorization: 'Bearer ' + authToken } });
        if (res.status === 401) { logoutLocal(); return; }
        const body = await res.json();
        const cloud = body && body.data && Array.isArray(body.data.clients) ? body.data.clients : [];
        // Union-merge by id, newer updatedAt wins — devices converge.
        const byId = new Map(clients.map((c) => [c.id, c]));
        for (const cc of cloud) {
            const local = byId.get(cc.id);
            if (!local || (cc.updatedAt || 0) > (local.updatedAt || 0)) byId.set(cc.id, cc);
        }
        clients = [...byId.values()];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
        render();
        cloudSave();
    } catch { /* offline */ }
}

// ---------- Google sign-in (identity, email scope only) ----------

function loginGoogle() {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        toast('Google עדיין נטען · נסה שוב עוד רגע');
        return;
    }
    const tc = google.accounts.oauth2.initTokenClient({
        client_id: localStorage.getItem(CLIENT_ID_KEY),
        scope: 'https://www.googleapis.com/auth/userinfo.email',
        callback: async (resp) => {
            if (!resp || !resp.access_token) return;
            authToken = resp.access_token;
            try {
                const info = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: 'Bearer ' + authToken },
                })).json();
                authEmail = info.email || null;
            } catch { authEmail = null; }
            localStorage.setItem(TOKEN_KEY, JSON.stringify({
                token: authToken, email: authEmail,
                exp: Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000,
            }));
            renderAuth();
            cloudLoad();
        },
    });
    tc.requestAccessToken({ prompt: '' });
}

function logoutLocal() {
    authToken = null; authEmail = null;
    localStorage.removeItem(TOKEN_KEY);
    renderAuth();
}

function renderAuth() {
    const box = document.getElementById('auth-box');
    if (authToken) {
        box.innerHTML = `<span class="email">${esc(authEmail || 'מחובר')}</span>
            <span title="הרשימה מסונכרנת לענן" style="color:var(--green)">●</span>`;
    } else {
        box.innerHTML = '<button class="btn" id="btn-login" onclick="loginGoogle()">התחברות Google</button>';
    }
}

// ---------- Google Calendar reminders ----------

// A calendar-scoped token is minted only when actually adding a reminder, so
// the everyday sign-in stays minimal (email only).
function ensureCalendarToken() {
    const saved = safeParse(localStorage.getItem(CAL_TOKEN_KEY));
    if (saved && saved.token && saved.exp > Date.now() + 60000) return Promise.resolve(saved.token);
    return new Promise((resolve, reject) => {
        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            reject(new Error('gsi-not-loaded')); return;
        }
        const tc = google.accounts.oauth2.initTokenClient({
            client_id: localStorage.getItem(CLIENT_ID_KEY),
            scope: 'https://www.googleapis.com/auth/calendar.events',
            callback: (resp) => {
                if (resp && resp.access_token) {
                    localStorage.setItem(CAL_TOKEN_KEY, JSON.stringify({
                        token: resp.access_token,
                        exp: Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000,
                    }));
                    resolve(resp.access_token);
                } else reject(new Error('no-token'));
            },
            error_callback: () => reject(new Error('denied')),
        });
        tc.requestAccessToken({ prompt: '' });
    });
}

function rruleFor(months) { return SJ_CK.rrule(months); }
function eventBody(c) { return SJ_CK.eventBody(c, '(נוצר אוטומטית ממעקב הבדיקות של SJ הנדסת חשמל)'); }
function addDays(dateStr, n) { return SJ_CK.addDays(dateStr, n); }

async function syncCalendar(id) {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    if (!nextDue(c)) { toast('קודם קבע תאריך בדיקה (עריכה ✏)'); return; }
    let token;
    try { token = await ensureCalendarToken(); }
    catch { toast('נדרש אישור גישה ליומן Google'); return; }

    const res = await pushToGoogle(c, token);
    if (res.ok) {
        persist();
        render();
        toast('תזכורת חוזרת נקבעה ביומן Google (' + fmtDate(nextDue(c)) + ')');
        return;
    }
    toast(res.reason === 'auth' ? 'ההרשאה ליומן פגה · לחץ שוב על 📅' : 'הוספת התזכורת ליומן נכשלה, נסה שוב');
}

// The calendar half without a word of UI in it, so the bulk run can call it in
// a loop behind one consent and one report. Patches an existing event and falls
// back to creating it when the user deleted it by hand — which is what stops a
// second run leaving two of the same visit in the calendar.
async function pushToGoogle(c, token) {
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const body = JSON.stringify(eventBody(c));
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    try {
        let res = null;
        if (c.eventId) {
            res = await fetch(base + '/' + c.eventId, { method: 'PATCH', headers, body });
            if (res.status === 404 || res.status === 410) res = null; // deleted by hand — recreate
        }
        if (!res) res = await fetch(base, { method: 'POST', headers, body });
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem(CAL_TOKEN_KEY);
            return { ok: false, reason: 'auth' };
        }
        const ev = await res.json();
        if (!res.ok || !ev.id) return { ok: false, reason: 'error' };
        c.eventId = ev.id;
        c.updatedAt = Date.now();
        return { ok: true, reason: '' };
    } catch (e) {
        return { ok: false, reason: 'error' };
    }
}

// ---------- "הוסף הכל ליומן" ----------
//
// The same rules as the one inside the app: everything that is inside its
// reminder window AND not in the calendar yet. A record that already carries an
// event id is skipped — re-pushing it is how a calendar ends up with two of
// every visit — and a date far out is not booked today, because a calendar full
// of next year is a calendar nobody opens.

function bulkQueue() {
    return liveClients()
        .filter((c) => { const d = nextDue(c); return d && daysUntil(d) <= 28 && !c.eventId; })
        .sort((a, b) => nextDue(a).localeCompare(nextDue(b)));
}

function bulkReason(reason) {
    return reason === 'auth' ? 'ההרשאה ליומן פגה'
        : reason === 'skipped' ? 'לא נוסה, ההרשאה פגה לפני כן'
        // A failure on the way back from Google is not proof that nothing was
        // created there, and "failed" would send him to press it again and book
        // the visit twice.
        : 'שגיאה מול היומן · ייתכן שכן נוצר, שווה לבדוק';
}

function bulkOpen() {
    const list = bulkQueue();
    if (!list.length) { toast('אין מה להוסיף · כל מה שקרוב כבר ביומן'); return; }
    const dlg = document.getElementById('bulk-cal');
    if (!dlg) return;
    document.getElementById('bulk-body').innerHTML =
        `<p class="bulk-sum">${list.length} לקוחות ← <b>${list.length}</b> תזכורות חוזרות ביומן</p>
         <ul class="bulk-list">${list.map((c) => `<li><span>${esc(c.name)}</span><small>${fmtDate(nextDue(c))}</small></li>`).join('')}</ul>
         <p class="bulk-note">מה שכבר יושב ביומן לא נוגעים בו. בדיקה שהמועד שלה רחוק תיכנס כשתתקרב.</p>`;
    document.getElementById('bulk-foot').innerHTML =
        `<button type="button" class="btn" onclick="bulkClose()">ביטול</button>
         <button type="button" class="btn primary" onclick="bulkRun()">הוסף ${list.length} ליומן</button>`;
    dlg.showModal();
}

function bulkClose() { const d = document.getElementById('bulk-cal'); if (d) d.close(); }

async function bulkRun() {
    const list = bulkQueue();
    if (!list.length) return;
    // ONE consent for the whole run: Google's popup only survives inside the
    // click that opened it, so a token minted mid-loop is a blocked popup and a
    // run that dies halfway with no explanation.
    let token;
    try { token = await ensureCalendarToken(); }
    catch { toast('אין הרשאה ליומן · מוריד קובץ אחד עם הכל'); bulkIcs(list); return; }

    document.getElementById('bulk-foot').innerHTML = '';
    const results = [];
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const prog = document.getElementById('bulk-body');
        if (prog) prog.innerHTML = `<p class="bulk-sum">מוסיף ${i + 1} מתוך ${list.length} · ${esc(c.name)}</p>`;
        const r = await pushToGoogle(c, token);
        results.push({ c: c, ok: !!r.ok, reason: r.reason || '' });
        if (r.reason === 'auth') {
            for (let j = i + 1; j < list.length; j++) results.push({ c: list[j], ok: false, reason: 'skipped' });
            break;
        }
    }
    // One write for the run, not one per client.
    persist();
    render();
    bulkResult(results);
}

function bulkResult(results) {
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    document.getElementById('bulk-body').innerHTML =
        `${ok.length ? `<p class="bulk-sum ok">נוספו ליומן (${ok.length})</p>
            <ul class="bulk-list">${ok.map((r) => `<li><span>${esc(r.c.name)}</span><small>${fmtDate(nextDue(r.c))}</small></li>`).join('')}</ul>` : ''}
         ${bad.length ? `<p class="bulk-sum bad">לא נוספו (${bad.length})</p>
            <ul class="bulk-list">${bad.map((r) => `<li><span>${esc(r.c.name)}</span><small>${esc(bulkReason(r.reason))}</small></li>`).join('')}</ul>` : ''}`;
    document.getElementById('bulk-foot').innerHTML =
        `<button type="button" class="btn primary" onclick="bulkClose()">סגור</button>`;
    if (ok.length && !bad.length) toast('נוספו ' + ok.length + ' תזכורות ליומן');
}

// No Google account, or consent refused: the whole queue as ONE calendar file.
// Concatenating single files would produce several BEGIN:VCALENDAR headers,
// which no calendar will open.
function bulkIcs(list) {
    const ics = SJ_CK.icsWrap((list || []).map((c) => SJ_CK.icsVevent(c)), 'Periodic');
    if (!ics) { toast('אין מה לייצא'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'periodic-service.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    bulkClose();
    toast('ירד קובץ אחד עם ' + (list || []).length + ' תזכורות');
}

// ---------- ICS (iPhone / Apple Calendar / Outlook) ----------

// RFC 5545 TEXT escaping — raw newlines/commas/semicolons in a property value
// make the whole file unparseable for Apple Calendar/Outlook.
function icsText(s) { return SJ_CK.icsText(s); }

function downloadIcs(id) {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    const due = nextDue(c);
    if (!due) { toast('קודם קבע תאריך בדיקה (עריכה ✏)'); return; }
    const ics = SJ_CK.icsFile(c);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'checkup-' + (c.name || 'client').replace(/[^\w֐-׿-]+/g, '_') + '.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('באייפון: פתח את הקובץ והוא ייכנס ליומן עם התראות');
}

// ---------- WhatsApp ----------

function whatsapp(id) {
    const c = clients.find((x) => x.id === id);
    if (!c || !c.phone) return;
    let digits = c.phone.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '972' + digits.slice(1);
    const due = nextDue(c);
    const msg = 'שלום, כאן סתיו מ-SJ הנדסת חשמל. מתקרב מועד הבדיקה התקופתית למתקן החשמל אצלכם' +
        (due ? ' (' + fmtDate(due) + ')' : '') + ' · אשמח שנתאם מועד שנוח לכם.';
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(msg), '_blank');
}

// ---------- Excel import / CSV export ----------

function openImport() { document.getElementById('importer').showModal(); }

function runImport() {
    const text = document.getElementById('import-text').value.trim();
    if (!text) return;
    let added = 0, skipped = 0;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        // Excel pastes tab-separated; a hand-typed line may use commas.
        const parts = (line.includes('\t') ? line.split('\t') : line.split(',')).map((s) => s.trim());
        const [name, phone, site, monthsRaw, lastRaw, email] = parts;
        if (!name) { skipped++; continue; }
        const months = Math.max(1, Math.min(120, parseInt(monthsRaw, 10) || 12));
        clients.push({
            id: 'c' + Date.now() + Math.random().toString(36).slice(2, 7),
            name, phone: phone || '', email: email || '', site: site || '', type: 'בדיקה תקופתית',
            months, last: parseAnyDate(lastRaw), next: null, notes: '', eventId: null,
            updatedAt: Date.now(),
        });
        added++;
    }
    document.getElementById('importer').close();
    document.getElementById('import-text').value = '';
    persist();
    render();
    toast('יובאו ' + added + ' לקוחות' + (skipped ? ' (' + skipped + ' שורות דולגו)' : ''));
}

function parseAnyDate(s) {
    if (!s) return null;
    s = s.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
    if (m) {
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        return y + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    }
    return null;
}

function exportCsv() {
    const header = 'שם,טלפון,אימייל,כתובת,סוג בדיקה,תדירות (חודשים),בדיקה אחרונה,בדיקה הבאה';
    const rows = liveClients().map((c) => [
        c.name, c.phone, c.email || '', c.site, c.type, c.months, c.last || '', nextDue(c) || '',
    ].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));
    const a = document.createElement('a');
    // BOM so Excel opens the Hebrew correctly.
    a.href = URL.createObjectURL(new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'checkups-' + todayStr() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

// ---------- misc ----------

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3500);
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- reminders-to-send strip + email draft ----------

// Clients whose due date entered the reminder window (28 days, matching the
// first calendar alert) — surfaced at the top so a glance says who to nudge.
function renderDueStrip() {
    const el = document.getElementById('due-strip');
    if (!el) return;
    const due = liveClients()
        .filter((c) => { const d = nextDue(c); return d && daysUntil(d) <= 28; })
        .sort((a, b) => nextDue(a).localeCompare(nextDue(b)));
    if (due.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="strip">
            <div class="strip-title">🔔 תזכורות לשליחה · הבדיקה מתקרבת</div>
            <div class="strip-chips">
                ${due.slice(0, 8).map((c) => {
                    const days = daysUntil(nextDue(c));
                    const when = days < 0 ? 'באיחור ' + Math.abs(days) + ' יום' : days === 0 ? 'היום' : 'בעוד ' + days + ' יום';
                    return `<span class="chip">
                        <b>${esc(c.name)}</b><small>${when}</small>
                        ${c.phone ? `<button title="וואטסאפ" class="chip-btn" style="color:#25d366" onclick="whatsapp('${c.id}')">💬</button>` : ''}
                        ${c.email ? `<button title="מייל" class="chip-btn" onclick="mailto('${c.id}')">✉</button>` : ''}
                    </span>`;
                }).join('')}
                ${due.length > 8 ? `<span class="chip"><small>+${due.length - 8} נוספים ברשימה</small></span>` : ''}
            </div>
        </div>`;
}

function reminderText(c) {
    const due = nextDue(c);
    return 'שלום, כאן סתיו מ-SJ הנדסת חשמל. מתקרב מועד הבדיקה התקופתית למתקן החשמל אצלכם' +
        (due ? ' (' + fmtDate(due) + ')' : '') + ' · אשמח שנתאם מועד שנוח לכם.';
}

function mailto(id) {
    const c = clients.find((x) => x.id === id);
    if (!c || !c.email) return;
    const subject = 'תיאום ' + (c.type || 'בדיקה תקופתית') + ' · מתקן החשמל';
    const body = reminderText(c) + '\n\nבברכה,\nSJ הנדסת חשמל';
    // Opens the mail app with a ready draft — review and send manually.
    window.location.href = 'mailto:' + encodeURIComponent(c.email) +
        '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}
