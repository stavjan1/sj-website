// ============================================================================
//  שירות תקופתי — maintenance that comes back, and the clients who owe a visit
// ============================================================================
// Lifted out of sale/app.js on 25/08/2026, unchanged. Two halves of one idea
// that were 12,000 lines apart in the monolith: maintenance living on a project
// (p.maintenance), and the older standalone client list shared with /checkups/.
// Everything here runs from a click or a render, never while the app boots, and
// the file loads after app.js — which is where the state it reads is declared.

// ==========================================================================
// Periodic maintenance, a project that comes back.
//
// Most jobs end when the quote is paid. Some don't: an annual inspection, a
// filter change, a thermographic scan. Those were being tracked as one-off
// projects and remembered by the electrician, which is to say forgotten. A
// maintenance project carries its own interval and next date, and the bell
// picks it up at the lead times the user chose once.
// ==========================================================================

// Presets in the order a tradesman actually thinks about them: the long warning
// to book the visit, the short one to actually show up. Days, not months, so
// the arithmetic is honest about a 90-day quarter.
const MAINT_LEAD_PRESETS = [
    { id: '90-30', days: [90, 30], label: '3 חודשים + חודש' },
    { id: '60-14', days: [60, 14], label: 'חודשיים + שבועיים' },
    { id: '30',    days: [30],     label: 'חודש בלבד' },
    { id: '14',    days: [14],     label: 'שבועיים בלבד' },
    { id: 'none',  days: [],       label: 'בלי תזכורת מוקדמת' },
];
const MAINT_LEAD_DEFAULT = [90, 30];

// How many times the work is assumed to come back. Three by default: long
// enough to be worth automating, short enough that a stale series cannot haunt
// a calendar for a decade after the customer changed hands.
const MAINT_REPEATS_DEFAULT = 3;
const MAINT_REPEAT_PRESETS = [
    { n: 1, label: 'פעם אחת' },
    { n: 3, label: '3 פעמים' },
    { n: 5, label: '5 פעמים' },
    { n: 0, label: 'ללא הגבלה' },
];

// One default for everyone, overridable per project. Asking on every project
// would be friction on the 95% that want the same answer; forcing one number
// on everyone ignores that a factory needs a quarter's notice and a flat needs
// two weeks. So: a global default here, and a per-project override on the card.
function maintDefaultLeads() {
    const v = appState.settings && appState.settings.maintenanceLeadDays;
    return Array.isArray(v) ? v.slice() : MAINT_LEAD_DEFAULT.slice();
}
function maintLeadsFor(proj) {
    const m = proj && proj.maintenance;
    return m && Array.isArray(m.leadDays) ? m.leadDays.slice() : maintDefaultLeads();
}
function maintLeadLabel(days) {
    if (!days || !days.length) return 'בלי תזכורת מוקדמת';
    const preset = MAINT_LEAD_PRESETS.find((p) => p.days.join(',') === days.join(','));
    if (preset) return preset.label;
    return days.map((d) => (d % 30 === 0 ? (d / 30) + ' חודשים' : d + ' ימים')).join(' + ');
}
// Has the user ever been asked? Absence, not emptiness: "בלי תזכורת מוקדמת"
// is a real answer and must not re-trigger the question.
function maintLeadsChosen() {
    return !!(appState.settings && Array.isArray(appState.settings.maintenanceLeadDays));
}

// Recurrence is a property, not a kind of project.
//
// The first version asked at creation: one-off job or periodic maintenance.
// Stav's counter-example killed it, panel maintenance is a one-off JOB whose
// OPPORTUNITY comes back next year. The work is not recurring; the sale is. And
// at creation you usually don't know yet: you know when the job is finished. So
// any project can be told "remind me to come back", and the list can filter for
// the ones that carry it.
function projectRepeats(p) {
    return !!(p && p.maintenance && p.maintenance.next);
}

// ---- the dialog ----
let _maintTarget = null;      // project id being configured
let _maintMonths = 12;
let _maintRepeats = MAINT_REPEATS_DEFAULT;

function openMaintenanceDialog(projectId) {
    const proj = projectsList.find((p) => p.id === projectId);
    const dlg = document.getElementById('maint-dialog');
    if (!proj || !dlg) return;
    _maintTarget = projectId;
    const existing = proj.maintenance || {};
    // A one-time reminder must round-trip as one-time, months||12 would
    // silently convert it into a yearly series on the next save.
    _maintMonths = existing.once ? -1 : (existing.months || 12);

    _maintRepeats = maintRepeatsOf(proj);
    document.getElementById('maint-for').textContent = 'עבור: ' + (proj.name || 'הפרויקט');
    maintPickInterval(_maintMonths, true);
    maintRenderRepeats();
    document.getElementById('maint-next').value = existing.next ||
        (_maintMonths > 0 ? maintAddMonths(ckToday(), _maintMonths) : ckToday());
    // Offer the calendar only once there is something to put in it.
    const calBlock = document.getElementById('maint-cal-block');
    if (calBlock) calBlock.style.display = existing.next ? '' : 'none';
    closeMaintCalPicker();

    // The lead-time question is asked once, ever. After that the block becomes
    // a quiet line telling you what's set and where to change it.
    const block = document.getElementById('maint-lead-block');
    const row = document.getElementById('maint-lead-row');
    const note = document.getElementById('maint-lead-note');
    const current = maintLeadsFor(proj);
    if (maintLeadsChosen() && !existing.leadDays) {
        row.innerHTML = '';
        block.querySelector('label').textContent = 'תזכורות';
        note.textContent = maintLeadLabel(current) + ' לפני המועד, לשינוי: הגדרות ← תזכורות תחזוקה.';
    } else {
        block.querySelector('label').textContent = 'מתי להזכיר לך?';
        note.textContent = 'בחר את מועד התזכורות הנוח לך, יהיה ניתן לשנות אותו בכל זמן דרך מסך ההגדרות.';
        row.innerHTML = MAINT_LEAD_PRESETS.map((p) => {
            const on = p.days.join(',') === current.join(',');
            return `<button type="button" class="mchip${on ? ' active' : ''}" data-lead="${p.id}" onclick="maintPickLead('${p.id}')">${escapeHtml(p.label)}</button>`;
        }).join('');
    }
    dlg.showModal();
}

function maintPickInterval(months, silent) {
    _maintMonths = months;
    document.querySelectorAll('#maint-interval-row .mchip').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.months) === months);
    });
    const custom = document.getElementById('maint-months-custom');
    if (custom) custom.style.display = months === 0 ? '' : 'none';
    // One-time (-1): no recurrence, so the repeat-count question disappears
    // and the date is whatever the user picks — nothing to auto-compute.
    const repeatField = document.getElementById('maint-repeat-row');
    if (repeatField && repeatField.closest('.ck-field')) {
        repeatField.closest('.ck-field').style.display = months === -1 ? 'none' : '';
    }
    if (!silent && months > 0) {
        document.getElementById('maint-next').value = maintAddMonths(ckToday(), months);
    }
}
function maintCustomMonths() {
    const v = parseInt(document.getElementById('maint-months-custom').value, 10);
    if (!v || v < 1) return;
    _maintMonths = Math.min(120, v);
    document.getElementById('maint-next').value = maintAddMonths(ckToday(), _maintMonths);
}
function maintRenderRepeats() {
    const row = document.getElementById('maint-repeat-row');
    if (!row) return;
    row.innerHTML = MAINT_REPEAT_PRESETS.map((p) =>
        `<button type="button" class="mchip${p.n === _maintRepeats ? ' active' : ''}" onclick="maintPickRepeats(${p.n})">${escapeHtml(p.label)}</button>`
    ).join('');
}
function maintPickRepeats(n) {
    _maintRepeats = n;
    maintRenderRepeats();
}
function maintPickLead(id) {
    document.querySelectorAll('#maint-lead-row .mchip').forEach((b) => {
        b.classList.toggle('active', b.dataset.lead === id);
    });
}
function _maintSelectedLeads() {
    const el = document.querySelector('#maint-lead-row .mchip.active');
    if (!el) return null;                     // the block was in "already chosen" mode
    const preset = MAINT_LEAD_PRESETS.find((p) => p.id === el.dataset.lead);
    return preset ? preset.days.slice() : null;
}

// Dates: reuse the checkup helpers, which already clamp 31.1 + 1mo to 28.2.
function maintAddMonths(dateStr, months) { return ckAddMonths(dateStr, months || 12); }

function maintSave() {
    const proj = projectsList.find((p) => p.id === _maintTarget);
    const dlg = document.getElementById('maint-dialog');
    if (!proj) { dlg.close(); return; }
    const next = document.getElementById('maint-next').value;
    if (!next) { showToast('בחר תאריך לביקור הבא', 'error'); return; }

    const chosen = _maintSelectedLeads();
    if (chosen && !maintLeadsChosen()) {
        // First maintenance project ever → this answer becomes the default.
        if (!appState.settings) appState.settings = {};
        appState.settings.maintenanceLeadDays = chosen;
        persistSettings();
    }
    proj.kind = 'maintenance';
    proj.maintenance = Object.assign({}, proj.maintenance, {
        once: _maintMonths === -1 || undefined,
        months: _maintMonths === -1 ? null : (_maintMonths || 12),
        next,
        repeats: _maintMonths === -1 ? 1 : _maintRepeats,
        // Only record an override when it differs from the global default.
        leadDays: chosen && chosen.join(',') !== maintDefaultLeads().join(',') ? chosen : null,
        eventId: (proj.maintenance && proj.maintenance.eventId) || null
    });
    saveProjects();
    filterProjectsList();
    dlg.close();
    showToast('נקבע, ' + ckFmtDate(next) + ' · תזכורת ' + maintLeadLabel(maintLeadsFor(proj)) + ' לפני');
}

// Stop following a job from the periodic-service list, without opening the
// dialog first: the row on that screen is where you decide it is over.
async function maintStop(projectId) {
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj) return;
    if (!await askConfirm({ title: 'להפסיק את המעקב?', body: `לא נזכיר לך יותר לחזור ל-"${proj.name}".`, note: 'העבודה עצמה נשארת ברשימה.', confirmLabel: 'הפסק מעקב' })) return;
    proj.kind = 'job';
    proj.maintenance = null;
    saveProjects();
    renderMaintenanceProjects();
    filterProjectsList();
    try { renderReminderBell(); } catch (e) {}
    showToast('המעקב הופסק');
}

function maintCancel() {
    const proj = projectsList.find((p) => p.id === _maintTarget);
    if (proj) { proj.kind = 'job'; proj.maintenance = null; saveProjects(); filterProjectsList(); }
    document.getElementById('maint-dialog').close();
}

// The due date the bell and the calendar both read.
function maintNextDue(proj) {
    const m = proj && proj.maintenance;
    return m && m.next ? m.next : null;
}
// Days until the FIRST lead time is reached; null when it isn't due to nag yet.
function maintDueIn(proj) {
    const due = maintNextDue(proj);
    if (!due) return null;
    const leads = maintLeadsFor(proj);
    if (!leads.length) return null;                 // user asked for no early nudge
    const days = ckDaysUntil(due);
    return days <= Math.max.apply(null, leads) ? days : null;
}

// The chip on the project row: the next date, and one tap to change it. Turns
// amber once the job has entered its reminder window.
function maintBadgeHtml(p) {
    const due = maintNextDue(p);
    // Not recurring (yet): a quiet affordance, so any project can become one
    // the moment you realise it will come back: usually when it's finished.
    if (!due) {
        return `<span class="maint-chip maint-add" onclick="event.stopPropagation(); openMaintenanceDialog('${escapeHtml(p.id)}')" title="תזכיר לי לחזור לעבודה הזאת"><i class="fa-solid fa-rotate"></i> תזכיר לי לחזור</span>`;
    }
    const n = ckDaysUntil(due);
    const due_soon = maintDueIn(p) !== null;
    const when = n < 0 ? 'באיחור ' + Math.abs(n) + ' יום' : n === 0 ? 'היום' : ckFmtDate(due);
    return `<span class="maint-chip${due_soon ? ' is-due' : ''}" onclick="event.stopPropagation(); openMaintenanceDialog('${escapeHtml(p.id)}')" title="תחזוקה תקופתית · לחץ לעריכה"><i class="fa-solid fa-rotate"></i> ${escapeHtml(when)}</span>`;
}

