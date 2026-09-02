// The insight tree behind its address: nothing but the key opens it, and the
// merge never loses a bubble to a stale copy or brings one back from the dead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { cleanTree, mergeTrees, validKey, keyHash, fallbackTitle, plausibleTitle } from '../functions/api/thing.js';

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
    assert.equal(t.nodes[0].c, 0, 'no colour is colour 0');
    assert.equal(cleanTree({ nodes: [{ id: 'z', c: 99 }] }).nodes[0].c, 7, 'a colour is one of eight');
    const recs = cleanTree({ nodes: [{ id: 'r', recs: Array.from({ length: 14 }, (_, i) => ({ id: 'r' + i, m: 'audio/webm', n: 1000, d: 61, tx: 'x'.repeat(5000) })) }] }).nodes[0].recs;
    assert.equal(recs.length, 10, 'at most ten notes per bubble');
    assert.equal(recs[0].tx.length, 4000, 'a transcript is clamped');
    assert.equal(cleanTree({ nodes: [{ id: 'q' }] }).nodes[0].recs.length, 0, 'no notes is an empty list, not undefined');
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
    // The microphone is off everywhere (the /* block) and on only under /thing/.
    assert.match(headers, /\/\*\n[^\n]*\n(?:[^\n]*\n)*?\s+Permissions-Policy: geolocation=\(\), microphone=\(\), camera=\(\)/, 'site-wide microphone must stay off');
    assert.match(headers, /\/thing\/\*\n\s+! Permissions-Policy\n\s+Permissions-Policy: [^\n]*microphone=\(self\)/, '/thing/ must be allowed to record');
    assert.ok(!existsSync(new URL('../mind/index.html', import.meta.url)), 'the old /mind/ page was left behind');
    assert.ok(!existsSync(new URL('../functions/api/mind.js', import.meta.url)), 'the old /api/mind was left behind');
});


test('with no engine at hand, the first words become the title, never a blank', () => {
    assert.equal(fallbackTitle('דקל הוא מחירון מכרז, לא שוק פרטי. ההוכחה: שיפוצים גבוה מבנייה ב-5% בלבד.'), 'דקל הוא מחירון מכרז, לא שוק');
    assert.equal(fallbackTitle('   '), '');
});

test('the tree opens without a signal: a worker caches its shell, never the API, and the CSP lets a local note play', () => {
    const sw = readFileSync(new URL('../thing/sw.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../thing/index.html', import.meta.url), 'utf8');
    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
    for (const f of ['/thing/', '/thing/index.html', '/thing/thing.js', '/assets/tokens.css']) assert.ok(sw.includes(`'${f}'`), `${f} missing from the offline shell`);
    assert.ok(/pathname\.startsWith\('\/api\/'\)\) return/.test(sw), 'the API must never be served from cache');
    assert.ok(/cache: 'reload'/.test(sw), 'a deploy must reach the phone on the next open');
    assert.ok(js.includes("serviceWorker.register('/thing/sw.js')"), 'the worker is never registered');
    assert.ok(html.includes('rel="manifest"') && existsSync(new URL('../functions/thing/manifest.webmanifest.js', import.meta.url)), 'no manifest — no icon on the phone');
    assert.ok(!existsSync(new URL('../thing/manifest.webmanifest', import.meta.url)), 'the static manifest would shadow the keyed one');
    assert.ok(/endsWith\('\.webmanifest'\)\) return/.test(sw), 'the worker must never serve a cached keyless manifest');
    assert.match(headers, /media-src 'self' blob:/, 'a note that only exists on the phone cannot play');
});

