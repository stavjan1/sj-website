// Every field in the app is dressed by ONE rule in panels.css, and that rule is
// scoped to a list of containers: .content-panel, .ck-dialog, .convo-panel,
// .stern-drawer, .lock-card. Anything outside those five gets the browser's own
// control — a white box with a grey border, on a dark screen, looking like a
// different program opened on top of the app.
//
// This is written down because I shipped that mistake twice in one day. First
// the customer control on a work row (a native <select>, whose popup the OS
// draws and no stylesheet can reach), then the search box in the conversation
// list — a container I had just invented and never added to the rule. Stav
// caught both, and asked, fairly, why it kept happening.
//
// The cause is structural rather than careless: the rule names containers, so
// a NEW container is invisible to it and fails silently — it renders, it works,
// it just looks foreign. Nothing in the suite could see that. This test can:
// it reads the markup, finds every text field, works out which container it
// sits in, and fails if that container is not one the rule dresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'site', 'sale', 'css', 'panels.css'), 'utf8');
const HTML = readFileSync(join(ROOT, 'site', 'sale', 'index.html'), 'utf8');

// The containers the base rule actually covers, read out of the CSS rather than
// listed here — so this test cannot drift from the thing it guards.
const DRESSED = (() => {
    const i = CSS.indexOf('.content-panel input:not([type="checkbox"])');
    assert.notEqual(i, -1, 'the base field rule moved or was renamed');
    const selector = CSS.slice(i, CSS.indexOf('{', i));
    const names = new Set();
    for (const m of selector.matchAll(/\.([a-z][\w-]*)\s+(?:input|select|textarea)/g)) names.add(m[1]);
    return names;
})();

test('the base field rule still covers the containers it always did', () => {
    for (const c of ['content-panel', 'ck-dialog', 'lock-card']) {
        assert.ok(DRESSED.has(c), `${c} must stay dressed`);
    }
});

test('the conversation list is dressed — its search box was the second miss', () => {
    assert.ok(DRESSED.has('convo-panel'),
        '.convo-panel holds a search field and must be on the base rule');
});

test('a search field is not left to the browser to draw', () => {
    // type="search" is the one that bites: browsers give it their own inner
    // shadow and clear button on top of whatever the page says.
    assert.match(CSS, /input\[type="search"\][^{]*\{[^}]*appearance:\s*none/,
        'type=search must have its native chrome turned off');
});

test('every text field in the markup sits in a container the rule dresses', () => {
    // Walk the markup, and for each field look outwards for the nearest class
    // that the rule knows. A field in no dressed container is the bug this file
    // exists to catch.
    const offenders = [];
    const fieldRe = /<(input|textarea|select)\b([^>]*)>/g;
    for (const m of HTML.matchAll(fieldRe)) {
        const attrs = m[2];
        const type = (/type="([^"]+)"/.exec(attrs) || [])[1] || 'text';
        if (['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'submit', 'button'].includes(type)) continue;
        const before = HTML.slice(0, m.index);
        // The nearest enclosing element that carries one of the dressed classes.
        const covered = [...DRESSED].some((cls) => {
            const open = before.lastIndexOf(`class="${cls}`) !== -1
                || new RegExp(`class="[^"]*\\b${cls}\\b`).test(before.slice(-4000));
            return open;
        });
        if (!covered) {
            const id = (/id="([^"]+)"/.exec(attrs) || [])[1] || '(no id)';
            offenders.push(id);
        }
    }
    assert.deepEqual(offenders, [],
        'these fields are outside every dressed container and will render as browser defaults');
});
