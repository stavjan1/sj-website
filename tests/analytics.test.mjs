// Guards on the visitor counters in the admin panel.
//
// Two bugs are encoded here. The date math is one: "this month vs last month"
// silently spilling into the wrong days is invisible on screen — the number
// just looks plausible. The other is structural: the V3 restyle moved the app
// onto sale/css/panels.css and left the traffic card's classes behind in the
// legacy sale/styles.css, so a whole card rendered with browser defaults and
// nothing failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { periodWindows, daysOfMonth } from '../functions/api/analytics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('the week runs Sunday to today, and the comparison week is the one before it', () => {
    // 2026-03-31 is a Tuesday.
    const w = periodWindows('2026-03-31');
    assert.deepEqual(w.week.days, ['2026-03-29', '2026-03-30', '2026-03-31']);
    assert.deepEqual(w.week.prevDays, ['2026-03-22', '2026-03-23', '2026-03-24']);
    assert.equal(w.week.days.length, w.week.prevDays.length, 'compared weeks must span the same number of days');

    // On a Sunday the week is one day long, not eight.
    assert.deepEqual(periodWindows('2026-01-04').week.days, ['2026-01-04']);
});

test('today compares against the same weekday a week back', () => {
    const w = periodWindows('2026-08-20');
    assert.deepEqual(w.today.days, ['2026-08-20']);
    assert.deepEqual(w.today.prevDays, ['2026-08-13']);
});

test('the month compares against the previous month, clamped to its length', () => {
    // 31 March against February: the comparison stops at the 28th instead of
    // running past the end of the month and into March itself.
    const w = periodWindows('2026-03-31');
    assert.equal(w.month.days[0], '2026-03-01');
    assert.equal(w.month.days.at(-1), '2026-03-31');
    assert.equal(w.month.prevDays[0], '2026-02-01');
    assert.equal(w.month.prevDays.at(-1), '2026-02-28');

    // Crossing the year boundary lands in December, not in month zero.
    const jan = periodWindows('2026-01-04');
    assert.deepEqual(jan.month.prevDays, ['2025-12-01', '2025-12-02', '2025-12-03', '2025-12-04']);
});

test('the chart is twelve months ending in the current one, and the year only counts this year', () => {
    const w = periodWindows('2026-03-31');
    assert.equal(w.months.length, 12);
    assert.equal(w.months.at(-1), '2026-03');
    assert.equal(w.months[0], '2025-04');
    assert.deepEqual(w.yearMonths, ['2026-01', '2026-02', '2026-03']);
    assert.ok(w.yearMonths.every((m) => m.startsWith('2026')), 'the year total must not reach into last year');
});

test('a month knows its own length, leap year included, and never runs past today', () => {
    assert.equal(daysOfMonth('2024-02').length, 29);
    assert.equal(daysOfMonth('2026-02').length, 28);
    assert.equal(daysOfMonth('2026-04').length, 30);
    assert.equal(daysOfMonth('2026-12').length, 31);
    assert.deepEqual(daysOfMonth('2026-08', '2026-08-03'), ['2026-08-01', '2026-08-02', '2026-08-03']);
});

test('every class the traffic card renders is styled by the stylesheet the app loads', () => {
    // sale/styles.css is the legacy V2 sheet and is NOT linked from
    // sale/index.html — a rule that lives only there is a rule that never ran.
    const app = readApp();
    const panels = read('sale/css/panels.css');
    const index = read('sale/index.html');
    assert.ok(index.includes('css/panels.css'), 'sale/index.html no longer loads panels.css');
    assert.ok(!/href="[^"]*\/?styles\.css/.test(index), 'sale/index.html now loads the legacy styles.css — update this guard');

    const card = app.slice(app.indexOf('function vkpiTile'), app.indexOf('function clarityMetricLabel'));
    const used = new Set();
    for (const m of card.matchAll(/class="([^"$]+)"/g)) {
        for (const cls of m[1].split(/\s+/)) if (/^(v|t)[a-z-]/.test(cls)) used.add(cls);
    }
    assert.ok(used.size > 10, 'the traffic card stopped emitting classes — this guard is looking at the wrong code');
    const missing = [...used].filter((c) => !panels.includes('.' + c));
    assert.deepEqual(missing, [], `classes rendered with no rule in panels.css: ${missing.join(', ')}`);
});
