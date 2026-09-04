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

// ── the single-client path and the editor ────────────────────────────────
// The standalone /checkups/ page carried a second copy of this plumbing until
// it was retired (4.9.2026; the URL redirects into the app). What its tests
// protected — one upsert path, one calendar builder, an editor whose fields
// exist — now has one home, and is checked there.

test('the per-row calendar button and the bulk run share one upsert', () => {
    // Two upsert paths that can drift is how one of them quietly stops
    // patching — and a push that creates instead of patches is a second copy
    // of the visit in the calendar.
    const push = fn(APP, 'ckPushToGoogle');
    assert.equal((push.match(/method: 'PATCH'/g) || []).length, 1, 'the upsert patches the existing event');
    assert.match(push, /res\.status === 404 \|\| res\.status === 410/, 'and recreates one deleted by hand');
    assert.match(fn(APP, 'ckSyncCalendar'), /ckPushToGoogle\(/, 'the per-row button uses it');
    assert.match(fn(APP, 'pdueRun'), /ckPushToGoogle\(/, 'and so does the bulk run');
});

test('the single-client .ics comes from the shared core', () => {
    const body = fn(APP, 'ckDownloadIcs');
    assert.match(body, /SJ_CK\.icsFile\(/);
    assert.doesNotMatch(body, /BEGIN:VCALENDAR/, 'no hand-rolled wrapper');
});

test('the editor reads only fields the markup has', () => {
    // ckOpenEditor and ckSaveClient address the form by id. A field renamed in
    // the markup and not in the code is a TypeError on "לקוח חדש" — the button
    // that adds a client — with nothing on screen to say why.
    const ids = new Set();
    for (const name of ['ckOpenEditor', 'ckSaveClient']) {
        for (const m of fn(APP, name).matchAll(/getElementById\('(ck-[a-z-]+)'\)/g)) ids.add(m[1]);
    }
    assert.ok(ids.size >= 12, 'the editor lost its fields');
    const missing = [...ids].filter((id) => !HTML.includes('id="' + id + '"'));
    assert.deepEqual(missing, [], 'the code asks for ids the markup does not have');
    assert.match(HTML, /<dialog id="ck-editor"/);
    assert.match(HTML, /onsubmit="ckSaveClient\(event\)"/);
    assert.match(HTML, /onclick="ckOpenEditor\(\)"/, 'the "לקוח חדש" button');
});

test('the import and export buttons still have their handlers', () => {
    for (const handler of ['ckOpenImport', 'ckRunImport', 'ckExportCsv']) {
        assert.match(HTML, new RegExp('onclick="' + handler + '\\(\\)"'), handler + ' has no button');
        fn(APP, handler); // asserts it is still defined
    }
    assert.match(HTML, /<dialog id="ck-importer"/);
    assert.match(HTML, /id="ck-import-text"/);
});
