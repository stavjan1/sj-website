/* SJ — periodic-service core (בדיקות תקופתיות / שירות תקופתי).
 *
 * The same feature lives on two screens: the standalone /checkups/ tracker and
 * the "שירות תקופתי" view inside /sale/. Both computed the next due date, the
 * status, the Google Calendar event and the .ics file from their own copy of
 * the same nine functions — found in the 08/08 pre-deploy review, when a fix
 * had to be applied twice, identically, by hand. A rule that can drift is a
 * rule that will: the two copies disagreeing about when a checkup is due is a
 * missed visit, and about ICS escaping is a file Apple Calendar refuses.
 *
 * Everything here is pure date/text logic — no DOM, no storage, no fetch. The
 * two screens keep their own rendering, their own storage and their own words;
 * what they share is the arithmetic and the file formats.
 *
 * Loaded as a plain script before each app (window.SJ_CK), because neither page
 * uses modules.
 */
(function (root) {
    'use strict';

    function pad(n) { return String(n).padStart(2, '0'); }

    function ymd(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function today() { return ymd(new Date()); }

    // Add months to YYYY-MM-DD, clamping the day (31.1 + 1mo → 28.2, not 3.3).
    function addMonths(dateStr, months) {
        const parts = String(dateStr).split('-').map(Number);
        const t = new Date(parts[0], parts[1] - 1 + months, 1);
        const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
        t.setDate(Math.min(parts[2], lastDay));
        return ymd(t);
    }

    function addDays(dateStr, n) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + n);
        return ymd(d);
    }

    // The date the next checkup is due: an explicit override wins, else the
    // last visit plus the interval. Null means nobody has said yet.
    function nextDue(c) {
        if (!c) return null;
        if (c.next) return c.next;
        if (c.last && c.months) return addMonths(c.last, c.months);
        return null;
    }

    function daysUntil(dateStr) {
        return Math.round((new Date(dateStr + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
    }

    function fmtDate(dateStr) {
        const p = String(dateStr).split('-');
        return p[2] + '.' + p[1] + '.' + p[0];
    }

    function intervalLabel(months) {
        if (months === 12) return 'כל שנה';
        if (months === 24) return 'כל שנתיים';
        if (months % 12 === 0) return 'כל ' + (months / 12) + ' שנים';
        return 'כל ' + months + ' חודשים';
    }

    function statusOf(c, soonDays) {
        const due = nextDue(c);
        if (!due) return 'missing';
        const days = daysUntil(due);
        if (days < 0) return 'overdue';
        if (days <= (soonDays == null ? 60 : soonDays)) return 'soon';
        return 'ok';
    }

    function rrule(months) {
        return months % 12 === 0
            ? 'RRULE:FREQ=YEARLY;INTERVAL=' + (months / 12)
            : 'RRULE:FREQ=MONTHLY;INTERVAL=' + months;
    }

    // RFC 5545 TEXT escaping — a raw newline, comma or semicolon in a property
    // value makes the whole file unparseable for Apple Calendar and Outlook.
    function icsText(s) {
        return String(s || '')
            .replace(/\\/g, '\\\\')
            .replace(/[,;]/g, function (m) { return '\\' + m; })
            .replace(/\r?\n/g, '\\n');
    }

    // A Google Calendar event for one client. `source` is the sentence that
    // says where it came from — the only thing the two screens word differently.
    function eventBody(c, source) {
        const due = nextDue(c);
        return {
            summary: '⚡ ' + (c.type || 'בדיקה תקופתית') + ', ' + c.name,
            location: c.site || undefined,
            description: [
                c.phone ? 'טלפון: ' + c.phone : '',
                'תדירות: ' + intervalLabel(c.months),
                c.notes || '',
                source || '(נוצר אוטומטית ממעקב הבדיקות של SJ הנדסת חשמל)',
            ].filter(Boolean).join('\n'),
            start: { date: due },
            end: { date: addDays(due, 1) },
            recurrence: [rrule(c.months)],
            // Calendar does the reminding: email a month ahead (to book the
            // visit), then email a week ahead, then a popup the day before.
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 28 * 1440 },
                    { method: 'email', minutes: 7 * 1440 },
                    { method: 'popup', minutes: 1440 },
                ],
            },
        };
    }

    // The same appointment as a file, for a phone that is not signed into
    // Google. Returns null when no date has been set.
    function icsFile(c) {
        const due = nextDue(c);
        if (!due) return null;
        const dt = due.replace(/-/g, '');
        const summary = icsText((c.type || 'בדיקה תקופתית') + ', ' + c.name);
        const desc = icsText([c.phone ? 'טלפון: ' + c.phone : '', c.notes || ''].filter(Boolean).join('\n'));
        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//SJ Electrical Engineering//Checkups//HE',
            'BEGIN:VEVENT',
            'UID:' + c.id + '@sj-eng.co.il',
            'DTSTAMP:' + dt + 'T000000Z',
            'DTSTART;VALUE=DATE:' + dt,
            'DTEND;VALUE=DATE:' + addDays(due, 1).replace(/-/g, ''),
            rrule(c.months),
            'SUMMARY:' + summary,
            c.site ? 'LOCATION:' + icsText(c.site) : '',
            desc ? 'DESCRIPTION:' + desc : '',
            'BEGIN:VALARM', 'TRIGGER:-P28D', 'ACTION:DISPLAY', 'DESCRIPTION:' + summary, 'END:VALARM',
            'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', 'DESCRIPTION:' + summary, 'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
        ].filter(Boolean).join('\r\n');
    }

    root.SJ_CK = {
        pad: pad, today: today, addMonths: addMonths, addDays: addDays,
        nextDue: nextDue, daysUntil: daysUntil, fmtDate: fmtDate,
        intervalLabel: intervalLabel, statusOf: statusOf, rrule: rrule,
        icsText: icsText, eventBody: eventBody, icsFile: icsFile,
    };
})(typeof window !== 'undefined' ? window : globalThis);
