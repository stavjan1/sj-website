// The operating system does not speak for this product.
//
// confirm(), alert() and prompt() draw a grey slab titled "www.sj-eng.co.il
// אומר", in the browser's own language, with OK and Cancel on a question about
// deleting somebody's job — and none of it can be styled. Stav caught two
// unstyled controls in one day and asked why they keep coming back; they come
// back because nothing stops them. This does.
//
// The replacements live in app.js: askConfirm (a question), openNamePrompt (a
// short form), showLinkDialog (a value to copy). All three are plain functions
// on the global scope, so every file can reach them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_FILES, readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A call, not a mention: `.confirm(` is a method on something else, and the
// word inside a comment or a string is not a dialog.
const CALL = /(?<![.\w])(?:confirm|alert|prompt)\s*\(/;

function codeLines(src) {
    return src.split('\n').filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
}

test('no screen in the app hands a decision to the browser', () => {
    const offenders = [];
    for (const rel of APP_FILES) {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        codeLines(src).forEach((l) => {
            if (CALL.test(l) || l.includes('window.prompt(') || l.includes('window.confirm('))
                offenders.push(`${rel}: ${l.trim().slice(0, 70)}`);
        });
    }
    assert.deepEqual(offenders, [],
        'these lines put a browser dialog in front of the user — use askConfirm / openNamePrompt / showLinkDialog');
});

test('the replacements exist, and there is exactly one of each', () => {
    const app = readApp();
    for (const name of ['askConfirm', 'openNamePrompt', 'showLinkDialog', 'openPickerDialog']) {
        const n = app.split('function ' + name + '(').length - 1;
        assert.equal(n, 1, `${name} is defined ${n} times — a second definition silently wins`);
    }
});

test('askConfirm cannot answer yes on its own', () => {
    // Every caller is written as `if (!await askConfirm(...)) return;`, so a
    // dialog that resolved true when dismissed would delete somebody's work.
    // Escape, the backdrop and the close button all resolve FALSE, and only the
    // confirm button resolves true.
    const app = readApp();
    const i = app.indexOf('function askConfirm(');
    const body = app.slice(i, app.indexOf('\n}', i));
    assert.match(body, /\[data-a="yes"\]'\)\.onclick = \(\) => done\(true\)/, 'the confirm button is the only yes');
    assert.match(body, /addEventListener\('cancel'[\s\S]*?done\(false\)/, 'Escape is a no');
    assert.match(body, /addEventListener\('close'[\s\S]*?done\(false\)/, 'a dismissed dialog is a no');
    assert.equal((body.match(/done\(true\)/g) || []).length, 1, 'only one place may answer yes');
});

test('every await on a dialog sits inside a function that can await', () => {
    // Converting a caller means making it async. Missing that turns
    // `!await askConfirm(...)` into a syntax error at load — which would take
    // the whole file down, so it is worth a test that reads faster than a
    // browser reload.
    for (const rel of APP_FILES) {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        const lines = src.split('\n');
        let fnLine = null, isAsync = false, depth = 0;
        lines.forEach((l, n) => {
            const m = l.match(/^(\s*)(async\s+)?function\s+([A-Za-z_$][\w$]*)/);
            if (m && m[1].length === 0) { fnLine = m[3]; isAsync = !!m[2]; }
            if (/await askConfirm|await askNotice/.test(l) && fnLine && !isAsync) {
                // an inner async function/arrow between them is fine; only flag
                // when nothing async stands between the top-level one and here.
                const between = lines.slice(lines.findIndex((x) => x.includes('function ' + fnLine)), n).join('\n');
                if (!/async\s*(\(|function|[A-Za-z_$])/.test(between))
                    assert.fail(`${rel}:${n + 1} awaits a dialog inside non-async ${fnLine}()`);
            }
        });
    }
});