test('tabs: a bubble keeps its page, a line keeps its kind, and a deleted page frees its bubbles', () => {
    const t = cleanTree({
        pages: [{ id: 'p1', name: 'עבודה', u: 1 }, { name: 'no id' }],
        nodes: [{ id: 'a', p: 'p1', u: 1 }, { id: 'b', p: 'ghost', u: 1 }, { id: 'c', u: 1 }],
        edges: [{ a: 'a', b: 'b', k: 'x', u: 1 }, { a: 'a', b: 'c', k: 'anything', u: 1 }],
    });
    assert.deepEqual(t.pages.map((p) => p.id), ['p1']);
    assert.equal(t.nodes.find((n) => n.id === 'a').p, 'p1');
    assert.equal(t.nodes.find((n) => n.id === 'b').p, '', 'a page that does not exist is no page');
    assert.deepEqual(t.edges.map((e) => e.k).sort(), ['in', 'x'], 'a line is assigning unless it says it crosses');

    const cloud = { pages: [{ id: 'p1', name: 'עבודה', u: 1 }], nodes: [{ id: 'a', p: 'p1', u: 1 }], edges: [] };
    const phone = { pages: [], nodes: [{ id: 'a', p: 'p1', u: 1 }], edges: [], del: [{ id: 'page:p1', at: Date.now() }] };
    const m = mergeTrees(cloud, phone);
    assert.equal(m.pages.length, 0, 'the tombstone removed the page');
    assert.equal(m.nodes[0].p, '', 'its bubble survived, page-less');

    const renamed = mergeTrees({ pages: [{ id: 'p1', name: 'ישן', u: 1 }] }, { pages: [{ id: 'p1', name: 'חדש', u: 2 }] });
    assert.equal(renamed.pages[0].name, 'חדש', 'the newer name wins');
});

test('search: the page has a field and the script searches titles, bodies and transcripts across pages', () => {
    const html = readFileSync(new URL('../thing/index.html', import.meta.url), 'utf8');
    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    assert.ok(html.includes('id="q"') && html.includes('id="results"'), 'no search field or results list');
    assert.ok(/function bubbleHaystack[\s\S]*?n\.t[\s\S]*?n\.b[\s\S]*?r\.tx/.test(js), 'search must cover title, body and transcripts');
    assert.ok(/tree\.nodes\.filter\(matches\)/.test(js), 'search must run over every page, not only the open tab');
    assert.ok(/\\u0591-\\u05C7/.test(js), 'niqqud must not break a match');
});

test('a device without the address can join, keeps a backup, and every device polls the cloud', () => {
    const html = readFileSync(new URL('../thing/index.html', import.meta.url), 'utf8');
    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    assert.ok(html.includes('id="nokey"') && html.includes('id="nokey-input"'), 'no way to enter the address on a device that lacks it');
    assert.ok(/sj_thing_backup_/.test(js), 'joining must leave a local backup behind');
    assert.ok(/setInterval\([\s\S]*?cloudLoad\(\)[\s\S]*?POLL_MS\)/.test(js), 'devices must poll the cloud');
    assert.ok(/dirty = true;/.test(js) && /dirty = false;/.test(js), 'the poll must know whether this device has unsent changes');
    assert.ok(!/POLL_MS = [0-9]{1,4};/.test(js), 'polling faster than every few seconds would burn the KV write budget');
});

test('the home-screen icon carries the address: the manifest answers with the key in start_url', async () => {
    const { onRequestGet } = await import('../functions/thing/manifest.webmanifest.js');
    const res = await onRequestGet({ request: new Request('https://www.sj-eng.co.il/thing/manifest.webmanifest?k=' + 'a'.repeat(40)) });
    const m = await res.json();
    assert.equal(m.start_url, '/thing/#k=' + 'a'.repeat(40));
    const bare = await (await onRequestGet({ request: new Request('https://www.sj-eng.co.il/thing/manifest.webmanifest') })).json();
    assert.equal(bare.start_url, '/thing/', 'no key, no key');
    const bad = await (await onRequestGet({ request: new Request('https://www.sj-eng.co.il/thing/manifest.webmanifest?k=../x') })).json();
    assert.equal(bad.start_url, '/thing/', 'a malformed key is dropped, not echoed');
    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    assert.ok(/manifest\.webmanifest\?k=/.test(js), 'the page must point its manifest at the keyed one');
});