// ---- reaching the customer about a visit (not about a quote) ----
function maintMessage(proj) {
    const due = maintNextDue(proj);
    const biz = (appState.settings && appState.settings.businessDetails && appState.settings.businessDetails.name) || '';
    const who = (proj.quoteData && proj.quoteData.clientName) || '';
    return 'שלום' + (who ? ' ' + who : '') + ', ' + (biz ? 'כאן ' + biz + '. ' : '') +
        'מתקרב מועד התחזוקה התקופתית' + (due ? ' (' + ckFmtDate(due) + ')' : '') +
        ' · אשמח שנתאם מועד שנוח לכם.';
}
function maintWhatsApp(projectId) {
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj) return;
    let digits = String(proj.clientPhone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '972' + digits.slice(1);
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(maintMessage(proj)), '_blank', 'noopener');
}
function maintEmail(projectId) {
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj || !proj.clientEmail) return;
    const subject = 'תיאום תחזוקה תקופתית, ' + ((proj.quoteData && proj.quoteData.subject) || proj.name);
    window.location.href = 'mailto:' + encodeURIComponent(proj.clientEmail) +
        '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(maintMessage(proj));
}

// A visit happened → roll the date forward one interval instead of making the
// user do the arithmetic (and instead of the reminder nagging forever).
function maintMarkDone(projectId) {
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj || !proj.maintenance) return;
    // A one-time reminder is done for good, no next date to compute.
    if (proj.maintenance.once) {
        proj.maintenance = null;
        proj.kind = 'job';
        saveProjects();
        filterProjectsList();
        showToast('הביקור נרשם · התזכורת החד-פעמית הושלמה');
        return;
    }
    const from = proj.maintenance.next || ckToday();
    proj.maintenance.next = maintAddMonths(from, proj.maintenance.months || 12);
    proj.maintenance.eventId = null;    // the old calendar series no longer matches
    saveProjects();
    filterProjectsList();
    showToast('הביקור נרשם · הבא: ' + ckFmtDate(proj.maintenance.next));
}

// ==========================================================================
// The maintenance reminder, in the calendar the phone already rings from.
//
// Two constraints shaped this. Google's API caps a reminder override at 40320
// minutes, 28 days, so a "three months ahead" lead cannot be an alarm on the
// visit; it has to be its own (also recurring) heads-up event. ICS has no such
// limit, so Apple and Outlook get one event carrying an alarm per lead time.
// Both carry a link back into the project, because a reminder that only says
// "call someone" makes you go find the file yourself.
// ==========================================================================

function maintDeepLink(proj) {
    // Same origin in production; localhost during development keeps working.
    const base = location.origin.includes('localhost') ? location.origin + '/sale/' : 'https://www.sj-eng.co.il/sale/';
    return base + '?p=' + encodeURIComponent(proj.id);
}
// What the recurring work is called, so the calendar block reads like the job.
function maintKindLabel(months) {
    if (!months) return 'ביקור חד-פעמי';
    if (months === 12) return 'בדיקה שנתית';
    if (months === 6) return 'בדיקה חצי-שנתית';
    if (months === 24) return 'בדיקה דו-שנתית';
    if (months % 12 === 0) return 'בדיקה כל ' + (months / 12) + ' שנים';
    return 'בדיקה כל ' + months + ' חודשים';
}
function maintClientName(proj) {
    return ((proj.quoteData && proj.quoteData.clientName) || proj.name || 'לקוח').trim();
}
// The calendar entry is the ACTION, at the moment you should take it: not a
// note on the visit itself. First block: send the quote. A second lead time,
// if chosen, is the "they never answered" nudge.
function maintBlockTitle(proj, months, isFirst) {
    const what = maintKindLabel(months);
    return isFirst
        ? 'שלח הצעת מחיר ל' + maintClientName(proj) + ', ' + what
        : 'תזכורת: הצעת מחיר ל' + maintClientName(proj) + ', ' + what;
}
function maintEventBody(proj) {
    const q = proj.quoteData || {};
    // Drop the contact lines we don't have, but keep the deliberate blank ones: // filtering the whole list left a wall of empty lines when a phone was missing.
    const contact = [
        q.clientName ? 'לקוח: ' + q.clientName : '',
        proj.clientPhone ? 'טלפון: ' + proj.clientPhone : '',
        proj.clientEmail ? 'מייל: ' + proj.clientEmail : '',
    ].filter(Boolean);
    return [
        ...contact,
        ...(contact.length ? [''] : []),
        'פתיחת הפרויקט בזרם (הפקת הצעה / קביעה לשנה הבאה):',
        maintDeepLink(proj),
        '',
        '(נוצר אוטומטית מזרם)',
    ].join('\n');
}
// Bounded on purpose. An open-ended series keeps firing years after the
// customer, the price or the job changed: Stav's point, and he is right: the
// app knows when a visit actually happened and can extend then. `repeats: 0`
// is the explicit "no end" choice for someone who wants it anyway.
function maintRrule(months, repeats) {
    const base = months % 12 === 0
        ? 'RRULE:FREQ=YEARLY;INTERVAL=' + (months / 12)
        : 'RRULE:FREQ=MONTHLY;INTERVAL=' + months;
    const n = Number(repeats);
    return n > 0 ? base + ';COUNT=' + n : base;
}
function maintRepeatsOf(proj) {
    const r = proj && proj.maintenance && proj.maintenance.repeats;
    return r === 0 || r > 0 ? r : MAINT_REPEATS_DEFAULT;
}

function openMaintCalendarPicker(projectId) {
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj || !maintNextDue(proj)) { showToast('קודם קבע מועד תחזוקה', 'error'); return; }
    const box = document.getElementById('maint-cal-picker');
    if (!box) return;
    const id = escapeHtml(projectId);
    box.innerHTML = `
        <div class="mcal-head">להוסיף את התזכורת ליומן</div>
        <button class="mcal-opt" onclick="maintToGoogle('${id}')"><i class="fa-brands fa-google"></i> יומן Google</button>
        <button class="mcal-opt" onclick="maintToIcs('${id}')"><i class="fa-brands fa-apple"></i> אפל / אייפון</button>
        <button class="mcal-opt" onclick="maintToIcs('${id}')"><i class="fa-solid fa-envelope-open-text"></i> Outlook / אחר</button>
        <button class="mcal-opt" onclick="maintCopyLink('${id}')"><i class="fa-solid fa-link"></i> העתק קישור לפרויקט</button>`;
    box.hidden = false;
    setTimeout(() => document.addEventListener('click', _maintCalOutside), 0);
}
function _maintCalOutside(ev) {
    const box = document.getElementById('maint-cal-picker');
    if (box && !box.contains(ev.target)) closeMaintCalPicker();
}
function closeMaintCalPicker() {
    const box = document.getElementById('maint-cal-picker');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    document.removeEventListener('click', _maintCalOutside);
}

function maintCopyLink(projectId) {
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj) return;
    const link = maintDeepLink(proj);
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
        .then(() => showToast('הקישור הועתק'))
        .catch(() => window.prompt('העתק את הקישור:', link));
    closeMaintCalPicker();
}

async function maintToGoogle(projectId) {
    closeMaintCalPicker();
    const proj = projectsList.find((p) => p.id === projectId);
    const due = proj && maintNextDue(proj);
    if (!due) return;
    if (isGuestUser()) { showToast('יומן Google דורש התחברות עם Google, מוריד קובץ במקום', 'error'); maintToIcs(projectId); return; }
    let token;
    try { token = await ckEnsureCalToken(); }
    catch { showToast('נדרש אישור גישה ליומן, מוריד קובץ במקום'); maintToIcs(projectId); return; }

    const res = await maintPushToGoogle(proj, token);
    const blocks = res.blocks || [];
    if (res.ok) {
        saveProjects();
        filterProjectsList();
        showToast(blocks.length === 1
            ? 'נקבע ביומן: ' + ckFmtDate(blocks[0].date) + ' · ' + blocks[0].title
            : 'נקבעו ' + blocks.length + ' פגישות ביומן, הראשונה ב-' + ckFmtDate(blocks[0].date));
        return;
    }
    if (res.reason === 'noblocks') { showToast('לא נבחרו תזכורות לפרויקט הזה', 'error'); return; }
    if (res.reason === 'auth') {
        // Whatever did get in is recorded, so the retry replaces it instead of
        // adding a second copy.
        saveProjects();
        showToast('ההרשאה ליומן פגה · לחץ שוב על היומן', 'error');
        return;
    }
    saveProjects();
    showToast('הוספה ליומן נכשלה · מוריד קובץ במקום', 'error');
    maintToIcs(projectId);
}

// The calendar half of the button above, with not one word of UI in it: the
// bulk runner has to push twenty of these behind ONE consent and ONE report,
// and a function that raises its own toast cannot be called twenty times.
//
// The write-back lives in a `finally` deliberately. Before this, a 401 arriving
// on the second of three blocks returned early and left the first event sitting
// in the calendar with its id recorded nowhere — so the next attempt created a
// second copy, and nothing could ever find the first one to delete it.
async function maintPushToGoogle(proj, token) {
    const created = [];
    const blocks = maintBlocks(proj);
    if (!blocks.length) return { ok: false, reason: 'noblocks', blocks: blocks, ids: created };
    const months = proj.maintenance && proj.maintenance.once ? 0 : ((proj.maintenance && proj.maintenance.months) || 12);
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Jerusalem';
    try {
        // Replace any series made earlier, so re-adding never doubles the calendar.
        await maintDeleteGoogleEvents(proj, token);

        for (const b of blocks) {
            const body = JSON.stringify({
                summary: b.title,
                description: maintEventBody(proj),
                start: { dateTime: b.date + 'T09:00:00', timeZone: tz },
                end: { dateTime: b.date + 'T10:00:00', timeZone: tz },
                // One-time reminders are a single event, not a series.
                ...(proj.maintenance && proj.maintenance.once ? {} : { recurrence: [maintRrule(months, maintRepeatsOf(proj))] }),
                reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }
            });
            const r = await fetch(base, { method: 'POST', headers, body });
            if (r.status === 401 || r.status === 403) {
                localStorage.removeItem(CK_CAL_TOKEN_KEY);
                return { ok: false, reason: 'auth', blocks: blocks, ids: created };
            }
            const ev = await r.json();
            if (!r.ok || !ev.id) return { ok: false, reason: 'error', blocks: blocks, ids: created };
            created.push(ev.id);
        }
        return { ok: true, reason: '', blocks: blocks, ids: created };
    } catch (e) {
        return { ok: false, reason: 'error', blocks: blocks, ids: created };
    } finally {
        if (created.length) {
            proj.maintenance.eventIds = created;
            proj.maintenance.eventId = created[0];
        }
    }
}

// One hour, at the date you should act: the visit itself needs no entry, the
// work does. A 12-month interval with a 3-month lead lands the block nine
// months out, which is where it is actually useful.
function maintBlocks(proj) {
    const due = maintNextDue(proj);
    if (!due) return [];
    const months = proj.maintenance && proj.maintenance.once ? 0 : ((proj.maintenance && proj.maintenance.months) || 12);
    const leads = maintLeadsFor(proj);
    // No early warning chosen → still put the job in the calendar, on the day.
    if (!leads.length) return [{ date: due, days: 0, title: maintBlockTitle(proj, months, true) }];
    return leads
        .slice()
        .sort((a, b) => b - a)                     // earliest action first
        .map((d, i) => ({ date: ckAddDays(due, -d), days: d, title: maintBlockTitle(proj, months, i === 0) }));
}

