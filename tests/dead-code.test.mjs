// A function nobody calls is not harmless: it is a promise the code keeps
// making about behaviour it no longer has. Twenty-one of them were found in one
// review — drawer stubs for a drawer that was deleted, a theme flip for a top
// bar that no longer exists, a cloud filename for a Drive sync that is gone —
// each one reading as if it still mattered, each one a place a future change
// could be made to no effect.
//
// Every sale/*.js is a plain <script> in one global scope, so a top-level
// function is reachable from any other file and from the page's own
// on*="…" attributes. That is the whole search space: a name declared at
// column 0 must appear somewhere else — another script, the same script, or
// sale/index.html — or it is dead and this fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_FILES } from './_app-source.mjs';

// The load order from _app-source.mjs, plus the four scripts the page loads
// after it (each an IIFE, but any top-level function they add is in scope too).
const SCRIPTS = [...APP_FILES, 'site/sale/finance.js', 'site/sale/coach.js', 'site/sale/nextstep.js', 'site/sale/coverage.js'];

// Reached some other way than by name in these files. Keep this tiny, and say
// how each one is reached.
const REACHED_ELSEWHERE = new Map([
    // Nothing in the app calls either of these; each is pinned by a test that
    // reads its source. Delete the function and its line in that test together.
    ['coachSay', 'tests/site.test.mjs reads its body to enumerate guide milestones'],
    ['ckRrule', 'tests/checkups-core.test.mjs asserts it delegates to SJ_CK'],
]);

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('every top-level function in the sale scripts is referenced somewhere', () => {
    const sources = SCRIPTS.map((rel) => ({ rel, src: read(rel) }));
    const html = read('site/sale/index.html');
    const everything = sources.map((s) => s.src).join('\n') + '\n' + html;

    const declared = [];
    for (const { rel, src } of sources) {
        src.split('\n').forEach((line, i) => {
            const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
            if (m) declared.push({ rel, line: i + 1, name: m[1] });
        });
    }
    assert.ok(declared.length > 500, 'the declaration scan found almost nothing — did the files move?');

    const declCount = new Map();
    for (const d of declared) declCount.set(d.name, (declCount.get(d.name) || 0) + 1);

    const dead = [];
    for (const d of declared) {
        if (REACHED_ELSEWHERE.has(d.name)) continue;
        const re = new RegExp('(?<![\\w$])' + d.name.replace(/\$/g, '\\$') + '(?![\\w$])', 'g');
        const mentions = (everything.match(re) || []).length;
        // Every mention beyond the declaration(s) themselves is a reference —
        // a call, a window.name = alias, an onclick="name()" in the page.
        if (mentions - declCount.get(d.name) === 0) dead.push(`${d.rel}:${d.line} ${d.name}`);
    }
    assert.deepEqual(dead, [], 'top-level functions that nothing references — delete them, or say in REACHED_ELSEWHERE how they are reached');

    // The allow-list may not outlive the function it excuses.
    for (const name of REACHED_ELSEWHERE.keys()) {
        assert.ok(declCount.has(name), `REACHED_ELSEWHERE lists ${name}, which is no longer declared`);
    }
});
