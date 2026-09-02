// The insight tree behind its address: nothing but the key opens it, and the
// merge never loses a bubble to a stale copy or brings one back from the dead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { cleanTree, mergeTrees, validKey, keyHash } from '../functions/api/thing.js';

test('only a long random key is a key', () => {
    assert.ok(validKey('a'.repeat(32)));
    assert.ok(!validKey('short'));
    assert.ok(!validKey('x'.repeat(32) + '/'), 'path characters are not part of a key');
    assert.ok(!validKey(''));
});

test('the record name is a hash, never the key', async () => {
    const h = await keyHash('some-long-random-key-abcdefghijklmnop');
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.ok(!h.includes('random'));
});

test('a tree keeps only bubbles, lines and tombstones the page understands', () => {
    const t = cleanTree({
        nodes: [{ id: 'a', t: 'x', b: 'y', x: '10.6', y: 20, u: 5, secret: 1 }, { t: 'no id' }],
        edges: [{ a: 'a', b: 'a' }, { a: 'a', b: 'zzz' }],
        del: [{ id: 'old', at: 1 }, { id: 'fresh', at: Date.now() }],
    });
    assert.equal(t.nodes.length, 1);
    assert.equal(t.nodes[0].x, 11);
    assert.equal(t.nodes[0].secret, undefined);
    assert.deepEqual(t.edges, []);
    assert.deepEqual(t.del.map((d) => d.id), ['fresh'], 'tombstones older than 90 days are dropped');
});

test('two devices editing different bubbles both keep their work', () => {
    const base = { nodes: [{ id: 'a', t: 'A', u: 1 }, { id: 'b', t: 'B', u: 1 }], edges: [{ a: 'a', b: 'b', u: 1 }] };
    const phone = { nodes: [{ id: 'a', t: 'A phone', u: 5 }, { id: 'b', t: 'B', u: 1 }], edges: [{ a: 'a', b: 'b', u: 1 }] };
    const desk = { nodes: [{ id: 'a', t: 'A', u: 1 }, { id: 'b', t: 'B desk', u: 6 }, { id: 'c', t: 'C', u: 6 }], edges: [{ a: 'a', b: 'b', u: 1 }, { a: 'b', b: 'c', u: 6 }] };
    const m = mergeTrees(mergeTrees(base, phone), desk);
    const byId = Object.fromEntries(m.nodes.map((n) => [n.id, n.t]));
    assert.deepEqual(byId, { a: 'A phone', b: 'B desk', c: 'C' });
    assert.equal(m.edges.length, 2);
});

test('a deletion is a tombstone: a stale copy cannot bring the bubble back', () => {
    const cloud = { nodes: [{ id: 'b', t: 'B', u: 1 }], edges: [], del: [{ id: 'a', at: Date.now() }] };
    const stale = { nodes: [{ id: 'a', t: 'A', u: 1 }, { id: 'b', t: 'B', u: 1 }], edges: [] };
    const m = mergeTrees(cloud, stale);
    assert.deepEqual(m.nodes.map((n) => n.id), ['b']);
});

test('an edit made after the deletion wins over the tombstone', () => {
    const now = Date.now();
    const cloud = { nodes: [], edges: [], del: [{ id: 'a', at: now - 1000 }] };
    const phone = { nodes: [{ id: 'a', t: 'A again', u: now }], edges: [] };
    assert.equal(mergeTrees(cloud, phone).nodes.length, 1);
});

test('merging a tree with itself changes nothing', () => {
    const t = cleanTree({ nodes: [{ id: 'a', t: 'A', u: 3 }, { id: 'b', t: 'B', u: 3 }], edges: [{ a: 'a', b: 'b', u: 3 }] });
    const m = mergeTrees(t, t);
    assert.equal(m.nodes.length, 2);
    assert.equal(m.edges.length, 1);
});

test('the page is private, needs no Google, revalidates, and /mind/ is gone', () => {
    const html = readFileSync(new URL('../thing/index.html', import.meta.url), 'utf8');
    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
    assert.match(html, /name="robots" content="noindex/);
    assert.ok(!/gsi\/client|google\.accounts/.test(html + js), 'the tree must not depend on a Google login');
    assert.ok(/\/thing\/\n\s+Cache-Control: no-cache/.test(headers));
    assert.ok(!existsSync(new URL('../mind/index.html', import.meta.url)), 'the old /mind/ page was left behind');
    assert.ok(!existsSync(new URL('../functions/api/mind.js', import.meta.url)), 'the old /api/mind was left behind');
});