async function maintDeleteGoogleEvents(proj, token) {
    const ids = (proj.maintenance && proj.maintenance.eventIds) || [];
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events/';
    for (const id of ids) {
        // A 404/410 just means the user already deleted it by hand, fine.
        try { await fetch(base + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }); } catch (e) {}
    }
}

// The same blocks, as a file Apple Calendar and Outlook understand.
function maintToIcs(projectId) {
    closeMaintCalPicker();
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj || !maintNextDue(proj)) return;
    const blocks = maintBlocks(proj);
    if (!blocks.length) { showToast('לא נבחרו תזכורות לפרויקט הזה', 'error'); return; }
    const ics = SJ_CK.icsWrap(maintIcsVevent(proj), 'Maintenance');
    if (!ics) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'maintenance-' + String(proj.name || 'client').replace(/[^\w֐-׿-]+/g, '_') + '.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(blocks.length === 1
        ? 'הקובץ ירד · פגישה ב-' + ckFmtDate(blocks[0].date)
        : 'הקובץ ירד, ' + blocks.length + ' פגישות, הראשונה ב-' + ckFmtDate(blocks[0].date));
}

// The events of one maintenance project as VEVENT lines, ready to be wrapped
// alone or alongside twenty others. Floating local time (no Z) on purpose:
// 09:00 stays 09:00 wherever the phone happens to be.
function maintIcsVevent(proj) {
    const blocks = maintBlocks(proj);
    if (!blocks.length) return [];
    const months = proj.maintenance && proj.maintenance.once ? 0 : ((proj.maintenance && proj.maintenance.months) || 12);
    const desc = ckIcsText(maintEventBody(proj));
    const stampNow = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    return blocks.flatMap((b, i) => {
        const d = b.date.replace(/-/g, '');
        const summary = ckIcsText(b.title);
        return [
            'BEGIN:VEVENT',
            'UID:maint-' + proj.id + '-' + i + '@sj-eng.co.il',
            'DTSTAMP:' + stampNow,
            'DTSTART:' + d + 'T090000',
            'DTEND:' + d + 'T100000',
            ...(proj.maintenance && proj.maintenance.once ? [] : [maintRrule(months, maintRepeatsOf(proj))]),
            'SUMMARY:' + summary,
            'DESCRIPTION:' + desc,
            'URL:' + maintDeepLink(proj),
            'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:' + summary, 'END:VALARM',
            'END:VEVENT',
        ];
    });
}

// ---- arriving from the reminder ----------------------------------------
//
// The link in the calendar lands here. Being told "call someone" and then
// having to go find the project yourself is most of the work; this opens it
// and offers the two things you actually came to do.

let _pendingMaintProject = null;

function captureMaintDeepLink() {
    try {
        const p = new URLSearchParams(location.search).get('p');
        if (p) {
            _pendingMaintProject = p;
            // Clean the URL so a refresh (or a shared screenshot) doesn't re-trigger.
            history.replaceState({}, '', location.pathname);
        }
    } catch (e) {}
}

function resumeMaintDeepLink() {
    if (!_pendingMaintProject) return;
    const id = _pendingMaintProject;
    _pendingMaintProject = null;
    const proj = projectsList.find((p) => p.id === id);
    if (!proj) { showToast('הפרויקט מהתזכורת לא נמצא בחשבון הזה', 'error'); return; }
    const due = maintNextDue(proj);
    const box = document.getElementById('maint-arrive');
    if (!box) return;
    box.innerHTML = `
        <div class="marr-card">
            <div class="marr-title"><i class="fa-solid fa-rotate"></i> ${escapeHtml(proj.name || 'תחזוקה')}</div>
            <div class="marr-sub">${due ? 'מועד התחזוקה: ' + ckFmtDate(due) : 'לא נקבע מועד'}</div>
            <div class="marr-acts">
                <button class="btn btn-accent btn-small" onclick="maintArriveQuote('${escapeHtml(id)}')"><i class="fa-solid fa-file-invoice-dollar"></i> הפק הצעת מחיר</button>
                ${proj.clientPhone ? `<button class="btn btn-success btn-small" onclick="maintWhatsApp('${escapeHtml(id)}')"><i class="fa-brands fa-whatsapp"></i> תאם עם הלקוח</button>` : ''}
                <button class="btn btn-secondary btn-small" onclick="maintArriveDone('${escapeHtml(id)}')"><i class="fa-solid fa-check"></i> בוצע · קבע לשנה הבאה</button>
                <button class="btn btn-secondary btn-small" onclick="maintArriveOpen('${escapeHtml(id)}')">פתח את הפרויקט</button>
                <button class="marr-x" title="סגור" onclick="maintArriveClose()"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>`;
    switchTab('projects');
}
function maintArriveClose() {
    const box = document.getElementById('maint-arrive');
    if (box) box.innerHTML = '';
}
function maintArriveOpen(id) { maintArriveClose(); loadProject(id, false); }
function maintArriveDone(id) { maintMarkDone(id); maintArriveClose(); }
function maintArriveQuote(id) {
    maintArriveClose();
    loadProject(id, false);
    switchTab('wizard');
    setTimeout(() => {
        const inp = document.getElementById('chat-user-input');
        const proj = projectsList.find((p) => p.id === id);
        if (inp && proj) {
            inp.value = 'תחזוקה תקופתית, ' + (proj.name || '') + '. בוא נבנה רשימת ציוד והצעת מחיר לביקור.';
            inp.dispatchEvent(new Event('input'));
        }
    }, 500);
}

// ---- settings screen ----
function renderMaintenanceSetting() {
    const row = document.getElementById('maint-setting-row');
    if (!row) return;
    const cur = maintDefaultLeads();
    row.innerHTML = MAINT_LEAD_PRESETS.map((p) => {
        const on = p.days.join(',') === cur.join(',');
        return `<button type="button" class="mchip${on ? ' active' : ''}" onclick="setMaintenanceLeads('${p.id}')">${escapeHtml(p.label)}</button>`;
    }).join('');
}
function setMaintenanceLeads(id) {
    const preset = MAINT_LEAD_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    if (!appState.settings) appState.settings = {};
    appState.settings.maintenanceLeadDays = preset.days.slice();
    persistSettings();
    renderMaintenanceSetting();
    try { renderFollowupReminders(); } catch (e) {}
    try { renderMaintDueStrip(); } catch (e) {}
    showToast('תזכורות התחזוקה: ' + preset.label + ' לפני המועד');
}

// ==========================================================================
// "מי מחכה לי", one bell over both reminder systems.
//
// Two things nudge you to call a customer, and until now they lived on two
// different tabs: a quote sent with no answer (the strip above, projects
// dashboard) and a periodic checkup coming due (the שירות תקופתי tab). Either
// one could sit there for a week unseen, because seeing it required being on
// exactly the right screen. The bell carries the count everywhere and opens
// both lists in one place.
// ==========================================================================

// Read the checkup clients off local storage without triggering the tab's
// cloud pull: the bell needs the numbers, not a sync.
function ckEnsureLocal() {
    if (ckLoaded) return;
    try { ckClients = JSON.parse(localStorage.getItem(ckStorageKey()) || '[]'); } catch { ckClients = []; }
    if (!Array.isArray(ckClients)) ckClients = [];
    ckLoaded = true;
}

// Both sources, flattened into one shape and sorted by how late they are.
function getReminderItems() {
    const items = [];
    try {
        getDueFollowups().forEach((p) => {
            const since = p.statusChangedAt || new Date(p.created).getTime() || Date.now();
            const days = Math.floor((Date.now() - since) / 86400000);
            const isPayment = (p.status || '') === 'הושלם';
            items.push({
                kind: 'followup', id: p.id, name: p.name || 'פרויקט',
                why: (isPayment ? 'ממתין לתשלום' : 'ממתין לתשובה') + ' ' + days + ' ימים',
                lateness: days,
                phone: p.clientPhone || '', email: p.clientEmail || ''
            });
        });
    } catch (e) { /* projects not loaded yet */ }
    try {
        (projectsList || []).forEach((p) => {
            if (!projectRepeats(p)) return;
            const n = maintDueIn(p);
            if (n === null) return;                 // not inside its lead window yet
            items.push({
                kind: 'maintenance', id: p.id, name: p.name || 'תחזוקה',
                why: n < 0 ? 'תחזוקה באיחור ' + Math.abs(n) + ' יום'
                    : n === 0 ? 'התחזוקה היום' : 'תחזוקה בעוד ' + n + ' יום',
                lateness: -n,
                phone: p.clientPhone || '', email: p.clientEmail || ''
            });
        });
    } catch (e) { /* projects not loaded yet */ }
    try {
        ckEnsureLocal();
        ckDueSoonClients().forEach((c) => {
            const n = ckDaysUntil(ckNextDue(c));
            items.push({
                kind: 'checkup', id: c.id, name: c.name || 'לקוח',
                why: n < 0 ? 'בדיקה באיחור ' + Math.abs(n) + ' יום' : n === 0 ? 'הבדיקה היום' : 'בדיקה בעוד ' + n + ' יום',
                // Same unit as a follow-up's: days already overdue. A checkup
                // that hasn't come due yet goes negative, so it sorts below a
                // quote that is genuinely sitting there waiting for an answer.
                lateness: -n,
                phone: c.phone || '', email: c.email || ''
            });
        });
    } catch (e) { /* checkups not available */ }
    return items.sort((a, b) => b.lateness - a.lateness);
}

function renderReminderBell() {
    const n = getReminderItems().length;
    const deskCount = document.getElementById('rb-count');
    if (deskCount) {
        deskCount.textContent = n > 99 ? '99+' : String(n);
        deskCount.hidden = n === 0;
    }
    const bell = document.getElementById('reminder-bell');
    if (bell) {
        bell.classList.toggle('has-due', n > 0);
        bell.setAttribute('aria-label', n === 0 ? 'תזכורות לקוחות, אין כרגע' : 'תזכורות לקוחות, ' + n + ' ממתינות');
    }
    // The bell used to be a rail item that appeared on days it had something
    // to say, which meant the navigation changed shape under you. It is one
    // button in the same corner of every screen now, and only the count moves.
    if (reminderPopOpen) renderReminderPopover();
}

let reminderPopOpen = false;

function toggleReminderPopover(e) {
    if (e) e.stopPropagation();
    reminderPopOpen ? closeReminderPopover() : openReminderPopover(e && e.currentTarget);
}

function openReminderPopover(anchor) {
    const pop = document.getElementById('reminder-pop');
    if (!pop) return;
    reminderPopOpen = true;
    pop.hidden = false;
    renderReminderPopover();
    positionReminderPopover(anchor);
    document.getElementById('reminder-bell')?.setAttribute('aria-expanded', 'true');
    setTimeout(() => {
        document.addEventListener('click', _reminderOutside);
        document.addEventListener('keydown', _reminderEsc);
        // A resize moves the bell out from under the card; closing beats
        // leaving it pointing at nothing.
        window.addEventListener('resize', closeReminderPopover, { once: true });
    }, 0);
}

function closeReminderPopover() {
    reminderPopOpen = false;
    const pop = document.getElementById('reminder-pop');
    if (pop) pop.hidden = true;
    document.getElementById('reminder-bell')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', _reminderOutside);
    document.removeEventListener('keydown', _reminderEsc);
}

function _reminderOutside(ev) {
    const pop = document.getElementById('reminder-pop');
    if (pop && !pop.contains(ev.target)) closeReminderPopover();
}
function _reminderEsc(ev) { if (ev.key === 'Escape') closeReminderPopover(); }

// Anchored under the bell on a desktop; a sheet above the nav bar on a phone,
// where there is no bell to anchor to once the bottom bar owns the button.
function positionReminderPopover(anchor) {
    const pop = document.getElementById('reminder-pop');
    if (!pop) return;
    if (window.innerWidth <= 860) {
        pop.style.top = ''; pop.style.left = ''; pop.style.right = '';
        pop.classList.add('rp-sheet');
        return;
    }
    pop.classList.remove('rp-sheet');
    const r = (anchor || document.getElementById('reminder-bell'))?.getBoundingClientRect();
    if (!r) return;
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    // Clamp to the viewport so the card never hangs off either edge.
    const w = pop.offsetWidth || 340;
    pop.style.left = Math.round(Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)) + 'px';
    pop.style.right = 'auto';
}

