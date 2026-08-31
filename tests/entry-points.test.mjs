// Every way INTO the product, guarded at the source.
//
// This file exists because three of them were dead at once and nothing said so.
// They all failed the same way: each seeded a text input on the work list —
// #new-project-name — and bailed out with `if (!input) return` when it was not
// there. That input was deleted when the home screen became the way in, and the
// callers kept "working" in the sense that they threw no error and did nothing:
//
//   • createProjectFromHandoff — the entire /ask/ funnel. Someone prices a job
//     in the public chat, signs up, presses "המשך כפרויקט", and gets nothing.
//     That is the acquisition path for the whole product.
//   • ckCreateQuote — "צור הצעה" for a periodic-service client.
//   • startFirstProject — the empty state's own button.
//
// A silent no-op is the worst kind of break: no error, no log, and the user
// concludes the product is broken rather than that they mis-clicked. So the
// rule these tests hold is simple — an entry point passes its data as data, and
// never depends on an element existing somewhere else on the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();
const HTML = readFileSync(join(ROOT, 'sale', 'index.html'), 'utf8');

const bodyOf = (name) => {
    const i = APP.indexOf(`function ${name}(`);
    assert.notEqual(i, -1, `${name} should exist`);
    return APP.slice(i, APP.indexOf('\n}', i));
};

test('no entry point reaches for the input that was deleted', () => {
    // The element is genuinely gone from the markup...
    assert.ok(!/id="new-project-name"/.test(HTML), 'the input is not in the page');
    // ...so nothing may look it up. If it comes back, it comes back as markup
    // first, not as a lookup that quietly returns null.
    assert.ok(!/getElementById\(\s*['"]new-project-name['"]\s*\)/.test(APP),
        'no code looks up #new-project-name any more');
});

test('the /ask/ funnel creates the project from the handoff data itself', () => {
    const body = bodyOf('createProjectFromHandoff');
    assert.match(body, /createNewProject\(\s*\{/, 'it passes the job as an option');
    assert.ok(!/getElementById/.test(body.split('createNewProject')[0]),
        'and does not depend on any element existing before it can start');
});

test('a periodic-service client can still become a quote', () => {
    const body = bodyOf('ckCreateQuote');
    assert.match(body, /createNewProject\(\s*\{\s*name:/, 'the name travels as data');
});

test('the empty state points at the box that actually starts work', () => {
    const body = bodyOf('startFirstProject');
    assert.match(body, /home-input/, 'it focuses the home box');
    assert.match(HTML, /id="home-input"/, 'which exists');
});

test('createNewProject takes its name and its description as arguments', () => {
    const body = bodyOf('createNewProject');
    assert.match(body, /opts\.name/, 'the name is an option');
    assert.match(body, /opts\.describe/, 'so is the description');
    assert.match(body, /opts\.kind === 'ask'/, 'and so is what kind of thread it is');
});
