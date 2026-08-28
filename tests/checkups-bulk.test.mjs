// "Add everything to the calendar" is one click that writes to somebody else's
// system dozens of times, and every way it can go wrong is expensive: a second
// consent popup halfway through is blocked by the browser and kills the run, a
// per-item save spends the whole day's KV write budget on one press, and an
// event created without its id recorded is an event nobody can ever delete —
// which is how a calendar ends up with two of every visit.
//
// None of that is visible in a diff. These are source-level guards: they read
// the shipped code and fail when a future refactor quietly removes one of the
// rules that keep the feature safe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const APP = readApp();
const CK = read('checkups', 'app.js');           // the standalone tracker at /checkups/
const HTML = read('sale', 'index.html');

// The body of one function, by brace counting from its declaration.
function fn(src, name) {
    const i = src.search(new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\('));
    assert.ok(i >= 0, `${name} is not defined any more`);
    const open = src.indexOf('{', i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
    }
    throw new Error(`${name} never closes`);
}

test('the bulk run asks for consent once, before the loop', () => {
    // Google's popup flow only survives inside the click that opened it. A
    // token minted mid-loop is a blocked popup and a run that dies halfway
    // through with no explanation.
    const body = fn(APP, 'pdueRun');
    const mints = body.match(/ckEnsureCalToken/g) || [];
    assert.equal(mints.length, 1, 'exactly one consent per run');
    assert.ok(body.indexOf('ckEnsureCalToken') < body.indexOf('for ('),
        'the token is minted before the loop, not inside it');
});

test('the bulk run writes to storage once, not once per item', () => {
    // KV allows one write per second per key, on a 1,000/day free tier. A save
    // per item turns one press into a rate-limit and an empty budget.
    const body = fn(APP, 'pdueRun');
    assert.equal((body.match(/ckPersist\(\)/g) || []).length, 1);
    assert.doesNotMatch(body, /ckCloudSave\(/, 'the cloud save is debounced, never called per item');
    assert.equal((body.match(/saveProjects\(\)/g) || []).length, 1);
});

test('every event created is recorded, even when the run dies mid-series', () => {
    // The anti-double-booking guard. Without the finally, a 401 on the second
    // of three blocks left the first event in the calendar with its id nowhere,
    // so the retry created a second copy and nothing could find the first.
    const body = fn(APP, 'maintPushToGoogle');
    assert.match(body, /finally\s*{[\s\S]*eventIds/, 'the ids are written back in a finally');
    assert.ok(body.indexOf('finally') > body.indexOf('return { ok: false'),
        'the finally comes after the early returns it exists to cover');
});

test('an expired token stops the run instead of burning the rest of the queue', () => {
    const body = fn(APP, 'pdueRun');
    assert.match(body, /'auth'[\s\S]{0,400}break/, "the loop breaks on the first 'auth'");
    assert.match(body, /reason: 'skipped'/, 'and what was never tried says so, rather than "failed"');
});

test('the queue never re-pushes something that is already in the calendar', () => {
    const body = fn(APP, 'pdueQueue');
    assert.match(body, /eventIds \|\| \[\]\)\.length\) return/, 'maintenance already booked is skipped');
    assert.match(body, /if \(c\.eventId\) return/, 'a checkup already booked is skipped');
});

test('the due strip is silent when nothing is due, and is not sold as Pro', () => {
    const body = fn(APP, 'renderMaintDueStrip');
    assert.match(body, /items\.length[\s\S]{0,80}innerHTML = ''/, 'empty means empty, not an empty card');
    assert.doesNotMatch(body, /tierAllows/, 'periodic service was never a paid feature');
    // Ids reach the DOM inside quoted onclick attributes, so they are escaped
    // once at the top and the raw value never travels. Checking the call sites
    // one by one would be a regex that lies; checking that the raw id cannot
    // appear at all is a rule that holds however the markup is rearranged.
    assert.match(body, /const id = escapeHtml\(String\(it\.id\)\)/, 'the id is escaped once, at the top');
    assert.doesNotMatch(body, /\$\{it\.id\}/, 'and the raw id never reaches the markup');
    assert.doesNotMatch(body, /\$\{p\.id\}|\$\{c\.id\}/, 'nor any other raw record id');
});

test('there is exactly one thing in the codebase that builds a calendar file', () => {
    // Two ICS builders that can disagree is a file Apple Calendar refuses to
    // open, found by a customer.
    // Was 1: the follow-up reminder hand-rolled its own VCALENDAR. It goes
    // through the same wrapper as everything else now, so the right number of
    // calendar builders outside the core is zero.
    assert.equal((APP.match(/BEGIN:VCALENDAR/g) || []).length, 0,
        'sale/app.js does not hand-roll a calendar wrapper at all');
    assert.match(fn(APP, 'maintToIcs'), /SJ_CK\.icsWrap/);
    assert.match(fn(APP, 'pdueBulkIcs'), /SJ_CK\.icsWrap/);
});

test('many appointments come out as ONE calendar file', () => {
    const ctx = createContext({ Date, String, Number, Math, Array, Object });
    runInContext(read('assets', 'checkups-core.js'), ctx);
    const CK = runInContext('SJ_CK', ctx);
    const a = { id: 'a', name: 'דירה', months: 12, last: '2026-01-10' };
    const b = { id: 'b', name: 'משרד', months: 6, last: '2026-02-10' };
    const one = CK.icsWrap([CK.icsVevent(a)], 'Checkups');
    const many = CK.icsWrap([CK.icsVevent(a), CK.icsVevent(b)], 'Periodic');

    assert.equal((many.match(/BEGIN:VCALENDAR/g) || []).length, 1, 'one calendar…');
    assert.equal((many.match(/BEGIN:VEVENT/g) || []).length, 2, '…holding both visits');
    assert.match(many, /PRODID:.*\/\/Periodic\/\/HE/, 'the file says which button made it');
    assert.equal(one, CK.icsFile(a), 'the single-appointment file is unchanged by the split');
    assert.equal(CK.icsWrap([]), null, 'nothing to export is null, not an empty calendar');
    assert.equal(CK.icsWrap([null]), null);
    assert.equal(CK.icsVevent({ id: 'z' }), null, 'no date, no event');
});

test('the strip sits above the list it belongs to, and its dialog exists', () => {
    const strip = HTML.indexOf('id="maint-due-strip"');
    const followups = HTML.indexOf('id="followup-reminders"');
    const cats = HTML.indexOf('id="projects-cats"');
    assert.ok(strip > 0, 'the strip has a home in the markup');
    assert.ok(followups < strip && strip < cats,
        'between the follow-up strip and the category bar — outside the scrolling list');
    assert.match(HTML, /id="pdue-bulk"/, 'the bulk dialog exists');
    assert.match(HTML, /id="pdue-bulk-body"/);
    assert.match(HTML, /id="pdue-bulk-foot"/);
    assert.match(HTML, /periodic\.css\?v=\d+/, 'and its stylesheet is linked');
});

test('a run that half-worked reports both halves by name', () => {
    const body = fn(APP, 'pdueRenderResult');
    assert.match(body, /נוספו ליומן/);
    assert.match(body, /לא נוספו/);
    // A network failure on the way back is not proof that nothing was created,
    // and "failed" would send him to press it again and book the visit twice.
    assert.match(fn(APP, 'pdueReasonText'), /ייתכן שכן נוצר/);
});

// ── the same feature on the standalone page ──────────────────────────────
// /checkups/ is a separate app with its own copy of the plumbing (its own token
// key, its own storage). The rules that make a bulk calendar run safe are not
// copied by having the same author twice; they are copied by being checked.

test('the standalone page asks for consent once, before its loop', () => {
    const body = fn(CK, 'bulkRun');
    assert.equal((body.match(/ensureCalendarToken/g) || []).length, 1);
    assert.ok(body.indexOf('ensureCalendarToken') < body.indexOf('for ('),
        'minted before the loop, or the popup is blocked halfway through');
});

test('the standalone page writes once per run, not once per client', () => {
    const body = fn(CK, 'bulkRun');
    assert.equal((body.match(/persist\(\)/g) || []).length, 1);
    assert.doesNotMatch(body, /cloudSave\(/, 'the cloud write is debounced behind persist()');
});

test('the standalone queue skips what is already in the calendar', () => {
    const body = fn(CK, 'bulkQueue');
    assert.match(body, /!c\.eventId/, 'a client already booked is not booked again');
    assert.match(body, /daysUntil\(d\) <= 28/, 'and next year is not booked today');
});

test('the standalone run stops on an expired token and says what it skipped', () => {
    const body = fn(CK, 'bulkRun');
    assert.match(body, /'auth'[\s\S]{0,300}break/);
    assert.match(body, /reason: 'skipped'/);
    assert.match(fn(CK, 'bulkReason'), /ייתכן שכן נוצר/,
        'a network failure is not proof that nothing was created');
});

test('the standalone page has one calendar builder, and it is the shared one', () => {
    // Prose that mentions the header is not a builder of one — the comment
    // explaining WHY there is no second wrapper would otherwise fail the rule
    // it is explaining.
    const code = CK.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.equal((code.match(/BEGIN:VCALENDAR/g) || []).length, 0, 'no hand-rolled wrapper');
    assert.match(fn(CK, 'bulkIcs'), /SJ_CK\.icsWrap/);
    assert.match(fn(CK, 'downloadIcs'), /SJ_CK\.icsFile/);
});

test('the standalone single-client path still goes through the same core', () => {
    // The refactor must not have left the old inline fetch behind: two upsert
    // paths that can drift is how one of them quietly stops patching.
    assert.equal((CK.match(/method: 'PATCH'/g) || []).length, 1, 'exactly one upsert in the file');
    assert.match(fn(CK, 'syncCalendar'), /pushToGoogle/);
});

test('the standalone button and dialog exist', () => {
    const html = read('checkups', 'index.html');
    assert.match(html, /onclick="bulkOpen\(\)"/);
    assert.match(html, /id="bulk-cal"/);
    assert.match(html, /id="bulk-body"/);
    assert.match(html, /id="bulk-foot"/);
});