function renderReminderPopover() {
    const pop = document.getElementById('reminder-pop');
    if (!pop) return;
    const items = getReminderItems();
    if (items.length === 0) {
        pop.innerHTML = `<div class="rp-head">תזכורות לקוחות</div>
            <div class="rp-empty"><i class="fa-regular fa-circle-check"></i> אין למי לחזור כרגע, הכל מטופל.</div>`;
        return;
    }
    // The quote follow-ups are the Pro feature; the periodic checkups never
    // were, so a free plan still gets its checkup rows in full.
    const locked = !tierAllows('reminders');
    const followups = items.filter((i) => i.kind === 'followup');
    const shown = locked ? items.filter((i) => i.kind === 'checkup') : items;

    const rows = shown.slice(0, 8).map((i) => {
        // Ids are generated locally, but they land inside a quoted attribute —
        // the same sink that produced this project's stored-XSS bug once.
        const id = escapeHtml(i.id);
        const wa = i.phone
            ? `<button class="rp-act rp-wa" title="וואטסאפ" onclick="reminderAction('${i.kind}','${id}','wa')"><i class="fa-brands fa-whatsapp"></i></button>` : '';
        const mail = i.email
            ? `<button class="rp-act" title="מייל" onclick="reminderAction('${i.kind}','${id}','mail')"><i class="fa-solid fa-envelope"></i></button>` : '';
        return `<div class="rp-row">
            <button class="rp-main" onclick="reminderAction('${i.kind}','${id}','open')">
                <span class="rp-name">${escapeHtml(i.name)}</span>
                <span class="rp-why">${escapeHtml(i.why)}</span>
            </button>
            <span class="rp-acts">${wa}${mail}</span>
        </div>`;
    }).join('');

    const lockedRow = locked && followups.length
        ? `<button class="rp-row rp-locked" onclick="closeReminderPopover(); showUpgradeModal('reminders')">
               <i class="fa-solid fa-lock"></i>
               <span>${followups.length} ${followups.length === 1 ? 'הצעה ממתינה' : 'הצעות ממתינות'} לתשובה · מעקב הצעות במסלול Pro</span>
           </button>` : '';

    const more = shown.length > 8 ? `<div class="rp-more">+${shown.length - 8} נוספים</div>` : '';
    pop.innerHTML = `<div class="rp-head">מי מחכה לי <b>${items.length}</b></div>${lockedRow}${rows}${more}`;
}

function reminderAction(kind, id, what) {
    if (kind === 'checkup') {
        if (what === 'wa') return ckWhatsapp(id);
        if (what === 'mail') return ckMailto(id);
        closeReminderPopover();
        switchTab('checkups');
        return;
    }
    if (kind === 'maintenance') {
        // The message differs from a quote chase: this one books a visit.
        if (what === 'wa') return maintWhatsApp(id);
        if (what === 'mail') return maintEmail(id);
        closeReminderPopover();
        switchTab('projects');
        openProjectFromReminder(id);
        return;
    }
    if (what === 'wa') { followupWhatsApp(id); return; }
    if (what === 'mail') { followupEmail(id); return; }
    closeReminderPopover();
    switchTab('projects');
    openProjectFromReminder(id);
}

// ---------- follow-up reminders that survive the app being closed ----------
//
// A nudge that only renders inside ZEREM is not a reminder: on the day you
// don't open the app, it simply doesn't happen. This puts it in the calendar
// the phone already rings from: Google when signed in with Google, an ICS
// file otherwise, so iPhone and Outlook users are not left out.

function _followupWhen() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
}
function _localDateTime(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00';
}
function _followupTitle(proj) {
    const isPayment = (proj.status || '') === 'הושלם';
    // A dot, not a dash: project names carry their own dashes ("לוי: לוח"),
    // and two of them in one calendar title read as noise.
    return '⚡ לחזור ל' + (proj.name || 'לקוח') + ' · ' + (isPayment ? 'תשלום ממתין' : 'הצעה ממתינה לתשובה');
}
function _followupDesc(proj) {
    return [
        proj.clientPhone ? 'טלפון: ' + proj.clientPhone : '',
        proj.clientEmail ? 'מייל: ' + proj.clientEmail : '',
        '', _followupMessage(proj),
        '', '(נוצר אוטומטית ממעקב ההצעות של זרם)',
    ].filter((l) => l !== null).join('\n');
}

async function followupRemindMe(projectId, e) {
    if (e) e.stopPropagation();
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj) return;
    const when = _followupWhen();
    const ok = await pushReminderEvent(proj, when, _followupTitle(proj), _followupDesc(proj));
    if (ok === true) showToast('תזכורת נקבעה ביומן למחר ב-9:00');
}

// One reminder in the calendar, whatever asked for it: the follow-up button
// picks tomorrow at nine, the typed one picks whatever the sentence said. Both
// PATCH the project's existing event rather than adding a second — pressing
// "remind me" twice should move the reminder, not clone it.
//
// Returns true when the calendar took it, 'ics' when a file was downloaded
// instead (guest, no consent, or a failure), false when nothing worked.
async function pushReminderEvent(proj, when, title, desc) {
    let token = null;
    if (!isGuestUser()) {
        try { token = await ckEnsureCalToken(); } catch (err) { token = null; }
    }
    if (!token) { _followupIcs(proj, when, title); return 'ics'; }

    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Jerusalem';
    const end = new Date(when.getTime() + 30 * 60000);
    const body = JSON.stringify({
        summary: title,
        description: desc,
        start: { dateTime: _localDateTime(when), timeZone: tz },
        end: { dateTime: _localDateTime(end), timeZone: tz },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }
    });
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    try {
        let res = null;
        if (proj.followupEventId) {
            res = await fetch(base + '/' + proj.followupEventId, { method: 'PATCH', headers, body });
            if (res.status === 404 || res.status === 410) res = null; // deleted by hand, recreate
        }
        if (!res) res = await fetch(base, { method: 'POST', headers, body });
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem(CK_CAL_TOKEN_KEY);
            showToast('ההרשאה ליומן פגה · לחץ שוב על כפתור היומן', 'error');
            return false;
        }
        const ev = await res.json();
        if (!res.ok || !ev.id) throw new Error('calendar-error');
        proj.followupEventId = ev.id;
        saveProjects();
        return true;
    } catch (err) {
        // Never leave the click with nothing to show for it.
        _followupIcs(proj, when, title);
        return 'ics';
    }
}

function _followupIcs(proj, when, title) {
    const p = (n) => String(n).padStart(2, '0');
    const stamp = (d) => d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
        'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00Z';
    const end = new Date(when.getTime() + 30 * 60000);
    const summary = ckIcsText(title || _followupTitle(proj));
    // Through the one wrapper in assets/checkups-core.js: a second hand-rolled
    // VCALENDAR in the codebase is a second thing that can disagree with the
    // first about what a calendar file looks like.
    const ics = SJ_CK.icsWrap([[
        'BEGIN:VEVENT',
        'UID:fu-' + proj.id + '@sj-eng.co.il',
        'DTSTAMP:' + stamp(new Date()),
        'DTSTART:' + stamp(when),
        'DTEND:' + stamp(end),
        'SUMMARY:' + summary,
        'DESCRIPTION:' + ckIcsText(_followupDesc(proj)),
        'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:' + summary, 'END:VALARM',
        'END:VEVENT',
    ]], 'Followup');
    if (!ics) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'followup-' + String(proj.name || 'client').replace(/[^\w֐-׿-]+/g, '_') + '.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('קובץ תזכורת ירד · פתח אותו והוא ייכנס ליומן שלך');
}

// ---- "תזכיר לי" — the reminder you type instead of configure ---------------
//
// The calendar plumbing has been here since the follow-up strip: a reminder is
// an event with a title, a time and an ICS fallback for a phone with no Google
// account. What was missing was the way in. A dialog with a date picker, an
// hour picker and a subject field is four decisions for something a person
// already said in one sentence — "תזכיר לי מחר בבוקר להתקשר לדני".
//
// So the sentence IS the interface. The parser below is deliberately small and
// deterministic: no model call, no network, no waiting. It understands the ways
// a working day is actually spoken about in Hebrew, and when it does not
// understand, it says so and shows a date field rather than guessing — a
// reminder that quietly lands on the wrong day is worse than no reminder.

const HE_WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// Hebrew counts to ten in words far more often than in digits for small numbers.
const HE_NUMBERS = {
    'אחד': 1, 'אחת': 1, 'שני': 2, 'שתי': 2, 'שניים': 2, 'שתיים': 2, 'שלוש': 3, 'שלושה': 3,
    'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7,
    'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10,
};

function _heCount(word) {
    if (!word) return null;
    if (/^\d+$/.test(word)) return parseInt(word, 10);
    return HE_NUMBERS[word] || null;
}

