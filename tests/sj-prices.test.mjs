// SJ's price catalogue reaches the site in three places: the helper list, the
// pricing agent's prompt, and the catalogue view. All three read the same
// generated data, and none of it carries Dekel's own prices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SJ_ITEMS, SJ_GROUPS } from '../functions/api/_sj_catalog.js';

const book = JSON.parse(readFileSync(new URL('../sale/data/sj-prices.json', import.meta.url), 'utf8'));
const core = JSON.parse(readFileSync(new URL('../sale/data/sj-prices.core.json', import.meta.url), 'utf8'));

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

// The agent's prompt reads only the starter strip and the chase curve, so boot
// fetches sj-prices.core.json (a few KB) instead of the whole 685 KB book.
// The core file is generated from the full one by
// scripts/build_sj_prices_core.mjs; this fails when it was not regenerated.
test('the core file is exactly the agent slice of the full book, and has not drifted', () => {
    const expected = book.rows.filter((r) => r.starter === true || r.basis === 'chase');
    assert.deepEqual(core.rows, expected,
        'sale/data/sj-prices.core.json is stale — run node scripts/build_sj_prices_core.mjs');
    assert.ok(core.rows.length > 0 && core.rows.length < 200, 'the core slice must stay small');
    assert.deepEqual(core.decisions, book.decisions, 'the decisions must be the same in both files');
    assert.deepEqual(core.groups, book.groups);
    assert.deepEqual(core.subs, book.subs);
    assert.equal(core.version, book.version);
    const ids = new Set(book.rows.map((r) => r.id));
    for (const r of core.rows) assert.ok(ids.has(r.id), `core row ${r.id} is not in the full book`);
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

test('boot loads the core slice and waits for it before a money prompt; the view loads the full book apart', () => {
    const app = readFileSync(new URL('../sale/app.js', import.meta.url), 'utf8');
    const chat = readFileSync(new URL('../sale/chat.js', import.meta.url), 'utf8');
    const market = readFileSync(new URL('../sale/market.js', import.meta.url), 'utf8');
    assert.ok(/fetch\('data\/sj-prices\.core\.json'/.test(app), 'boot must fetch the core file, not the 685 KB book');
    assert.ok(!/fetch\('data\/sj-prices\.json'/.test(app), 'app.js must not fetch the full book');
    assert.ok(/function sjPricesSettled/.test(app), 'the settle helper is gone');
    // Every send path that builds a money prompt waits first: the planning
    // turn, the itemised quote, and the conversation (knowledgeFor).
    assert.equal((chat.match(/await sjPricesSettled\(\)/g) || []).length, 3,
        'each of the three prompt builders must await the price book before building');
    assert.ok(/fetch\('data\/sj-prices\.json'/.test(market), 'the catalogue view still loads the full book lazily');
    const marketCode = market.replace(/^\s*\/\/.*$/gm, '');   // comments may name the other book; code may not
    assert.ok(/sjPriceBookFull/.test(marketCode) && !/(?<![\w$])sjPriceBook(?![\w$])/.test(marketCode),
        'the view must keep the full book in its own variable, never the core slice');
});
