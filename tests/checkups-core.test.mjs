// One definition of "when is the next checkup due".
//
// The tracker at /checkups/ and the "שירות תקופתי" view inside /sale/ each had
// their own copy of the same nine functions. The 08/08 pre-deploy review caught
// a fix that had to be applied twice, by hand, identically — which is the
// warning, not the bug. Two copies that can disagree about a due date is a
// missed visit, and about ICS escaping is a file Apple Calendar refuses to open.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = () => {
    const ctx = createContext({ Date, String, Number, Math, Array, Object });
    runInContext(readFileSync(join(ROOT, 'assets', 'checkups-core.js'), 'utf8'), ctx);
    return runInContext('SJ_CK', ctx);
};

test('adding months clamps the day instead of rolling into the next month', () => {
    const CK = load();
    assert.equal(CK.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(CK.addMonths('2028-01-31', 1), '2028-02-29', 'leap year');
    assert.equal(CK.addMonths('2026-03-31', 1), '2026-04-30');
    assert.equal(CK.addMonths('2026-08-22', 12), '2027-08-22');
    assert.equal(CK.addMonths('2026-12-15', 1), '2027-01-15', 'over the year boundary');
});

test('an explicit next date wins over the interval', () => {
    const CK = load();
    assert.equal(CK.nextDue({ next: '2027-01-01', last: '2026-01-01', months: 12 }), '2027-01-01');
    assert.equal(CK.nextDue({ last: '2026-01-01', months: 12 }), '2027-01-01');
    assert.equal(CK.nextDue({ months: 12 }), null, 'no last visit, no date to give');
    assert.equal(CK.nextDue(null), null);
});

test('status is overdue, soon or ok — and missing when nobody has said', () => {
    const CK = load();
    const day = 86400000;
    const at = (offset) => new Date(Date.now() + offset * day).toISOString().slice(0, 10);
    assert.equal(CK.statusOf({ next: at(-1) }), 'overdue');
    assert.equal(CK.statusOf({ next: at(10) }), 'soon');
    assert.equal(CK.statusOf({ next: at(90) }), 'ok');
    assert.equal(CK.statusOf({ next: at(90) }, 120), 'soon', 'the window is the caller\'s');
    assert.equal(CK.statusOf({}), 'missing');
});

test('yearly intervals become YEARLY rules, not twelve-month ones', () => {
    const CK = load();
    assert.equal(CK.rrule(12), 'RRULE:FREQ=YEARLY;INTERVAL=1');
    assert.equal(CK.rrule(24), 'RRULE:FREQ=YEARLY;INTERVAL=2');
    assert.equal(CK.rrule(6), 'RRULE:FREQ=MONTHLY;INTERVAL=6');
});

test('ICS text escaping keeps the file parseable', () => {
    const CK = load();
    assert.equal(CK.icsText('רחוב הרצל 5, תל אביב'), 'רחוב הרצל 5\\, תל אביב');
    assert.equal(CK.icsText('שורה\nשנייה'), 'שורה\\nשנייה');
    assert.equal(CK.icsText('a;b'), 'a\\;b');
    assert.equal(CK.icsText('back\\slash'), 'back\\\\slash');
    assert.equal(CK.icsText(null), '');
});

test('the .ics carries the date, the recurrence and both alarms', () => {
    const CK = load();
    const ics = CK.icsFile({ id: 'c1', name: 'משפחת כהן', type: 'בדיקה תקופתית',
                             site: 'הרצל 5, תל אביב', months: 12, next: '2027-03-01' });
    assert.match(ics, /DTSTART;VALUE=DATE:20270301/);
    assert.match(ics, /DTEND;VALUE=DATE:20270302/, 'an all-day event ends the next day');
    assert.match(ics, /RRULE:FREQ=YEARLY;INTERVAL=1/);
    assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
    assert.match(ics, /LOCATION:הרצל 5\\, תל אביב/, 'the comma is escaped at the sink');
    assert.equal(ics.split('\r\n').length, ics.split('\r\n').filter(Boolean).length, 'no blank lines');
    assert.equal(CK.icsFile({ id: 'c2', name: 'ללא תאריך', months: 12 }), null);
});

test('the calendar event says where it came from, in the caller\'s words', () => {
    const CK = load();
    const ev = CK.eventBody({ name: 'כהן', months: 24, next: '2027-03-01', phone: '050' }, '(מזרם)');
    assert.equal(ev.start.date, '2027-03-01');
    assert.equal(ev.end.date, '2027-03-02');
    // Built inside a vm realm, so its Array is not this realm's Array.
    assert.equal(ev.recurrence.join(''), 'RRULE:FREQ=YEARLY;INTERVAL=2');
    assert.match(ev.description, /תדירות: כל שנתיים/);
    assert.match(ev.description, /\(מזרם\)/);
    assert.equal(ev.reminders.overrides.length, 3);
});

test('both screens delegate — no second copy of the arithmetic', () => {
    const sale = readApp();
    const checkups = readFileSync(join(ROOT, 'checkups', 'app.js'), 'utf8');
    // Scoped to the periodic-service functions: the app has other calendar
    // exports (the maintenance series, a follow-up reminder) that are different
    // features and legitimately build their own files.
    const fn = (src, name) => {
        const at = src.indexOf('function ' + name);
        assert.ok(at > -1, name + ' is gone');
        return src.slice(at, src.indexOf('\n}', at));
    };
    for (const name of ['ckRrule', 'ckEventBody', 'ckIcsText', 'ckAddMonths', 'ckNextDue', 'ckStatusOf']) {
        assert.match(fn(sale, name), /SJ_CK\./, 'sale/app.js ' + name + ' has its own copy again');
    }
    for (const name of ['rruleFor', 'eventBody', 'icsText', 'addMonths', 'nextDue', 'statusOf']) {
        assert.match(fn(checkups, name), /SJ_CK\./, 'checkups/app.js ' + name + ' has its own copy again');
    }
    for (const src of [sale, checkups]) {
        assert.doesNotMatch(src, /Checkups\/\/HE/, 'a second copy of the checkup .ics is back');
    }
    // And both pages must actually load it, or the delegation is a crash.
    for (const page of ['sale/index.html', 'checkups/index.html']) {
        assert.match(readFileSync(join(ROOT, page), 'utf8'), /assets\/checkups-core\.js/, page);
    }
});