// Returns { at: Date, what: string } — or null when the sentence carries no
// time at all, which the caller turns into a date field rather than a guess.
function parseHebrewWhen(text, now) {
    const src = String(text || '').trim();
    if (!src) return null;
    const base = now ? new Date(now) : new Date();
    let rest = src.replace(/^\s*תזכיר(?:י)?\s+לי\s*/, '').trim();
    let at = null;
    let hadDate = false;

    const take = (re) => {
        const m = re.exec(rest);
        if (m) rest = (rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
        return m;
    };
    const day = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); d.setHours(9, 0, 0, 0); return d; };

    // ── the day ──
    let m;
    if ((m = take(/מחרתיים/))) { at = day(2); hadDate = true; }
    // Not /\bמחר\b/: in JavaScript a word boundary is defined by [A-Za-z0-9_],
    // so a Hebrew word has boundaries nowhere and that pattern matches nothing
    // at all. The word is fenced by hand instead — and "מחרתיים" is taken
    // first above, so it cannot be eaten here.
    else if ((m = take(/(?:^|[^א-ת])מחר(?![א-ת])/))) { at = day(1); hadDate = true; }
    else if ((m = take(/היום/))) { at = day(0); hadDate = true; }
    // "בעוד שבועיים", "בעוד 3 ימים", "עוד חודש"
    else if ((m = take(/(?:בעוד|עוד)\s+(\d+|[֐-׿]+)?\s*(ימים|יום|שבועות|שבועיים|שבוע|חודשים|חודשיים|חודש|שעות|שעה|שעתיים)/))) {
        const word = m[1] || '';
        const unit = m[2];
        let n = _heCount(word);
        if (unit === 'שבועיים') n = 2;
        else if (unit === 'חודשיים') n = 2;
        else if (unit === 'שעתיים') n = 2;
        else if (n === null) n = 1;
        const d = new Date(base);
        if (unit === 'שעה' || unit === 'שעות' || unit === 'שעתיים') {
            d.setHours(d.getHours() + n, d.getMinutes(), 0, 0);
            at = d;
            hadDate = true;
            // An hour from now is a time, not a day — the 09:00 default below
            // must not overwrite it.
            return _finish(at, rest, src, true);
        }
        if (unit === 'שבוע' || unit === 'שבועות' || unit === 'שבועיים') d.setDate(d.getDate() + n * 7);
        else if (unit === 'חודש' || unit === 'חודשים' || unit === 'חודשיים') d.setMonth(d.getMonth() + n);
        else d.setDate(d.getDate() + n);
        d.setHours(9, 0, 0, 0);
        at = d;
        hadDate = true;
    }
    // "ביום ראשון" — the next one, and a week ahead when today already is it
    else if ((m = take(new RegExp('ב?יום\\s+(' + HE_WEEKDAYS.join('|') + ')')))) {
        const want = HE_WEEKDAYS.indexOf(m[1]);
        const d = new Date(base);
        let delta = (want - d.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        d.setDate(d.getDate() + delta);
        d.setHours(9, 0, 0, 0);
        at = d;
        hadDate = true;
    }
    // "ב-15/9", "15.9.2026", "ב 3/11"
    else if ((m = take(/ב?[-\s]?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/))) {
        const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10);
        let yy = m[3] ? parseInt(m[3], 10) : base.getFullYear();
        if (yy < 100) yy += 2000;
        const d = new Date(yy, mm - 1, dd, 9, 0, 0, 0);
        // A date already past, written without a year, means next year.
        if (!m[3] && d < base) d.setFullYear(d.getFullYear() + 1);
        if (!isNaN(d.getTime())) { at = d; hadDate = true; }
    }

    if (!hadDate) return null;

    // ── the hour, if he said one ──
    const t = take(/(?:בשעה|ב)[-\s]?(\d{1,2})(?::(\d{2}))?\b/);
    if (t) {
        at.setHours(parseInt(t[1], 10), t[2] ? parseInt(t[2], 10) : 0, 0, 0);
    } else if (take(/בבוקר/)) at.setHours(9, 0, 0, 0);
    else if (take(/בצהריים/)) at.setHours(12, 0, 0, 0);
    else if (take(/אחה"?צ|אחר\s*הצהריים/)) at.setHours(15, 0, 0, 0);
    else if (take(/בערב/)) at.setHours(18, 0, 0, 0);

    return _finish(at, rest, src, false);
}

function _finish(at, rest, src, keepRest) {
    // No stripping of a leading ל: in "מחר להתקשר לדני" that lamed is half the
    // verb, and removing it turns an infinitive into an order — "התקשר לדני",
    // which is not how he wrote it and not how it should read back to him.
    let what = String(rest || '').replace(/^\s*תזכיר\s+לי\s*/, '').replace(/\s+/g, ' ').trim();
    // Leftovers like "ב" or "-" are not a subject.
    if (what.length < 2) what = '';
    return { at: at, what: what, said: src };
}

// The dialog: one field, and an honest fallback when the sentence had no date
// in it at all.
function openRemindDialog(projectId, e) {
    if (e) e.stopPropagation();
    const proj = projectsList.find((p) => p.id === projectId);
    if (!proj) return;
    _remindFor = projectId;
    const dlg = document.getElementById('remind-dialog');
    if (!dlg) return;
    const input = document.getElementById('remind-text');
    if (input) { input.value = ''; input.placeholder = 'למשל: מחר בבוקר להתקשר ל' + (projectClient(proj) || {}).name || 'לקוח'; }
    const note = document.getElementById('remind-note');
    if (note) { note.textContent = 'על ' + (proj.name || 'העבודה') + ' · נכנס ליומן Google, ובלי חשבון יורד כקובץ.'; }
    const fb = document.getElementById('remind-fallback');
    if (fb) fb.hidden = true;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    setTimeout(() => { try { input.focus(); } catch (err) {} }, 50);
}

function closeRemindDialog() {
    const dlg = document.getElementById('remind-dialog');
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}

let _remindFor = null;

async function remindMeSubmit() {
    const proj = projectsList.find((p) => p.id === _remindFor);
    if (!proj) return;
    const text = (document.getElementById('remind-text') || {}).value || '';
    const parsed = parseHebrewWhen(text);
    if (!parsed) {
        // Not understood → ask for the date outright rather than book a guess.
        const fb = document.getElementById('remind-fallback');
        if (fb) {
            fb.hidden = false;
            const d = document.getElementById('remind-date');
            if (d && !d.value) {
                const t = new Date(); t.setDate(t.getDate() + 1);
                d.value = t.toISOString().slice(0, 10);
            }
        }
        showToast('לא זיהיתי מתי · בחר תאריך למטה, או כתוב "מחר בבוקר"', 'error');
        return;
    }
    await remindMeBook(proj, parsed.at, parsed.what);
}

async function remindMeFromDate() {
    const proj = projectsList.find((p) => p.id === _remindFor);
    if (!proj) return;
    const d = (document.getElementById('remind-date') || {}).value;
    const h = (document.getElementById('remind-hour') || {}).value || '09:00';
    if (!d) { showToast('בחר תאריך', 'error'); return; }
    const at = new Date(d + 'T' + h + ':00');
    if (isNaN(at.getTime())) { showToast('תאריך לא תקין', 'error'); return; }
    const what = ((document.getElementById('remind-text') || {}).value || '').trim();
    await remindMeBook(proj, at, what);
}

// One reminder, through the same upsert the follow-up button uses — so a second
// "remind me" on the same project moves the event instead of adding a twin.
async function remindMeBook(proj, at, what) {
    const title = what ? what + ' · ' + (proj.name || '') : _followupTitle(proj);
    closeRemindDialog();
    const ok = await pushReminderEvent(proj, at, title, _followupDesc(proj));
    if (ok === 'ics') { showToast('ירד קובץ יומן · פתח אותו והתזכורת תיכנס'); return; }
    if (!ok) { showToast('קביעת התזכורת נכשלה, נסה שוב', 'error'); return; }
    proj.reminderAt = at.getTime();
    saveProjects();
    filterProjectsList();
    showToast('נקבעה תזכורת ל-' + at.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
}

function renderProjectsList(list) {
    if (!list) list = projectsList;
    // The home's "continue where you left off" reads the same list, and the
    // cloud pull can land after the first paint.
    try { if (document.getElementById('home-recent')) renderHome(); } catch (e) {}
    const container = document.getElementById('projects-list-container');
    if (!container) return;

    container.innerHTML = '';

    if (projectsList.length === 0) {
        // This said "צור פרויקט חדש מימין". The box is above the list, not to
        // the right: it has been for a while, and the sentence went stale
        // without anyone noticing because it is only ever seen once, by
        // someone with nothing to compare it to. A button cannot point the
        // wrong way, and it works the same on a phone as on a desktop.
        container.innerHTML = `
            <div class="projects-empty">
                <i class="fa-solid fa-bolt" aria-hidden="true"></i>
                <p class="pe-title">עוד אין פרויקטים</p>
                <p class="pe-sub">כל עבודה מתחילה בתיאור במילים שלך, ומשם זרם בונה את האפיון.</p>
                <button type="button" class="btn btn-accent" onclick="startFirstProject()">
                    <i class="fa-solid fa-plus"></i> פרויקט חדש
                </button>
            </div>`;
        return;
    }
    if (list.length === 0) {
        container.innerHTML = `<div class="projects-empty"><p class="pe-sub">לא נמצאו פרויקטים התואמים לחיפוש.</p></div>`;
        return;
    }

    // Stale drafts leave the main list and go to the shelf at the bottom. A
    // search or a filter is a deliberate hunt, so nothing is hidden then.
    const hunting = !!(document.getElementById('project-search-q')?.value || '').trim()
        || (document.getElementById('project-status-filter')?.value || 'all') !== 'all'
        || !!activeCategoryFilter || repeatFilterOn;
    const stale = hunting ? [] : list.filter(isStaleDraft);
    const staleIds = new Set(stale.map(p => p.id));
    if (stale.length) list = list.filter(p => !staleIds.has(p.id));

    const cats = getProjectCategories();

    list.forEach(p => {
        const isActive = p.id === activeProjectId;
        const status = p.status || 'טיוטה';
        const stage = getProjectStage(p);
        const so = STAGE_ORDER[stage] || 0;
        // Displayed steps are two; stored stages are still three. planning and
        // pricing are the same conversation, so they share step 0, and "draft"
        // (index 2) is the quote itself.
        const shown = so >= 2 ? 2 : 0;
        const stepCls = (i) => i < shown ? 'done' : (i === shown ? 'current' : 'locked');
        const card = document.createElement('div');
        card.className = `project-card ${isActive ? 'active' : ''}`;
        card.onclick = () => loadProject(p.id);

        // An auto-named work is still called "פרויקט חדש" until the agent titles
        // it, which is unreadable on a list of them: show the opening sentence.
        const cardTitle = (p.autoName && p.name === 'פרויקט חדש') ? draftPreview(p) : p.name;
        card.innerHTML = `
            <button type="button" class="card-more" aria-label="עוד פעולות" aria-expanded="false"
                    onclick="toggleProjectCard(this, event)">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
            </button>
            <div class="project-info">
                <div class="project-title">${escapeHtml(cardTitle)}</div>
                <div class="project-meta">
                    <span><i class="fa-solid fa-calendar"></i> ${formatHebrewDate(p.created)}</span>
                    ${p.approvedAt ? `<span class="approved-badge" title="${escapeHtml('אושרה בקישור' + (p.approvedBy ? ' על ידי ' + p.approvedBy : ''))}"><i class="fa-solid fa-circle-check"></i> אושרה על ידי הלקוח</span>` : ''}
                    ${maintBadgeHtml(p)}
                    <button type="button" class="proj-cat-chip ${p.category ? 'has-cat' : ''}"
                            onclick="event.stopPropagation(); openCategoryPicker('${p.id}')" title="שיוך לקטגוריה">
                        <i class="fa-solid fa-tag"></i>
                        <span>${escapeHtml(p.category || 'ללא קטגוריה')}</span>
                    </button>
                    <button type="button" class="proj-cat-chip proj-client-chip ${p.clientId ? 'has-cat' : ''}"
                            onclick="event.stopPropagation(); openClientPicker('${p.id}')" title="שיוך ללקוח">
                        <i class="fa-solid fa-user"></i>
                        <span>${escapeHtml(projectClient(p)?.name || 'ללא לקוח')}</span>
                    </button>
                </div>
            </div>
            <div class="stage-chain" title="שלבי העבודה">
                <button class="stage-step ${stepCls(0)}" onclick="openProjectStage('${p.id}','plan',event)">
                    <i class="fa-solid fa-compass-drafting"></i> אפיון ותמחור
                </button>
                <span class="stage-arrow">←</span>
                <button class="stage-step ${stepCls(2)}" onclick="openProjectStage('${p.id}','draft',event)">
                    <i class="fa-solid fa-file-invoice-dollar"></i> הצעת מחיר
                </button>
            </div>
            <div class="project-endcap">
                <span class="project-status-badge row-status status-badge-${status}"
                      onclick="cycleProjectStatus('${p.id}', event)"
                      title="לחץ לשינוי סטטוס">${status}</span>
                <button class="btn btn-secondary btn-small" onclick="openRemindDialog('${p.id}', event)" title="תזכיר לי · בשפה חופשית" aria-label="תזכיר לי">
                    <i class="fa-regular fa-clock" aria-hidden="true"></i>
                </button>
                <button class="btn btn-danger btn-small" onclick="deleteProject('${p.id}', event)" title="העברה לסל המיחזור" aria-label="העברה לסל המיחזור">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
            </div>
        `;
        container.appendChild(card);
    });

    if (stale.length) {
        if (!list.length) {
            const note = document.createElement('p');
            note.className = 'input-help';
            note.style.cssText = 'text-align:center;padding:16px 0 0;';
            note.textContent = 'כל מה שפתוח כרגע הוא טיוטות שנעצרו. פתח אחת מהן, או התחל עבודה חדשה מהבית.';
            container.appendChild(note);
        }
        const shelf = document.createElement('div');
        shelf.innerHTML = staleDraftsHtml(stale);
        container.appendChild(shelf.firstElementChild);
    }
}

// ==========================================================================
// Periodic service (שירות תקופתי) — clients due for recurring inspections.
// Reminders are delegated to the calendar (no server cron): a recurring
// Google Calendar event with email/popup alerts, or a downloadable ICS for
// iPhone/Apple Calendar. Shares data with the standalone /checkups/ page:
// same /api/checkups backend and record shape, so both stay in sync per
// Google account.
// ==========================================================================

const CK_CAL_TOKEN_KEY = 'sj_checkups_cal_token';
const CK_SOON_DAYS = 60;

let ckClients = [];
let ckLoaded = false;
let ckCloudPulled = false;
let ckEditingId = null;
let ckSaveTimer = null;

function ckStorageKey() { return getStorageKey('sj_checkups_v1'); }

function renderCheckups() {
    if (!ckLoaded) {
        try { ckClients = JSON.parse(localStorage.getItem(ckStorageKey()) || '[]'); } catch { ckClients = []; }
        if (!Array.isArray(ckClients)) ckClients = [];
        ckLoaded = true;
    }
    ckRender();
    if (!ckCloudPulled) ckCloudLoad();
}

// ---------- dates ----------

// The dates, the recurrence rule and the .ics file are shared with the
// standalone /checkups/ tracker (assets/checkups-core.js). They were two copies
// of the same nine functions until a fix in the 08/08 review had to be applied
// twice by hand — and two copies that can disagree about when a checkup is due
// is a missed visit. The screens keep their own words and their own rendering.
function ckToday() { return SJ_CK.today(); }
function ckPad(n) { return SJ_CK.pad(n); }
function ckAddMonths(dateStr, months) { return SJ_CK.addMonths(dateStr, months); }
function ckAddDays(dateStr, n) { return SJ_CK.addDays(dateStr, n); }
function ckNextDue(c) { return SJ_CK.nextDue(c); }
function ckDaysUntil(dateStr) { return SJ_CK.daysUntil(dateStr); }
function ckFmtDate(dateStr) { return SJ_CK.fmtDate(dateStr); }
function ckIntervalLabel(months) { return SJ_CK.intervalLabel(months); }
function ckStatusOf(c) { return SJ_CK.statusOf(c, CK_SOON_DAYS); }

// ---------- rendering ----------

function ckRender() {
    const listEl = document.getElementById('ck-list');
    if (!listEl) return;
    const q = (document.getElementById('ck-search')?.value || '').trim().toLowerCase();

    const visible = ckLive().filter((c) =>
        !q || [c.name, c.phone, c.site, c.type].some((v) => (v || '').toLowerCase().includes(q)));

    // Most urgent first: missing dates, then by due date ascending.
    visible.sort((a, b) => {
        const da = ckNextDue(a), db = ckNextDue(b);
        if (!da && !db) return (a.name || '').localeCompare(b.name || '');
        if (!da) return -1;
        if (!db) return 1;
        return da.localeCompare(db);
    });

    const counts = { overdue: 0, soon: 0, ok: 0, missing: 0 };
    ckLive().forEach((c) => counts[ckStatusOf(c)]++);
    const statsEl = document.getElementById('ck-stats');
    if (statsEl) statsEl.innerHTML = `
        <div class="ck-stat"><b>${ckLive().length}</b><span>לקוחות במעקב</span></div>
        <div class="ck-stat ck-red"><b>${counts.overdue + counts.missing}</b><span>באיחור / חסר תאריך</span></div>
        <div class="ck-stat ck-amber"><b>${counts.soon}</b><span>קרובים (${CK_SOON_DAYS} יום)</span></div>
        <div class="ck-stat ck-green"><b>${counts.ok}</b><span>בסדר</span></div>`;

    ckRenderDueStrip();

    if (visible.length === 0) {
        listEl.innerHTML = `<div class="ck-empty">${ckLive().length === 0
            ? 'אין עדיין לקוחות במעקב.<br>הוסף לקוח ראשון או ייבא רשימה מאקסל.'
            : 'לא נמצאו תוצאות לחיפוש.'}</div>`;
        return;
    }

    listEl.innerHTML = visible.map((c) => {
        const due = ckNextDue(c);
        const st = ckStatusOf(c);
        const dotCls = st === 'overdue' || st === 'missing' ? 'ck-red' : st === 'soon' ? 'ck-amber' : 'ck-green';
        let dueHtml;
        if (!due) {
            dueHtml = '<b class="ck-due-overdue">חסר תאריך</b><small>קבע מועד בדיקה</small>';
        } else {
            const days = ckDaysUntil(due);
            const label = days < 0 ? 'באיחור של ' + Math.abs(days) + ' יום'
                : days === 0 ? 'היום!' : 'בעוד ' + days + ' יום';
            const cls = st === 'overdue' ? 'ck-due-overdue' : st === 'soon' ? 'ck-due-soon' : '';
            dueHtml = `<b class="${cls}">${ckFmtDate(due)}</b><small>${label}</small>`;
        }
        return `
        <div class="ck-row">
            <div class="ck-dot ${dotCls}"></div>
            <div class="ck-name">${escapeHtml(c.name)}<small>${escapeHtml([c.type, c.site].filter(Boolean).join(' · '))}</small></div>
            <div class="ck-interval">${ckIntervalLabel(c.months)}${c.last ? `<br><small>אחרונה: ${ckFmtDate(c.last)}</small>` : ''}</div>
            <div class="ck-due">${dueHtml}</div>
            <div class="ck-actions">
                <button class="ck-icon-btn ${c.eventId ? 'ck-synced' : ''}" title="${c.eventId ? 'מסונכרן ליומן Google · לחץ לעדכון' : 'הוסף תזכורת ליומן Google'}" onclick="ckSyncCalendar('${c.id}')"><i class="fa-solid fa-calendar-plus"></i></button>
                <button class="ck-icon-btn" title="הורדת תזכורת לאייפון / Apple Calendar (קובץ ICS)" onclick="ckDownloadIcs('${c.id}')"><i class="fa-solid fa-download"></i></button>
                ${c.phone ? `<button class="ck-icon-btn ck-wa" title="וואטסאפ ללקוח" onclick="ckWhatsapp('${c.id}')"><i class="fa-brands fa-whatsapp"></i></button>` : ''}
                ${c.email ? `<button class="ck-icon-btn" title="טיוטת מייל ללקוח" onclick="ckMailto('${c.id}')"><i class="fa-solid fa-envelope"></i></button>` : ''}
                <button class="ck-icon-btn" title="צור הצעת מחיר ללקוח (אחרי שאישר)" onclick="ckCreateQuote('${c.id}')"><i class="fa-solid fa-file-invoice-dollar"></i></button>
                <button class="ck-icon-btn" title="הבדיקה בוצעה · קדם לתאריך הבא" onclick="ckMarkDone('${c.id}')"><i class="fa-solid fa-check"></i></button>
                <button class="ck-icon-btn" title="עריכה" onclick="ckOpenEditor('${c.id}')"><i class="fa-solid fa-pen"></i></button>
                <button class="ck-icon-btn ck-danger" title="מחיקה" onclick="ckRemoveClient('${c.id}')"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>`;
    }).join('');
}

// ---------- CRUD ----------

function ckOpenEditor(id) {
    ckEditingId = id || null;
    const c = ckClients.find((x) => x.id === id) || {};
    document.getElementById('ck-editor-title').textContent = id ? 'עריכת לקוח' : 'לקוח חדש';
    document.getElementById('ck-f-name').value = c.name || '';
    document.getElementById('ck-f-phone').value = c.phone || '';
    document.getElementById('ck-f-email').value = c.email || '';
    document.getElementById('ck-f-type').value = c.type || 'בדיקה תקופתית';
    document.getElementById('ck-f-site').value = c.site || '';
    const months = c.months || 12;
    const preset = [12, 24, 36, 60].includes(months);
    document.getElementById('ck-f-months').value = preset ? String(months) : 'custom';
    document.getElementById('ck-f-custom-wrap').style.display = preset ? 'none' : '';
    document.getElementById('ck-f-custom').value = preset ? 6 : months;
    document.getElementById('ck-f-last').value = c.last || '';
    document.getElementById('ck-f-next').value = c.next || '';
    document.getElementById('ck-f-notes').value = c.notes || '';
    document.getElementById('ck-editor').showModal();
}

function ckSaveClient(ev) {
    ev.preventDefault();
    const monthsSel = document.getElementById('ck-f-months').value;
    const months = monthsSel === 'custom'
        ? Math.max(1, Math.min(120, parseInt(document.getElementById('ck-f-custom').value, 10) || 12))
        : parseInt(monthsSel, 10);
    const rec = {
        name: document.getElementById('ck-f-name').value.trim(),
        phone: document.getElementById('ck-f-phone').value.trim(),
        email: document.getElementById('ck-f-email').value.trim(),
        type: document.getElementById('ck-f-type').value,
        site: document.getElementById('ck-f-site').value.trim(),
        months,
        last: document.getElementById('ck-f-last').value || null,
        next: document.getElementById('ck-f-next').value || null,
        notes: document.getElementById('ck-f-notes').value.trim(),
        updatedAt: Date.now()
    };
    if (!rec.name) return;
    if (ckEditingId) {
        const c = ckClients.find((x) => x.id === ckEditingId);
        if (c) Object.assign(c, rec);
    } else {
        ckClients.push({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 7), eventId: null, ...rec });
    }
    document.getElementById('ck-editor').close();
    ckPersist();
    ckRender();
}

function ckMarkDone(id) {
    const c = ckClients.find((x) => x.id === id);
    if (!c) return;
    c.last = ckToday();
    c.next = null; // back to computed: today + interval
    c.updatedAt = Date.now();
    ckPersist();
    ckRender();
    showToast('עודכן · הבדיקה הבאה: ' + ckFmtDate(ckNextDue(c)) +
        (c.eventId ? '. כדאי לעדכן גם את היומן (כפתור היומן בשורה)' : ''));
}

async function ckRemoveClient(id) {
    const c = ckClients.find((x) => x.id === id);
    if (!c) return;
    if (!await askConfirm({ title: 'להסיר מהמעקב?', body: `"${c.name}" לא יופיע עוד בשירות התקופתי.`, confirmLabel: 'הסר', danger: true })) return;
    const eventId = c.eventId;
    // Tombstone, not removal: the record stays (hidden) so the deletion wins
    // the union-merge on every other device instead of being resurrected.
    c.deleted = Date.now();
    c.updatedAt = Date.now();
    ckPersist();
    ckRender();
    if (eventId && confirm('למחוק גם את התזכורת מיומן Google?')) {
        ckEnsureCalToken().then((token) =>
            fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/' + eventId, {
                method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
            })
        ).then(() => showToast('התזכורת נמחקה מהיומן')).catch(() => showToast('מחיקת האירוע מהיומן נכשלה', 'error'));
    }
}

