// The helper screen's one rule that must never bend: another helper's number
// is shown only under a row you have already priced yourself. Shown before,
// the first price on the screen becomes everybody's price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { othersFor, summarize, slugify, SEED_ITEMS, helperCatalog, basicItems } from '../functions/api/helper-prices.js';

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
    const html = readFileSync(new URL('../site/sale/index.html', import.meta.url), 'utf8');
    const sw = readFileSync(new URL('../site/sale/sw.js', import.meta.url), 'utf8');
    assert.ok(html.includes('id="panel-helper"'), 'no helper panel in the markup');
    assert.ok(html.includes('id="tab-helper"') && /id="tab-helper"[^>]*hidden/.test(html), 'the rail button must start hidden — the server decides who sees it');
    assert.ok(/helper\.js\?v=\d+/.test(html), 'helper.js is not loaded');
    assert.ok(sw.includes('/sale/helper.js'), 'helper.js is missing from the offline shell');
});

// Review of the helper journey (4.9.2026): a friend gets sixteen everyday jobs
// first, the catalogue behind search, never a metre of cable or a monthly fee;
// a door of his own; a save that sticks on blur and shows.
test('the helper list is the basics first, the catalogue behind search, and no materials', () => {
    const basics = basicItems();
    assert.equal(basics.length, SEED_ITEMS.length);
    assert.ok(basics.every((it) => it.basic), 'basics are flagged so the client can put them first');
    assert.ok(basics.some((it) => it.unit === 'שעה'), 'the hourly rate is one of the basics');
    const cat = helperCatalog();
    assert.ok(cat.length > 500 && cat.every((it) => it.group !== 'cables' && !/חודש/.test(it.name)), 'cables and monthly fees are not work a friend can price');
    assert.ok(cat.every((it) => !it.starter), 'the catalogue no longer competes with the basics for the top of the screen');
    const ids = new Set([...basics, ...cat].map((it) => it.id)); assert.equal(ids.size, basics.length + cat.length, 'ids collide');
});
test('a friend has a door, a reason on the lock card, and a way in when he is not a helper yet', () => {
    const redirects = readFileSync(new URL('../site/_redirects', import.meta.url), 'utf8');
    assert.match(redirects, /^\/help\s+\/sale\/\?panel=helper\s+302/m, '/help must open the helper screen');
    const html = readFileSync(new URL('../site/sale/index.html', import.meta.url), 'utf8');
    assert.ok(html.includes('id="tab-helper"') && !html.includes('tab-helper-rail'), 'the rail button id must match #tab-<panel> so it lights up');
    assert.ok(html.includes('id="lock-helper-note"'), 'the lock card must say why the friend is here');
    assert.ok(html.includes('id="helper-privacy"'), 'who sees what must be written on the screen');
    const js = readFileSync(new URL('../site/sale/helper.js', import.meta.url), 'utf8');
    assert.ok(js.includes('function helperRequestCard') && js.includes('res.status === 403'), 'a 403 must render the request card, not nothing');
    assert.ok(js.includes('onblur="helperBlur(') && js.includes('helperFocusNext'), 'blur saves, Enter moves on');
    assert.ok(js.includes("mine && it.sj ?"), 'our price shows only after the friend wrote his own');
    const css = readFileSync(new URL('../site/sale/css/panels.css', import.meta.url), 'utf8');
    assert.ok(css.includes('.helper-row.has-price .helper-row-name::before'), 'a saved row must look saved');
    const app = readFileSync(new URL('../site/sale/app.js', import.meta.url), 'utf8');
    // The admin gained a deep link of its own beside this one (?panel=admin),
    // so the line is matched by its helper half rather than verbatim.
    assert.ok(/const want = wantedPanel\(\);\s*switchTab\(want === 'helper' \? 'helper' :/.test(app), 'sign-in must land on the helper screen when asked');
});
