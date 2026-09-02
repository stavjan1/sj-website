// The insight tree: one owner, one document, newest wins — and nothing in a
// saved tree that the page does not read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanTree, newer } from '../functions/api/mind.js';

test('a tree keeps only bubbles and lines the page understands', () => {
    const t = cleanTree({
        nodes: [
            { id: 'a', t: 'כותרת', b: 'גוף', x: '10.6', y: 20, secret: 'x' },
            { id: 'b', t: 'שנייה', x: 0, y: 0 },
            { t: 'no id' },
        ],
        edges: [
            { a: 'a', b: 'b' }, { a: 'b', b: 'a' },   // same line twice, either direction
            { a: 'a', b: 'a' },                       // a bubble to itself
            { a: 'a', b: 'zzz' },                     // a line to nowhere
        ],
        updatedAt: 5,
    });
    assert.equal(t.nodes.length, 2);
    assert.equal(t.nodes[0].x, 11, 'coordinates are rounded numbers');
    assert.equal(t.nodes[0].secret, undefined, 'unknown fields are dropped');
    assert.deepEqual(t.edges, [{ a: 'a', b: 'b' }]);
    assert.equal(t.updatedAt, 5);
});

test('titles and bodies are clamped, so a paste cannot grow the document without bound', () => {
    const t = cleanTree({ nodes: [{ id: 'a', t: 'x'.repeat(500), b: 'y'.repeat(9000) }] });
    assert.equal(t.nodes[0].t.length, 120);
    assert.equal(t.nodes[0].b.length, 4000);
});

test('the newer copy wins, and a missing side never wins', () => {
    const old = { updatedAt: 1 }, fresh = { updatedAt: 2 };
    assert.equal(newer(old, fresh), fresh);
    assert.equal(newer(fresh, old), fresh);
    assert.equal(newer(null, old), old);
    assert.equal(newer(old, null), old);
    assert.equal(newer(old, { updatedAt: 1 }), old, 'a tie keeps what is stored');
});

test('the page is private, revalidates, and carries the same asset version as the site', () => {
    const html = readFileSync(new URL('../mind/index.html', import.meta.url), 'utf8');
    const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
    const sale = readFileSync(new URL('../sale/index.html', import.meta.url), 'utf8');
    assert.match(html, /name="robots" content="noindex/, 'the tree must not be indexed');
    assert.ok(/\/mind\/\n\s+Cache-Control: no-cache/.test(headers), '/mind/ can be served stale after a deploy');
    const v = (s) => new Set([...s.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
    assert.deepEqual([...v(html)], [...v(sale)], 'mind/ is on a different asset version than the app');
});