// ---------- persistence: local + cloud (/api/checkups) ----------

function ckLive() { return ckClients.filter((c) => !c.deleted); }

function ckPersist() {
    // Purge tombstones after 90 days — by then every device has synced.
    const cutoff = Date.now() - 90 * 86400000;
    ckClients = ckClients.filter((c) => !c.deleted || c.deleted > cutoff);
    localStorage.setItem(ckStorageKey(), JSON.stringify(ckClients));
    try { renderReminderBell(); } catch (e) { /* bell is an add-on, never fatal */ }
    if (isGuestUser() || !googleAccessToken) return;
    clearTimeout(ckSaveTimer);
    ckSaveTimer = setTimeout(ckCloudSave, 1500);
}

async function ckCloudSave() {
    if (isGuestUser() || !googleAccessToken) return;
    try {
        await fetch('/api/checkups', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + googleAccessToken },
            body: JSON.stringify({ data: { clients: ckClients } })
        });
    } catch { /* offline — local copy is intact, next change retries */ }
}

async function ckCloudLoad() {
    if (isGuestUser() || !googleAccessToken) return;
    ckCloudPulled = true;
    try {
        const res = await fetch('/api/checkups', { headers: { Authorization: 'Bearer ' + googleAccessToken } });
        if (!res.ok) return;
        const body = await res.json();
        const cloud = body && body.data && Array.isArray(body.data.clients) ? body.data.clients : [];
        // Union-merge by id, newer updatedAt wins — devices (and the standalone
        // /checkups/ page) converge.
        const byId = new Map(ckClients.map((c) => [c.id, c]));
        for (const cc of cloud) {
            const local = byId.get(cc.id);
            if (!local || (cc.updatedAt || 0) > (local.updatedAt || 0)) byId.set(cc.id, cc);
        }
        ckClients = [...byId.values()];
        localStorage.setItem(ckStorageKey(), JSON.stringify(ckClients));
        ckRender();
        try { renderReminderBell(); } catch (e) {}
        ckCloudSave();
    } catch { /* offline */ }
}