test('a fragment is not a title: "הצ" falls through to the next engine', () => {
    assert.ok(!plausibleTitle('הצ'));
    assert.ok(!plausibleTitle('הצגה'), 'one word is still not the three-to-six the prompt asks for');
    assert.ok(plausibleTitle('הצגה עצמית דרך שיחה'));
});

test('the bin: a deleted bubble waits 30 days with its lines, a restore beats the tombstone, an alive bubble is never in the bin', () => {
    const now = Date.now();
    const t = cleanTree({
        nodes: [{ id: 'alive', u: 1 }],
        trash: [
            { id: 'gone', t: 'נמחק', edges: [{ a: 'gone', b: 'alive', k: 'in' }], dAt: now - 1000 },
            { id: 'old', dAt: now - 40 * 24 * 3600 * 1000 },
            { id: 'alive', dAt: now },
        ],
    });
    assert.deepEqual(t.trash.map((x) => x.id), ['gone'], 'old entries expire; an alive bubble is not in the bin');
    assert.equal(t.trash[0].edges.length, 1, 'the bin keeps the lines');

    // Deleted on the phone (tombstone + bin) …
    const phone = { nodes: [{ id: 'b', u: 1 }], edges: [], del: [{ id: 'a', at: now - 500 }], trash: [{ id: 'a', t: 'A', dAt: now - 500 }] };
    // … the computer still has it, unedited:
    const desk = { nodes: [{ id: 'a', t: 'A', u: 1 }, { id: 'b', u: 1 }], edges: [] };
    const m1 = mergeTrees(phone, desk);
    assert.deepEqual(m1.nodes.map((n) => n.id), ['b'], 'the deletion holds');
    assert.deepEqual(m1.trash.map((x) => x.id), ['a'], 'and the bubble is in the bin');

    // Restored on the computer (a newer change):
    const restored = { nodes: [{ id: 'a', t: 'A', u: now }, { id: 'b', u: 1 }], edges: [], trash: [] };
    const m2 = mergeTrees(m1, restored);
    assert.ok(m2.nodes.some((n) => n.id === 'a'), 'the restore wins over the tombstone');
    assert.equal(m2.trash.length, 0, 'and it leaves the bin');

    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../thing/index.html', import.meta.url), 'utf8');
    assert.ok(/function restoreFromTrash/.test(js) && /function purgeFromTrash/.test(js) && /function emptyTrash/.test(js));
    assert.ok(html.includes('id="trash"') && html.includes('id="btn-trash"'), 'the bin has no door');
});

test('three small things: an untitled bubble shows its first words, a tapped line has a delete button, and the map zooms far out', () => {
    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../thing/index.html', import.meta.url), 'utf8');
    assert.ok(/firstWords\(n\) \|\| 'ללא כותרת'/.test(js), 'the label must fall back to the body before "ללא כותרת"');
    assert.ok(html.includes('id="edge-del"') && /function deleteSelectedEdge/.test(js), 'no delete button for a line');
    assert.ok(!/confirm\(`למחוק את הקו/.test(js), 'the line dialog should be gone');
    const min = Number((js.match(/MIN_ZOOM = ([0-9.]+)/) || [])[1]);
    assert.ok(min > 0 && min <= 0.1, 'the map must zoom out well past the old 0.25');
    assert.ok(!/Math\.max\(0\.(15|25),/.test(js), 'a leftover hard-coded zoom floor');
});

test('choosing many: a selection box, a whole tree by Ctrl or from the sheet, and they move together', () => {
    const js = readFileSync(new URL('../thing/thing.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../thing/index.html', import.meta.url), 'utf8');
    assert.ok(html.includes('id="marquee"') && html.includes('id="btn-marquee"'), 'no selection box or its phone button');
    assert.ok(/type: 'marquee'/.test(js) && /ev\.shiftKey \|\| marqueeMode/.test(js), 'Shift-drag or the mode must start a box');
    assert.ok(/function connectedTo/.test(js) && /function pickTree/.test(js), 'no way to grab a whole tree');
    assert.ok(/gesture\.group/.test(js), 'a picked group must move together');
    assert.ok(html.includes('onclick="pickTree()"'), 'the sheet must offer בחר את העץ');
});
