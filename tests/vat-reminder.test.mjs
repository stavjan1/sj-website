// A legal deadline with a fine behind it, so the arithmetic is pinned rather
// than trusted. Checked against the rule on 30.8.2026: the periodic VAT report
// is due by the 15th of the following month, online filing extends that to the
// 19th, reporting is monthly or bi-monthly by turnover, and an עוסק פטור files
// no periodic report at all.
//
// Stav wrote the bi-monthly filing months as "פברואר אפריל". The standard cycle
// is the other half — periods Jan-Feb, Mar-Apr … each reported in the month
// AFTER it ends, so filings land in March, May, July, September, November and
// January. These tests are what make that visible if it ever needs changing.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readApp } from './_app-source.mjs';

const app = readApp();

function load(mode, ackKeys = []) {
    const start = app.indexOf('const VAT_DUE_DAY');
    const end = app.indexOf('// The small rail beside the list');
    assert.ok(start > -1 && end > start, 'the VAT block moved or was renamed');
    const store = new Map(ackKeys.map((k) => ['sj_vat_ack_' + k, '1']));
    const ctx = vm.createContext({
        appState: { settings: { businessDetails: { vatReporting: mode } } },
        getStorageKey: (k) => k,
        localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
        showToast: () => {}, renderReminderBell: () => {},
        Date, Number, String, Math, Object,
    });
    vm.runInContext(app.slice(start, end), ctx);
    return ctx;
}

const at = (y, m, d) => new Date(y, m - 1, d).getTime();

test('a monthly filer is reminded from the 1st, about the month that just ended', () => {
    const { vatReminderItem } = load('monthly');
    const first = vatReminderItem(at(2026, 9, 1));
    assert.ok(first, 'nothing on the 1st — the day the month closed is the useful day');
    assert.match(first.why, /אוגוסט 2026/, 'the reminder does not name the period it is about');
    assert.match(first.why, /14 ימים/, 'the countdown to the 15th is wrong');
    assert.equal(first.overdue, false);
});

test('the 15th says it is the last day, and the 16th-19th says online only', () => {
    const { vatReminderItem } = load('monthly');
    assert.match(vatReminderItem(at(2026, 9, 15)).why, /המועד האחרון/);
    assert.equal(vatReminderItem(at(2026, 9, 15)).overdue, false);
    const late = vatReminderItem(at(2026, 9, 17));
    assert.ok(late && late.overdue, 'past the 15th it must say so');
    assert.match(late.why, /19/, 'the online-filing grace day is not mentioned');
});

test('after the 19th the window is closed and the bell goes quiet', () => {
    const { vatReminderItem } = load('monthly');
    assert.equal(vatReminderItem(at(2026, 9, 20)), null,
        'still nagging about a period that can no longer be filed for');
});

test('a bi-monthly filer is reminded in the ODD months, for the pair that ended', () => {
    const { vatReminderItem } = load('bimonthly');
    // March reports Jan-Feb.
    const march = vatReminderItem(at(2026, 3, 2));
    assert.ok(march, 'nothing in March — the Jan-Feb period is due then');
    assert.match(march.why, /ינואר–פברואר 2026/, 'March must report January-February');
    // April reports nothing.
    assert.equal(vatReminderItem(at(2026, 4, 2)), null, 'April is not a filing month on this cycle');
    // And May reports Mar-Apr.
    assert.match(vatReminderItem(at(2026, 5, 2)).why, /מרץ–אפריל 2026/);
});

test('January reports December, and the year rolls back with it', () => {
    const m = load('monthly').vatReminderItem(at(2026, 1, 3));
    assert.match(m.why, /דצמבר 2025/, 'January must report the previous December, of the previous year');
    const b = load('bimonthly').vatReminderItem(at(2026, 1, 3));
    assert.match(b.why, /נובמבר–דצמבר 2025/, 'January must report November-December of the previous year');
});

test('an עוסק פטור and an unconfigured business are never nagged', () => {
    assert.equal(load('none').vatReminderItem(at(2026, 9, 1)), null,
        'an עוסק פטור files no periodic report and must not be reminded of one');
    assert.equal(load('').vatReminderItem(at(2026, 9, 1)), null,
        'a business that never answered must not be told it has a deadline');
});

test('saying "I sent it" silences that period only', () => {
    const key = '2026-08';
    assert.equal(load('monthly', [key]).vatReminderItem(at(2026, 9, 3)), null,
        'the acknowledgement did not silence the period');
    // The NEXT period must arm itself again.
    assert.ok(load('monthly', [key]).vatReminderItem(at(2026, 10, 3)),
        'acknowledging one month silenced the next one too');
});