// ---------- Google Calendar reminders ----------

// A calendar-scoped token is minted only when actually adding a reminder, so
// the everyday sign-in keeps its minimal scopes.
function ckEnsureCalToken() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CK_CAL_TOKEN_KEY) || 'null'); } catch {}
    if (saved && saved.token && saved.exp > Date.now() + 60000) return Promise.resolve(saved.token);
    return new Promise((resolve, reject) => {
        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            reject(new Error('gsi-not-loaded')); return;
        }
        const tc = google.accounts.oauth2.initTokenClient({
            client_id: localStorage.getItem('sj_global_google_client_id'),
            scope: 'https://www.googleapis.com/auth/calendar.events',
            callback: (resp) => {
                if (resp && resp.access_token) {
                    localStorage.setItem(CK_CAL_TOKEN_KEY, JSON.stringify({
                        token: resp.access_token,
                        exp: Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000
                    }));
                    resolve(resp.access_token);
                } else reject(new Error('no-token'));
            },
            error_callback: () => reject(new Error('denied'))
        });
        tc.requestAccessToken({ prompt: '' });
    });
}

function ckRrule(months) { return SJ_CK.rrule(months); }

function ckEventBody(c) {
    return SJ_CK.eventBody(c, '(נוצר אוטומטית מהשירות התקופתי של זרם)');
}

async function ckSyncCalendar(id) {
    const c = ckClients.find((x) => x.id === id);
    if (!c) return;
    if (!ckNextDue(c)) { showToast('קודם קבע תאריך בדיקה (כפתור העריכה)', 'error'); return; }
    if (isGuestUser()) { showToast('תזכורות יומן דורשות התחברות עם Google', 'error'); return; }
    let token;
    try { token = await ckEnsureCalToken(); }
    catch { showToast('נדרש אישור גישה ליומן Google', 'error'); return; }

    const res = await ckPushToGoogle(c, token);
    if (res.ok) {
        ckPersist();
        ckRender();
        showToast('תזכורת חוזרת נקבעה ביומן Google (' + ckFmtDate(ckNextDue(c)) + ')');
        return;
    }
    if (res.reason === 'auth') { showToast('ההרשאה ליומן פגה · לחץ שוב על כפתור היומן', 'error'); return; }
    showToast('הוספת התזכורת ליומן נכשלה, נסה שוב', 'error');
}

// The same upsert without the UI around it, so the bulk runner can call it in a
// loop. Patches the existing event when there is one and falls back to creating
// it when the user deleted it by hand — which is what keeps a repeat run from
// leaving two of the same visit in the calendar.
async function ckPushToGoogle(c, token) {
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const body = JSON.stringify(ckEventBody(c));
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    try {
        let res = null;
        if (c.eventId) {
            res = await fetch(base + '/' + c.eventId, { method: 'PATCH', headers, body });
            if (res.status === 404 || res.status === 410) res = null; // event deleted by hand — recreate
        }
        if (!res) res = await fetch(base, { method: 'POST', headers, body });
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem(CK_CAL_TOKEN_KEY);
            return { ok: false, reason: 'auth', eventId: null };
        }
        const ev = await res.json();
        if (!res.ok || !ev.id) return { ok: false, reason: 'error', eventId: null };
        c.eventId = ev.id;
        c.updatedAt = Date.now();
        return { ok: true, reason: '', eventId: ev.id };
    } catch (e) {
        return { ok: false, reason: 'error', eventId: null };
    }
}

// ---------- ICS (iPhone / Apple Calendar / Outlook) ----------

// RFC 5545 TEXT escaping — raw newlines/commas/semicolons in a property value
// make the whole file unparseable for Apple Calendar/Outlook.
function ckIcsText(s) { return SJ_CK.icsText(s); }

function ckDownloadIcs(id) {
    const c = ckClients.find((x) => x.id === id);
    if (!c) return;
    const due = ckNextDue(c);
    if (!due) { showToast('קודם קבע תאריך בדיקה (כפתור העריכה)', 'error'); return; }
    const ics = SJ_CK.icsFile(c);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'checkup-' + (c.name || 'client').replace(/[^\w֐-׿-]+/g, '_') + '.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('באייפון: פתח את הקובץ והוא ייכנס ליומן עם התראות');
}

// ── "הוסף הכל ליומן" — the periodic service, in one pass ──────────────────
//
// Two lists feed one queue: maintenance that lives on a project, and the older
// standalone client list. To the person holding the phone they are the same
// job, so the button treats them as one.
//
// What "everything" deliberately means: what is inside its reminder window AND
// is not in the calendar yet. Next year's visit in the calendar today turns the
// calendar into noise, and re-pushing a record that already carries an event id
// is exactly how you end up with two of everything. Refreshing a date that
// changed stays the job of the per-row button, on purpose.

let _pdueCancel = false;

function pdueQueue() {
    const out = [];
    try {
        (projectsList || []).forEach((p) => {
            if (!projectRepeats(p) || !maintIsDue(p)) return;
            if (((p.maintenance || {}).eventIds || []).length) return;   // already in the calendar
            const blocks = maintBlocks(p);
            if (!blocks.length) return;
            out.push({ kind: 'maintenance', id: p.id, name: p.name || 'תחזוקה', due: maintNextDue(p), events: blocks.length });
        });
    } catch (e) { /* projects not loaded yet */ }
    try {
        ckEnsureLocal();
        ckDueSoonClients().forEach((c) => {
            if (c.eventId) return;
            out.push({ kind: 'checkup', id: c.id, name: c.name || 'לקוח', due: ckNextDue(c), events: 1 });
        });
    } catch (e) { /* checkups not available */ }
    return out.sort((a, b) => String(a.due).localeCompare(String(b.due)));
}

function pdueReasonText(reason) {
    return reason === 'auth' ? 'ההרשאה ליומן פגה'
        : reason === 'skipped' ? 'לא נוסה, ההרשאה פגה לפני כן'
        : reason === 'cancelled' ? 'בוטל'
        : reason === 'missing' ? 'הרשומה כבר לא קיימת'
        : reason === 'noblocks' ? 'לא נבחרו תזכורות'
        // A failure on the way back from Google is not proof that nothing was
        // created there, and telling him it failed would send him to press it
        // again and book the visit twice.
        : 'שגיאה מול היומן · ייתכן שכן נוצר, שווה לבדוק';
}

