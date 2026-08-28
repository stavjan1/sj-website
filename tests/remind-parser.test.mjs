// "תזכיר לי מחר בבוקר להתקשר לדני" has to land on the right morning. A parser
// that is merely usually right is worse than a date picker, because the one
// time it is wrong nobody finds out until the client has already not been
// called — so every phrase this thing claims to understand is pinned here,
// against a fixed clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'sale', 'app.js'), 'utf8');

// The parser and its two tables, lifted out of the app and run on their own.
function load() {
    const from = SRC.indexOf('const HE_WEEKDAYS');
    const to = SRC.indexOf('// The dialog: one field');
    assert.ok(from > 0 && to > from, 'the parser block moved — update this slice');
    const ctx = createContext({ Date, String, Number, Math, Array, Object, RegExp, isNaN, parseInt });
    runInContext(SRC.slice(from, to), ctx);
    return (text, now) => runInContext('parseHebrewWhen', ctx)(text, now);
}

// Sunday 2026-08-23, 14:30 local — a weekday name test needs to know what day
// it is, and "next Sunday" has to mean the one after today, not today.
const NOW = new Date(2026, 7, 23, 14, 30, 0, 0);
const parse = load();
const at = (text) => parse(text, NOW).at;
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('the days a working week is actually spoken in', () => {
    assert.equal(fmt(at('מחר')), '2026-08-24 09:00');
    assert.equal(fmt(at('מחרתיים')), '2026-08-25 09:00');
    assert.equal(fmt(at('היום בערב')), '2026-08-23 18:00');
    assert.equal(fmt(at('בעוד שבוע')), '2026-08-30 09:00');
    assert.equal(fmt(at('בעוד שבועיים')), '2026-09-06 09:00');
    assert.equal(fmt(at('בעוד 3 ימים')), '2026-08-26 09:00');
    assert.equal(fmt(at('בעוד חודש')), '2026-09-23 09:00');
    assert.equal(fmt(at('בעוד חודשיים')), '2026-10-23 09:00');
});

test('Hebrew counts in words, not only in digits', () => {
    assert.equal(fmt(at('בעוד שלושה ימים')), '2026-08-26 09:00');
    assert.equal(fmt(at('בעוד שבועיים')), '2026-09-06 09:00');
    assert.equal(fmt(at('עוד עשרה ימים')), '2026-09-02 09:00');
});

test('a weekday means the NEXT one, and today means a week from today', () => {
    assert.equal(fmt(at('ביום שני')), '2026-08-24 09:00');
    assert.equal(fmt(at('ביום חמישי')), '2026-08-27 09:00');
    // NOW is a Sunday; "on Sunday" cannot mean four hours ago.
    assert.equal(fmt(at('ביום ראשון')), '2026-08-30 09:00');
});

test('a date without a year is the next time that date happens', () => {
    assert.equal(fmt(at('ב-15/9')), '2026-09-15 09:00');
    assert.equal(fmt(at('ב 3.11')), '2026-11-03 09:00');
    // Already past this year, written with no year → next year, not last week.
    assert.equal(fmt(at('ב-1/3')), '2027-03-01 09:00');
    assert.equal(fmt(at('ב-15/9/2027')), '2027-09-15 09:00');
});

test('an hour said out loud wins over the nine-o-clock default', () => {
    assert.equal(fmt(at('מחר בשעה 14')), '2026-08-24 14:00');
    assert.equal(fmt(at('מחר ב-16:30')), '2026-08-24 16:30');
    assert.equal(fmt(at('מחר בצהריים')), '2026-08-24 12:00');
    assert.equal(fmt(at('ביום שני בערב')), '2026-08-24 18:00');
});

test('"in two hours" is a time, and does not get flattened to nine o clock', () => {
    assert.equal(fmt(at('בעוד שעתיים')), '2026-08-23 16:30');
    assert.equal(fmt(at('בעוד 3 שעות')), '2026-08-23 17:30');
});

test('what he wants to be reminded ABOUT survives the parse', () => {
    const r = parse('תזכיר לי מחר בבוקר להתקשר לדני על המפתח', NOW);
    assert.equal(fmt(r.at), '2026-08-24 09:00');
    assert.match(r.what, /להתקשר לדני/);
    assert.ok(!/מחר/.test(r.what), 'the time phrase is not left inside the subject');
});

test('a sentence with no date at all returns nothing, rather than a guess', () => {
    // This is the whole safety property: the caller shows a date field instead
    // of booking a reminder on a day nobody chose.
    assert.equal(parse('להתקשר לדני', NOW), null);
    assert.equal(parse('', NOW), null);
    assert.equal(parse(null, NOW), null);
    assert.equal(parse('תזכיר לי', NOW), null);
});

test('the caller does not book anything when the parse came back empty', () => {
    const i = SRC.indexOf('async function remindMeSubmit');
    const body = SRC.slice(i, SRC.indexOf('\n}', i));
    assert.match(body, /if \(!parsed\)/, 'the empty parse is handled');
    assert.match(body, /remind-fallback/, 'and it opens the date field');
    assert.ok(body.indexOf('remindMeBook') > body.indexOf('if (!parsed)'),
        'booking happens only after the guard');
});

test('both reminder buttons go through one calendar path', () => {
    // Two upserts against the same event id is how a project ends up with two
    // reminders that each think they are the only one.
    assert.match(SRC, /async function pushReminderEvent\(proj, when, title, desc\)/);
    const fu = SRC.slice(SRC.indexOf('async function followupRemindMe'), SRC.indexOf('async function pushReminderEvent'));
    assert.match(fu, /pushReminderEvent/, 'the follow-up button delegates');
    assert.ok(!/calendar\/v3/.test(fu), 'and no longer talks to Google itself');
});
