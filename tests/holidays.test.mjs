// The holiday reminder computes its dates from the browser's Hebrew calendar
// rather than a table someone has to maintain. These are the anchors that prove
// the computation, including the two rules that are easy to get wrong: Purim
// belongs to Adar II in a leap year, and Independence Day never touches Shabbat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8').replace(/\r\n/g, '\n');

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