function pdueBulkOpen() {
    const list = pdueQueue();
    if (!list.length) { showToast('אין מה להוסיף · כל מה שקרוב כבר ביומן'); return; }
    const dlg = document.getElementById('pdue-bulk');
    const body = document.getElementById('pdue-bulk-body');
    const foot = document.getElementById('pdue-bulk-foot');
    if (!dlg || !body || !foot) return;
    const events = list.reduce((n, x) => n + x.events, 0);
    const prog = document.getElementById('pdue-progress');
    if (prog) { prog.hidden = true; prog.textContent = ''; }
    // The count of EVENTS, not of jobs: a job with two early warnings puts two
    // things in the calendar, and that is the number worth agreeing to.
    body.innerHTML = `
        <p class="pdue-sum">${heNum(list.length)} עבודות ← <b>${heNum(events)}</b> אירועים ביומן</p>
        <ul class="pdue-list">${list.map((x) => `
            <li><span class="pdue-li-name">${escapeHtml(x.name)}</span>
                <span class="pdue-li-when">${escapeHtml(ckFmtDate(x.due))}${x.events > 1 ? ' · ' + x.events + ' תזכורות' : ''}</span></li>`).join('')}
        </ul>
        <p class="pdue-note">מה שכבר יושב ביומן לא נוגעים בו. עבודה שהמועד שלה רחוק תיכנס כשתתקרב.</p>`;
    foot.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="pdueClose()">ביטול</button>
        <button type="button" class="btn btn-accent" onclick="pdueStart()"><i class="fa-regular fa-calendar-plus"></i> הוסף ${heNum(events)} ליומן</button>`;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

function pdueClose() {
    const dlg = document.getElementById('pdue-bulk');
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}

function pdueCancel() { _pdueCancel = true; }

function pdueStart() { return pdueRun(pdueQueue()); }

function pdueProgress(done, total, name) {
    const el = document.getElementById('pdue-progress');
    if (!el) return;
    el.hidden = false;
    el.textContent = `מוסיף ${done} מתוך ${total} · ${name}`;
}

async function pdueRun(list) {
    _pdueCancel = false;
    if (!list || !list.length) return;
    const events = list.reduce((n, x) => n + (x.events || 1), 0);
    // A number this size is almost always a mistake, and it is not recoverable
    // by pressing undo — there is no undo for ninety calendar events.
    if (events > 100) { showToast('יותר מ-100 אירועים בבת אחת · עדיף לחלק לכמה פעמים', 'error'); return; }
    if (events > 25 && !confirm('זה ייצור ' + events + ' אירועים ביומן שלך. להמשיך?')) return;
    if (isGuestUser()) { showToast('בלי חשבון Google — מוריד קובץ אחד עם הכל'); return pdueBulkIcs(list); }

    // ONE consent for the whole run. Google's popup flow only survives inside
    // the click that opened it, so a token minted in the middle of a loop is a
    // popup the browser blocks and a run that dies halfway with no explanation.
    let token;
    try { token = await ckEnsureCalToken(); }
    catch { showToast('אין הרשאה ליומן · מוריד קובץ אחד עם הכל'); return pdueBulkIcs(list); }

    const foot = document.getElementById('pdue-bulk-foot');
    if (foot) foot.innerHTML = '<button type="button" class="btn btn-secondary" onclick="pdueCancel()">עצור</button>';

    const results = [];
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (_pdueCancel) { results.push({ item: item, ok: false, reason: 'cancelled' }); continue; }
        pdueProgress(i + 1, list.length, item.name);
        let r;
        if (item.kind === 'maintenance') {
            const proj = (projectsList || []).find((p) => p.id === item.id);
            r = proj ? await maintPushToGoogle(proj, token) : { ok: false, reason: 'missing' };
        } else {
            const c = (typeof ckClients !== 'undefined' ? ckClients : []).find((x) => x.id === item.id);
            r = c ? await ckPushToGoogle(c, token) : { ok: false, reason: 'missing' };
        }
        results.push({ item: item, ok: !!r.ok, reason: r.reason || '' });
        if (r.reason === 'auth') {
            // The hour lapsed mid-run. Everything after this was never tried,
            // and saying "failed" about work that never happened is a lie he
            // would act on.
            for (let j = i + 1; j < list.length; j++) results.push({ item: list[j], ok: false, reason: 'skipped' });
            break;
        }
    }

    // One write for the whole run. Persisting per item would hit KV's
    // one-write-per-second ceiling and spend the daily budget on a single click.
    try { ckPersist(); } catch (e) {}
    try { saveProjects(); } catch (e) {}
    try { filterProjectsList(); } catch (e) {}
    try { renderMaintDueStrip(); } catch (e) {}
    pdueRenderResult(results);
}

function pdueRenderResult(results) {
    const body = document.getElementById('pdue-bulk-body');
    const foot = document.getElementById('pdue-bulk-foot');
    const prog = document.getElementById('pdue-progress');
    if (prog) prog.hidden = true;
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    if (body) {
        body.innerHTML = `
            ${ok.length ? `<p class="pdue-sum pdue-ok">נוספו ליומן (${heNum(ok.length)})</p>
                <ul class="pdue-list">${ok.map((r) => `<li><span class="pdue-li-name">${escapeHtml(r.item.name)}</span>
                    <span class="pdue-li-when">${escapeHtml(ckFmtDate(r.item.due))}</span></li>`).join('')}</ul>` : ''}
            ${bad.length ? `<p class="pdue-sum pdue-fail">לא נוספו (${heNum(bad.length)})</p>
                <ul class="pdue-list">${bad.map((r) => `<li><span class="pdue-li-name">${escapeHtml(r.item.name)}</span>
                    <span class="pdue-li-why">${escapeHtml(pdueReasonText(r.reason))}</span></li>`).join('')}</ul>` : ''}`;
    }
    if (foot) {
        // Retry offers only the ones that were never tried or plainly failed —
        // never the ones that may already be sitting in the calendar.
        const retry = bad.filter((r) => r.reason === 'skipped' || r.reason === 'cancelled' || r.reason === 'auth').map((r) => r.item);
        foot.innerHTML = `
            ${retry.length ? `<button type="button" class="btn btn-secondary" onclick="pdueRetry()">נסה שוב את ${heNum(retry.length)} שלא נוסו</button>` : ''}
            <button type="button" class="btn btn-accent" onclick="pdueClose()">סגור</button>`;
        _pdueRetry = retry;
    }
    if (ok.length && !bad.length) showToast('נוספו ' + ok.length + ' ליומן');
}

let _pdueRetry = [];
function pdueRetry() { return pdueRun(_pdueRetry.slice()); }

// No Google account, or consent refused: the whole queue as ONE calendar file,
// which every phone can open. Two event shapes live in it (all-day recurring
// checkups and 09:00 maintenance blocks) — valid, and the file says "Periodic"
// rather than pretending to be one of them.
function pdueBulkIcs(list) {
    const parts = [];
    (list || []).forEach((item) => {
        if (item.kind === 'maintenance') {
            const proj = (projectsList || []).find((p) => p.id === item.id);
            if (proj) parts.push(maintIcsVevent(proj));
        } else {
            const c = (typeof ckClients !== 'undefined' ? ckClients : []).find((x) => x.id === item.id);
            if (c) parts.push(SJ_CK.icsVevent(c));
        }
    });
    const ics = SJ_CK.icsWrap(parts, 'Periodic');
    if (!ics) { showToast('אין מה לייצא', 'error'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'periodic-service.ics';
    a.click();
    URL.revokeObjectURL(a.href);
    pdueClose();
    showToast('ירד קובץ אחד עם ' + (list || []).length + ' תזכורות · פותחים אותו והיומן קולט הכל');
}

// ---------- WhatsApp ----------

function ckWhatsapp(id) {
    const c = ckClients.find((x) => x.id === id);
    if (!c || !c.phone) return;
    let digits = c.phone.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '972' + digits.slice(1);
    const due = ckNextDue(c);
    const biz = (appState.settings && appState.settings.businessName) || '';
    const msg = 'שלום, ' + (biz ? 'כאן ' + biz + '. ' : '') + 'מתקרב מועד הבדיקה התקופתית למתקן החשמל אצלכם' +
        (due ? ' (' + ckFmtDate(due) + ')' : '') + ' · אשמח שנתאם מועד שנוח לכם.';
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(msg), '_blank');
}

// ---------- Excel import / CSV export ----------

function ckOpenImport() { document.getElementById('ck-importer').showModal(); }

function ckRunImport() {
    const text = document.getElementById('ck-import-text').value.trim();
    if (!text) return;
    let added = 0, skipped = 0;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        // Excel pastes tab-separated; a hand-typed line may use commas.
        const parts = (line.includes('\t') ? line.split('\t') : line.split(',')).map((s) => s.trim());
        const [name, phone, site, monthsRaw, lastRaw, email] = parts;
        if (!name) { skipped++; continue; }
        const months = Math.max(1, Math.min(120, parseInt(monthsRaw, 10) || 12));
        ckClients.push({
            id: 'c' + Date.now() + Math.random().toString(36).slice(2, 7),
            name, phone: phone || '', email: email || '', site: site || '', type: 'בדיקה תקופתית',
            months, last: ckParseDate(lastRaw), next: null, notes: '', eventId: null,
            updatedAt: Date.now()
        });
        added++;
    }
    document.getElementById('ck-importer').close();
    document.getElementById('ck-import-text').value = '';
    ckPersist();
    ckRender();
    showToast('יובאו ' + added + ' לקוחות' + (skipped ? ' (' + skipped + ' שורות דולגו)' : ''));
}

function ckParseDate(s) {
    if (!s) return null;
    s = s.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return m[1] + '-' + ckPad(+m[2]) + '-' + ckPad(+m[3]);
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
    if (m) {
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        return y + '-' + ckPad(+m[2]) + '-' + ckPad(+m[1]);
    }
    return null;
}

function ckExportCsv() {
    const header = 'שם,טלפון,אימייל,כתובת,סוג בדיקה,תדירות (חודשים),בדיקה אחרונה,בדיקה הבאה';
    const rows = ckLive().map((c) => [
        c.name, c.phone, c.email || '', c.site, c.type, c.months, c.last || '', ckNextDue(c) || '',
    ].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));
    const a = document.createElement('a');
    // ﻿ BOM so Excel opens the Hebrew correctly.
    a.href = URL.createObjectURL(new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'checkups-' + ckToday() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

// ---------- reminders-to-send strip + email draft + quote handoff ----------

// Clients whose due date entered the reminder window (28 days, matching the
// first calendar alert) — surfaced at the top so a glance at the tab says
// exactly who to nudge today.
function ckDueSoonClients() {
    return ckLive()
        .filter((c) => { const d = ckNextDue(c); return d && ckDaysUntil(d) <= 28; })
        .sort((a, b) => ckNextDue(a).localeCompare(ckNextDue(b)));
}

function ckRenderDueStrip() {
    const el = document.getElementById('ck-due-strip');
    if (!el) return;
    const due = ckDueSoonClients();
    if (due.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="ck-strip">
            <div class="ck-strip-title"><i class="fa-solid fa-bell"></i> תזכורות לשליחה, הבדיקה מתקרבת</div>
            <div class="ck-strip-chips">
                ${due.slice(0, 8).map((c) => {
                    const days = ckDaysUntil(ckNextDue(c));
                    const when = days < 0 ? 'באיחור ' + Math.abs(days) + ' יום' : days === 0 ? 'היום' : 'בעוד ' + days + ' יום';
                    return `<span class="ck-chip">
                        <b>${escapeHtml(c.name)}</b><small>${when}</small>
                        ${c.phone ? `<button title="וואטסאפ" class="ck-chip-btn ck-wa" onclick="ckWhatsapp('${c.id}')"><i class="fa-brands fa-whatsapp"></i></button>` : ''}
                        ${c.email ? `<button title="מייל" class="ck-chip-btn" onclick="ckMailto('${c.id}')"><i class="fa-solid fa-envelope"></i></button>` : ''}
                    </span>`;
                }).join('')}
                ${due.length > 8 ? `<span class="ck-chip ck-chip-more">+${due.length - 8} נוספים ברשימה</span>` : ''}
            </div>
        </div>`;
}

function ckReminderText(c) {
    const due = ckNextDue(c);
    const biz = (appState.settings && appState.settings.businessName) || '';
    return 'שלום, ' + (biz ? 'כאן ' + biz + '. ' : '') +
        'מתקרב מועד ה' + (c.type === 'בדיקה תקופתית' ? 'בדיקה התקופתית' : (c.type || 'בדיקה')) +
        ' למתקן החשמל אצלכם' + (due ? ' (' + ckFmtDate(due) + ')' : '') +
        ' · אשמח שנתאם מועד שנוח לכם.';
}

function ckMailto(id) {
    const c = ckClients.find((x) => x.id === id);
    if (!c || !c.email) return;
    const biz = (appState.settings && appState.settings.businessName) || '';
    const subject = 'תיאום ' + (c.type || 'בדיקה תקופתית') + ' · מתקן החשמל';
    const body = ckReminderText(c) + '\n\n' + 'בברכה,' + (biz ? '\n' + biz : '');
    // mailto opens the user's own mail app with a ready draft — he reviews and
    // hits send himself (no server, no surprises).
    window.location.href = 'mailto:' + encodeURIComponent(c.email) +
        '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

// After the client CONFIRMED the periodic service → one click opens a fresh
// project for them, client details prefilled, straight into the normal
// plan→price→draft flow.
function ckCreateQuote(id) {
    const c = ckClients.find((x) => x.id === id);
    if (!c) return;
    const prevActive = activeProjectId;
    createNewProject({ name: ((c.type || 'בדיקה תקופתית') + ' - ' + c.name).slice(0, 60) });
    // createNewProject bails on the plan gate (upgrade modal) — patch only the
    // NEW project, detected by the active id actually changing.
    if (!activeProjectId || activeProjectId === prevActive) return;
    const proj = projectsList.find((p) => p.id === activeProjectId);
    if (!proj) return;
    proj.quoteData.clientName = c.name;
    proj.quoteData.clientSub = [c.site, c.phone, c.email].filter(Boolean).join(' · ');
    proj.quoteData.subject = (c.type || 'בדיקה תקופתית') + (c.site ? ', ' + c.site : '');
    saveProjects();
    // Prefill the planning chat so one tap starts the product list.
    setTimeout(() => {
        const inp = document.getElementById('chat-user-input');
        if (inp) {
            inp.value = (c.type || 'בדיקה תקופתית') + ' למתקן חשמל' + (c.site ? ' ב' + c.site : '') + (c.notes ? '. הערות: ' + c.notes : '');
            inp.dispatchEvent(new Event('input'));
        }
    }, 500);
    showToast('נפתח פרויקט חדש עבור ' + c.name);
}

// ---------- Clarity token (admin) — feeds the automated analyst routine ----------

async function adminSaveClarityToken() {
    const input = document.getElementById('admin-clarity-token');
    const status = document.getElementById('admin-clarity-status');
    const token = (input.value || '').trim();
    if (!token) { showToast('הדבק את הטוקן קודם', 'error'); return; }
    if (!googleAccessToken) { showToast('התחבר עם Google קודם', 'error'); return; }
    status.textContent = 'שומר…';
    try {
        const res = await adminRes('/api/clarity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error((d.error && d.error.message) || res.status);
        input.value = '';
        status.textContent = 'נשמר ✓ · מעכשיו הנתונים נמשכים אוטומטית';
        status.style.color = 'var(--color-success)';
        showToast('טוקן Clarity נשמר בשרת');
    } catch (e) {
        status.textContent = 'שגיאה: ' + e.message;
        status.style.color = 'var(--color-danger)';
    }
}


// With both stages in one log, "the bottom" is the end of the PRICING half. Any
// action taken while characterizing would otherwise throw the user past a full
// materials list to reach it. Land on the end of the stage being worked in.
function scrollChatToActiveStage(log) {
    log = log || document.getElementById('chat-messages-log');
    if (!log) return;
    const mine = log.querySelectorAll('[data-stage="' + activeChatMode + '"]');
    const last = mine[mine.length - 1];
    if (!last) { log.scrollTop = log.scrollHeight; return; }
    // When it is the last thing in the log anyway, go all the way down — avoids
    // leaving a sliver of blank space under the final bubble.
    log.scrollTop = last.nextElementSibling
        ? Math.max(0, last.offsetTop + last.offsetHeight - log.clientHeight + 24)
        : log.scrollHeight;
}


// One project is one row. Stav, 28/08, with a screenshot of a single work
// filling an entire phone screen: "שורה של כל פרויקט אמורה להיות שורה,
// תסדר את זה."
//
// The row shows what you scan a list for — the name, its status, its date —
// and the ⋯ opens the rest in place: the two stage buttons, the category and
// client pickers, the reminder and the delete. Opening in place rather than
// deleting them matters: the client picker is not reachable from anywhere else
// on a phone since the title bar dropped it, and a list that quietly removes
// the only way to do something is worse than a list that is too tall.
function toggleProjectCard(btn, event) {
    if (event) event.stopPropagation();
    const card = btn.closest('.project-card');
    if (!card) return;
    const open = card.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
}
