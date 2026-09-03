// SJ's price catalogue reaches the site in three places: the helper list, the
// pricing agent's prompt, and the catalogue view. All three read the same
// generated data, and none of it carries Dekel's own prices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SJ_ITEMS, SJ_GROUPS } from '../functions/api/_sj_catalog.js';

const book = JSON.parse(readFileSync(new URL('../sale/data/sj-prices.json', import.meta.url), 'utf8'));

test('the public price file is ours: decided prices, two modes, no Dekel numbers', () => {
    assert.ok(book.rows.length > 2000, 'the everyday catalogue is thousands of rows');
    assert.ok(book.decisions && book.decisions.visit && book.decisions.hourly_mode && book.decisions.chase, 'the decisions travel with the data');
    for (const r of book.rows) {
        assert.ok(r.id && r.name && r.unit && r.price > 0 && (r.mode === 'A' || r.mode === 'B'), `row incomplete: ${JSON.stringify(r).slice(0, 120)}`);
        assert.equal(r.dekel, undefined, 'a Dekel price leaked into the public file');
        assert.equal(r.raysdor_2026, undefined);
    }
    assert.ok(book.rows.some((r) => r.starter), 'no starter strip');
    assert.ok(book.rows.some((r) => r.basis === 'chase' && r.next_m), 'the chase curve is missing');
});

test('the helper list is work items only, each with our price, unique ids', () => {
    assert.ok(SJ_ITEMS.length > 500);
    assert.equal(new Set(SJ_ITEMS.map((i) => i.id)).size, SJ_ITEMS.length, 'duplicate ids');
    for (const it of SJ_ITEMS) assert.ok(it.id && it.name && it.unit && it.sj > 0 && it.group, `item incomplete: ${JSON.stringify(it)}`);
    assert.ok(SJ_GROUPS.length >= 10);
});

test('the three seams are wired', () => {
    const api = readFileSync(new URL('../functions/api/helper-prices.js', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../sale/app.js', import.meta.url), 'utf8');
    const chat = readFileSync(new URL('../sale/chat.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../sale/index.html', import.meta.url), 'utf8');
    const market = readFileSync(new URL('../sale/market.js', import.meta.url), 'utf8');
    assert.ok(/SJ_ITEMS\.concat\(custom\)/.test(api), 'the helper list must be the catalogue plus the helpers\' own items');
    assert.ok(/groups: SJ_GROUPS/.test(api), 'the helper response must carry the groups');
    assert.ok(/function getSjPriceBlock/.test(app) && /loadSjPrices\(\)/.test(app), 'the agent block is missing');
    assert.equal((chat.match(/getSjPriceBlock\(\)/g) || []).length, 2, 'the agent block must reach both prompt builders');
    assert.ok(html.includes('id="catalog-view-sj"') && /setCatalogView\('sj'\)/.test(html), 'no מחירון SJ tab');
    assert.ok(/function renderSjCatalog/.test(market) && /sjMode === 'B'/.test(market), 'the two modes are missing from the view');
});
