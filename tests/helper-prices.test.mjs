// The helper screen's one rule that must never bend: another helper's number
// is shown only under a row you have already priced yourself. Shown before,
// the first price on the screen becomes everybody's price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { othersFor, summarize, slugify, SEED_ITEMS } from '../functions/api/helper-prices.js';

const ALL = {
    'stav@x.com':  { 'point-light': { price: 300 }, 'chase-block': { price: 700 } },
    'matan@x.com': { 'point-light': { price: 280 }, 'chase-block': { price: 650 }, 'point-ac': { price: 900 } },
    'yossi@x.com': { 'point-light': { price: 320 } },
};

test('others appear only for items the caller has priced', () => {
    const mine = { 'point-light': { price: 300 } };
    const out = othersFor(ALL, 'stav@x.com', mine);
    assert.deepEqual(Object.keys(out), ['point-light'], 'chase-block and point-ac must stay hidden — not priced by the caller in this call');
});

test('the caller never sees his own number counted among the others', () => {
    const out = othersFor(ALL, 'stav@x.com', { 'point-light': { price: 300 } });
    assert.equal(out['point-light'].n, 2);
    assert.equal(out['point-light'].low, 280);
    assert.equal(out['point-light'].high, 320);
});

test('an item only the caller has priced yields no others at all', () => {
    const out = othersFor(ALL, 'matan@x.com', { 'point-ac': { price: 900 } });
    assert.equal(out['point-ac'], undefined);
});

test('email matching is case-insensitive, so a capitalised login is still "me"', () => {
    const out = othersFor(ALL, 'Stav@X.com', { 'point-light': { price: 300 } });
    assert.equal(out['point-light'].n, 2);
});

test('the median, not the mean, so one extra zero does not move the room', () => {
    const s = summarize([250, 260, 270, 2600]);
    assert.equal(s.median, 265);
    assert.equal(s.n, 4);
    assert.equal(summarize([]), null);
    assert.equal(summarize(['x', -5, 0]), null);
});

test('slugs are stable and keep Hebrew', () => {
    assert.equal(slugify('נקודת מאור חדשה'), 'נקודת-מאור-חדשה');
    assert.equal(slugify('  חציבה בבטון (למטר) '), 'חציבה-בבטון-למטר');
    assert.equal(slugify('!!!'), '');
});

test('the seed list prices work, never materials, and every row has a unit', () => {
    for (const it of SEED_ITEMS) {
        assert.ok(it.id && it.name && it.unit, `seed row incomplete: ${JSON.stringify(it)}`);
        assert.ok(!/כבל|צינור|מפסק אוטומטי|חומר/.test(it.name), `looks like a material, not a job: ${it.name}`);
    }
    assert.equal(new Set(SEED_ITEMS.map((i) => i.id)).size, SEED_ITEMS.length, 'duplicate seed ids');
});

test('the screen exists in the shell, the offline cache and the rail', () => {
    const html = readFileSync(new URL('../sale/index.html', import.meta.url), 'utf8');
    const sw = readFileSync(new URL('../sale/sw.js', import.meta.url), 'utf8');
    assert.ok(html.includes('id="panel-helper"'), 'no helper panel in the markup');
    assert.ok(html.includes('id="tab-helper-rail"') && /id="tab-helper-rail"[^>]*hidden/.test(html), 'the rail button must start hidden — the server decides who sees it');
    assert.ok(/helper\.js\?v=\d+/.test(html), 'helper.js is not loaded');
    assert.ok(sw.includes('/sale/helper.js'), 'helper.js is missing from the offline shell');
});
