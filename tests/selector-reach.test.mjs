// A selector that matches nothing is the quietest bug this codebase has.
//
// It broke three visible things in one day, always the same way: an element is
// written as id="thing" with class="something-else", and the stylesheet reaches
// for `.thing`. The rule compiles, the file is valid, nothing throws — and the
// element renders with no styling at all. That produced the money board's four
// stat cards running into each other (class="pipe-summary" id="pipeline-summary"),
// my own mobile rule for the pipeline controls (class="pipe-controls"), and a
// dead circular-dial rule left over from before the quota meter became a bar.
//
// Reading the diff cannot catch it: the CSS is correct and the markup is
// correct, they simply never meet. So this test does what a person cannot —
// takes every id in the app shell, and fails if the stylesheet styles that name
// as a CLASS while no element anywhere actually carries it as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'sale', 'index.html'), 'utf8');
const APP = readApp();
const MARKUP = HTML + '\n' + APP;

// Only the sheets /sale/ actually loads. sale/styles.css is the legacy V2 sheet
// and is not linked from anywhere — including it would flood this with rules
// that cannot affect a rendered pixel.
const SHEETS = ['sale/css/panels.css', 'sale/css/shell.css', 'sale/css/pdf.css',
                'sale/controlroom.css', 'sale/nextstep.css', 'sale/periodic.css',
                'assets/ui.css'];
const CSS = SHEETS.map((f) => {
    try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; }
}).join('\n');

// Every class that exists in markup, including the ones JS builds at runtime.
const liveClasses = (() => {
    const set = new Set();
    for (const m of MARKUP.matchAll(/class\s*=\s*["'`]([^"'`]*)["'`]/g))
        m[1].split(/\s+/).filter(Boolean).forEach((c) => set.add(c.replace(/\$\{[\s\S]*/, '')));
    for (const m of MARKUP.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"]([\w-]+)['"]/g)) set.add(m[1]);
    for (const m of MARKUP.matchAll(/className\s*=\s*['"`]([^'"`]*)['"`]/g))
        m[1].split(/\s+/).filter(Boolean).forEach((c) => set.add(c));
    return set;
})();

const liveIds = (() => {
    const set = new Set();
    for (const m of HTML.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)) set.add(m[1]);
    return set;
})();

test('the stylesheets and the markup agree on what is a class', () => {
    // An id that no element carries as a class, but that a loaded stylesheet
    // styles AS a class — with a word boundary, so `.thing-wrap` does not count
    // as styling `.thing`.
    const offenders = [];
    for (const id of liveIds) {
        if (liveClasses.has(id)) continue;                 // it is a class too: fine
        const asClass = new RegExp(`\\.${id.replace(/[-]/g, '\\-')}(?![\\w-])`);
        if (asClass.test(CSS)) offenders.push(id);
    }
    assert.deepEqual(offenders, [],
        'these ids are styled as classes in a loaded stylesheet, so those rules match nothing');
});

test('the money board keeps the styling it only just got', () => {
    // The specific one Stav photographed. Both names are covered now, and the
    // element carries the class — if either half moves, this fails.
    assert.match(HTML, /class="pipe-summary"\s+id="pipeline-summary"/,
        'the stats container still has both names');
    assert.match(CSS, /\.pipe-summary\s*\{[^}]*display:\s*grid/,
        'and the class is the one the grid rule targets');
});

test('the legacy sheet is still not loaded, so nobody styles against it', () => {
    // 222KB of V2 CSS lives at sale/styles.css and nothing links it. That is
    // fine, and it is why this file ignores it — but if it ever comes back,
    // every rule in it becomes live at once and this test should be revisited.
    assert.ok(!/href="[^"]*sale\/styles\.css/.test(HTML) && !/href="styles\.css/.test(HTML),
        'sale/index.html now loads the legacy sheet — the scan above must include it');
});
