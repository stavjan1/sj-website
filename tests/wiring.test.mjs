// Twice now a merge has deleted a function while leaving its callers behind —
// once the admin's Telegram screen (the card sat on "טוען…" forever), once a
// coach hook called from the middle of creating a project. Neither failed at
// build time, because JavaScript only complains when the line finally runs.
//
// So: collect every global the app declares across its scripts, then collect
// every global the markup and the code promise to call, and require the second
// set to be inside the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// Everything the app page loads, in load order.
const SCRIPTS = ['site/sale/app.js', 'site/sale/chat.js', 'site/sale/checkups.js', 'site/sale/market.js',
    'site/sale/reports.js', 'site/sale/admin.js', 'site/sale/helper.js', 'site/sale/finance.js', 'site/sale/coach.js',
    'site/sale/nextstep.js', 'site/assets/listcards.js'];
const MARKUP = 'site/sale/index.html';

function declaredGlobals(src) {
    const names = new Set();
    for (const m of src.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) names.add(m[1]);
    for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
    return names;
}

const declared = new Set();
for (const f of SCRIPTS) for (const n of declaredGlobals(read(f))) declared.add(n);

// Browser and library globals the markup is allowed to lean on.
const AMBIENT = new Set([
    'window', 'document', 'event', 'this', 'alert', 'confirm', 'print', 'open',
    'location', 'history', 'navigator', 'localStorage', 'sessionStorage',
    'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object',
    'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'google', 'html2pdf',
    'returnValue', 'getComputedStyle', 'setInterval', 'clearInterval', 'fetch',
    'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN',
]);

// Language, not API.
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'delete', 'await']);

test('every handler in the markup points at a function that exists', () => {
    const html = read(MARKUP);
    const missing = new Set();
    // onclick="foo(…)" / onchange="bar(…)" / oninput="baz(…)" …
    for (const m of html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/g)) {
        const code = m[1];
        for (const call of code.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
            const name = call[1];
            if (code[call.index - 1] === '.') continue;   // a method on something else
            if (KEYWORDS.has(name) || AMBIENT.has(name) || declared.has(name)) continue;
            missing.add(name);
        }
    }
    assert.deepEqual([...missing], [],
        'the markup calls these, and nothing defines them: ' + [...missing].join(', '));
});

test('the app never calls one of its own globals that no longer exists', () => {
    // Only the names this project owns: a call to a name we declare SOMEWHERE
    // is fine, a call to a name matching our naming conventions that is declared
    // NOWHERE is the deletion this test exists to catch.
    // The verb list is this test's weakness, and it was measured: a sweep
    // deleted nineteen functions one at a time and ran the whole suite after
    // each — FOURTEEN passed in silence, because their names began with sync,
    // resolve, find, clear, connect or handle and none of those were listed.
    // Every verb this codebase actually starts a global with is listed now.
    const ours = /\b((?:render|admin|coach|acct|maint|ck|pipeline|pipe|market|fin|switch|show|save|load|open|close|toggle|set|get|update|refresh|export|import|sync|resolve|find|clear|connect|handle|apply|build|create|delete|remove|start|stop|run|check|ensure|schedule|promote|pick|ask|price|quote|report|filter|count|format|parse|copy|send|scan|detect|upload|recover|restore|manual|smart|assign)[A-Z][\w$]*)\s*\(/g;
    const missing = new Map();
    // Prose mentions functions by name ("setDate() is defined by the browser"),
    // and prose is not a call site.
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const f of SCRIPTS) {
        const src = stripComments(read(f));
        for (const m of src.matchAll(ours)) {
            const name = m[1];
            if (declared.has(name) || AMBIENT.has(name)) continue;
            // Method calls (x.renderFoo()) belong to objects, and a name that
            // appears in some function's parameter list is a local, not ours.
            const before = src[m.index - 1];
            if (before === '.') continue;
            if (new RegExp('function\\s+\\w+\\([^)]*\\b' + name + '\\b').test(src)) continue;
            if (!missing.has(name)) missing.set(name, f);
        }
    }
    assert.deepEqual([...missing.keys()], [],
        'called but never defined: ' + [...missing].map(([n, f]) => `${n} (in ${f})`).join(', '));
});
