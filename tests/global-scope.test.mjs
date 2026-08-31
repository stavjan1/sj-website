// Every sale/*.js is a plain <script> — no modules, ONE shared global scope. So
// two files declaring the same top-level `const` is a SyntaxError, and a
// SyntaxError does not fail that line: it kills the WHOLE FILE.
//
// This happened. c30d9c1 added `const HE_MONTHS` to app.js for the VAT reminder
// while admin.js had declared one since forever. app.js won the race, admin.js
// died in full, and NOTHING on screen said so — every function in app.js was
// present, the page rendered, and only the browser console knew that the admin
// panel no longer existed. It was found by reading the console during a smoke
// check, not by any test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_FILES } from './_app-source.mjs';

// A top-level declaration is one at column 0 — anything indented is inside a
// function or a block and cannot collide.
const TOP_LEVEL = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;

function declarationsIn(src) {
    const names = new Map();
    src.split('\n').forEach((line, i) => {
        const m = line.match(TOP_LEVEL);
        if (!m) return;
        if (!names.has(m[1])) names.set(m[1], i + 1);
    });
    return names;
}

test('no two app files declare the same name at top level', () => {
    const perFile = APP_FILES.map((rel) => ({
        rel,
        decls: declarationsIn(readFileSync(new URL('../' + rel, import.meta.url), 'utf8')),
    }));

    const owner = new Map();
    const clashes = [];
    for (const { rel, decls } of perFile) {
        for (const [name, line] of decls) {
            const prev = owner.get(name);
            // `function` redeclaration is legal and merely shadows; `const`,
            // `let` and `class` are the fatal ones. We cannot tell the kind from
            // the map alone, so flag every collision — a duplicated top-level
            // name across two files is worth removing whatever its keyword.
            if (prev) clashes.push(`${name}: ${prev.rel}:${prev.line} and ${rel}:${line}`);
            else owner.set(name, { rel, line });
        }
    }
    assert.deepEqual(clashes, [],
        'two files declare the same top-level name — in one shared global scope that is a SyntaxError, and it kills the whole file');
});
