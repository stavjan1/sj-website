// Code that reaches for an element WITHOUT a guard, and the element it reaches for.
//
// `site/sale/app.js` contains this line, on the Google sign-in path:
//     let clientId = document.getElementById('lock-google-client-id').value.trim();
// No `?.`, no `if`, no fallback. The element is a hidden input in the markup —
// `<input type="hidden" id="lock-google-client-id">` — and there is a SECOND
// hidden input two screens away named `settings-drive-client-id`, which is
// genuinely dead. A sweep that deleted "the unused hidden client-id fields"
// would take the wrong one, and every Google user would meet
// "Cannot read properties of null" instead of the app. Nothing in the suite
// caught that: it is not a missing function, not a bad selector, not an
// unreachable screen. It is a null dereference that only happens in a browser.
//
// So: every id read without a guard must exist in the markup. That is the
// whole rule, and it is cheap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_FILES } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'site', 'sale', 'index.html'), 'utf8');

// Ids the app creates at runtime rather than shipping in the markup — the
// dialogs it builds, and anything a renderer writes into a container.
const RUNTIME_IDS = (() => {
    const set = new Set();
    for (const rel of APP_FILES) {
        if (!existsSync(join(ROOT, rel))) continue;
        const src = readFileSync(join(ROOT, rel), 'utf8');
        // dlg.id = 'x'  /  el.id = 'x'
        for (const m of src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) set.add(m[1]);
        // id="x" inside a template literal the app injects
        for (const m of src.matchAll(/\bid=["']([\w-]+)["']/g)) set.add(m[1]);
        // id="${...}" — built per row, unknowable statically; the prefix is enough
        for (const m of src.matchAll(/\bid=["']([\w-]+)-?\$\{/g)) set.add(m[1]);
    }
    return set;
})();

const MARKUP_IDS = (() => {
    const set = new Set();
    for (const m of HTML.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)) set.add(m[1]);
    return set;
})();

test('nothing is read off an element that may not be there', () => {
    // The dangerous shape only: getElementById('x') immediately followed by a
    // property access with no optional chaining. `const el = getElementById(x);
    // if (!el) return;` is the safe shape and is not flagged.
    const unguarded = [];
    for (const rel of APP_FILES) {
        if (!existsSync(join(ROOT, rel))) continue;
        const src = readFileSync(join(ROOT, rel), 'utf8');
        const lines = src.split('\n');
        lines.forEach((line, n) => {
            const t = line.trim();
            if (t.startsWith('//') || t.startsWith('*')) return;
            for (const m of line.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)\s*\./g)) {
                const id = m[1];
                if (MARKUP_IDS.has(id) || RUNTIME_IDS.has(id)) continue;
                unguarded.push(`${rel}:${n + 1} reads .${line.slice(m.index + m[0].length).slice(0, 14)} off #${id}`);
            }
        });
    }
    assert.deepEqual(unguarded, [],
        'these lines dereference an element that exists nowhere — in a browser that is a thrown TypeError, not a no-op');
});

test('the element the whole sign-in hangs on is still there', () => {
    // Named explicitly, because it is the one whose absence locks every Google
    // user out of the product, and because its near-namesake IS deletable.
    assert.match(HTML, /id="lock-google-client-id"/,
        'the hidden field the sign-in reads unguarded is gone — every Google user gets a TypeError instead of the app');
});
