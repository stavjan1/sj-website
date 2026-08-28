// The holiday reminder computes its dates from the browser's Hebrew calendar
// rather than a table someone has to maintain. These are the anchors that prove
// the computation, including the two rules that are easy to get wrong: Purim
// belongs to Adar II in a leap year, and Independence Day never touches Shabbat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readApp().replace(/\r\n/g, '\n');

function load() {
    const start = app.indexOf('const HOLIDAYS = [');
    const end = app.indexOf('// The banner appears from two weeks out');
    assert.ok(start > -1 && end > start, 'the holiday engine moved or was renamed');
    const ctx = vm.createContext({ Intl, Date, Math, parseInt, console });
    vm.runInContext(app.slice(start, end), ctx);
    return ctx;
}

const on = (iso) => new Date(iso + 'T09:00:00');

test('the Hebrew calendar drives the dates', () => {
    const { upcomingHolidays } = load();
    const found = (fromIso, days, name) =>
        upcomingHolidays(days, on(fromIso)).find((h) => h.name === name);

    assert.equal(found('2026-08-01', 60, 'ראש השנה').iso, '2026-09-12');
    assert.equal(found('2026-08-01', 90, 'יום כיפור').iso, '2026-09-21');
    assert.equal(found('2026-11-01', 60, 'חנוכה').iso, '2026-12-05');
    assert.equal(found('2027-03-01', 60, 'פסח').iso, '2027-04-22');
    assert.equal(found('2027-05-01', 60, 'שבועות').iso, '2027-06-11');
});

test('Purim is in the second Adar of a leap year', () => {
    const { upcomingHolidays } = load();
    // 5787 is a leap year: Purim falls in Adar II, on 23.3.2027.
    const purim = upcomingHolidays(120, on('2027-01-15')).filter((h) => h.name === 'פורים');
    assert.equal(purim.length, 1, 'a leap year produced two Purims (Adar I counted too)');
    assert.equal(purim[0].iso, '2027-03-23');
});

test('Independence Day is moved off Friday, Saturday and Monday', () => {
    const { upcomingHolidays } = load();
    for (const [from, to] of [['2027-04-01', 60], ['2028-04-01', 60], ['2029-03-20', 90]]) {
        const day = upcomingHolidays(to, on(from)).find((h) => h.name === 'יום העצמאות');
        assert.ok(day, `no Independence Day found from ${from}`);
        const dow = new Date(day.iso + 'T09:00:00').getDay();
        assert.ok(![5, 6, 1].includes(dow), `${day.iso} falls on a day the state moves it off (${dow})`);
    }
});

test('nothing in the past is offered', () => {
    const { upcomingHolidays } = load();
    for (const h of upcomingHolidays(365, on('2026-08-22'))) {
        assert.ok(h.daysAway >= 0, `${h.name} came back with a negative distance`);
    }
});

test('the clock change does not shift a date', () => {
    // Israel moves the clock on the last Friday of March and the last Sunday of
    // October, so one day is 23 hours and one is 25. Walking the calendar with
    // `+ i * 86400000` drifts off midnight across those days and can name the
    // wrong civil date for the rest of the loop — in a function whose only job
    // is to name a date.
    const { upcomingHolidays } = load();

    // Pesach 5787 is 22.4.2027, and counting to it from before the March change
    // crosses the short day.
    const before = upcomingHolidays(90, on('2027-03-01')).find((h) => h.name === 'פסח');
    assert.ok(before, 'no Pesach found across the spring clock change');
    assert.equal(before.iso, '2027-04-22');

    // And the count of days has to match the calendar, not the elapsed hours.
    const days = Math.round(
        (new Date('2027-04-22T00:00:00') - new Date('2027-03-01T00:00:00')) / 86400000);
    assert.equal(before.daysAway, days, 'daysAway drifted over the clock change');

    // Crossing the autumn change in the other direction.
    const autumn = upcomingHolidays(80, on('2026-10-01')).find((h) => h.name === 'חנוכה');
    assert.ok(autumn, 'no Hanukkah found across the autumn clock change');
    assert.equal(autumn.iso, '2026-12-05');
});

test('the countdown reads the way it is spoken', () => {
    // "בעוד 9 ימים" is a number to decode. "השבוע" is something you act on.
    const src = app.slice(app.indexOf('function holidayHeadline('), app.indexOf('function renderHolidayBar('));
    const ctx = vm.createContext({});
    vm.runInContext(src + ';globalThis.h = holidayHeadline;', ctx);
    const h = ctx.h;
    const shavuot = { name: 'שבועות', greet: 'חג שבועות שמח' };
    assert.equal(h({ ...shavuot, daysAway: 14 }), 'בעוד שבועיים שבועות');
    assert.equal(h({ ...shavuot, daysAway: 5 }), 'השבוע שבועות');
    assert.equal(h({ ...shavuot, daysAway: 1 }), 'מחר שבועות');
    assert.equal(h({ ...shavuot, daysAway: 0 }), 'חג שבועות שמח!');
});
