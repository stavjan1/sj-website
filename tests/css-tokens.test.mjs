// A design token that does not exist does not fall back — it deletes the
// declaration.
//
// `padding-block-end: calc(var(--sp-5) + env(safe-area-inset-bottom))` looks
// exactly like the twenty lines around it. But the scale is 1,2,3,4,6,8,12,16:
// there is no --sp-5. A var() that resolves to nothing makes the property
// "invalid at computed-value time", so the whole declaration is thrown away and
// the property falls back to inherited-or-initial — 0px here — which ALSO threw
// away the safe-area padding the shorthand above it had set. Nothing warns. The
// stylesheet is valid. The only symptom is a row sitting under the phone's
// browser bar, which is the bug this test was written next to.
//
// So: every token referenced anywhere must be defined somewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = ['assets/tokens.css', 'assets/ui.css', 'sale/css/panels.css', 'sale/css/shell.css',
                'sale/css/pdf.css', 'sale/controlroom.css', 'sale/nextstep.css', 'sale/periodic.css']
    .filter((f) => existsSync(join(ROOT, f)));
const CSS = SHEETS.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');

test('every design token that is used is also defined', () => {
    const defined = new Set();
    for (const m of CSS.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    // Tokens JS sets at runtime on the root element, which no stylesheet declares.
    for (const f of ['sale/app.js', 'sale/chat.js']) {
        if (!existsSync(join(ROOT, f))) continue;
        const src = readFileSync(join(ROOT, f), 'utf8');
        for (const m of src.matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) defined.add(m[1]);
    }

    const used = new Map();
    for (const m of CSS.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
        // var(--x, fallback) survives an undefined --x; var(--x) does not.
        if (m[2] === ',') continue;
        if (!used.has(m[1])) used.set(m[1], true);
    }

    const missing = [...used.keys()].filter((t) => !defined.has(t)).sort();
    assert.deepEqual(missing, [],
        'these tokens are used with no fallback and never defined — every declaration using them is silently dropped');
});

test('the spacing scale is what the code thinks it is', () => {
    // The specific trap: --sp-5 and --sp-7 read as if they exist because their
    // neighbours do. Pin the real scale so a reader can check before typing.
    const scale = [...new Set([...CSS.matchAll(/--sp-(\d+)\s*:/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    assert.deepEqual(scale, [1, 2, 3, 4, 6, 8, 12, 16],
        'the spacing scale changed — the gaps in it are load-bearing, since a missing step silently deletes declarations');
});
