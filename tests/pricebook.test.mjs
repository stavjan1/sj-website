// The price book is the promise that the app stops arguing with him about his
// own prices: the agent suggests, he types once, and every later quote starts
// from his number. These pin the rules that make that true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8').replace(/\r\n/g, '\n');

function load() {
    const start = app.indexOf('function _pbKey(name)');
    const end = app.indexOf('function renderMaterialsChecklist');
    assert.ok(start > -1 && end > start, 'the price book moved or was renamed');
    const ctx = vm.createContext({
        appState: { settings: {} },
        persistSettings: () => {},
        Date, Number, String, Object, Math,
    });
    // `const` bindings do not become properties of the context, so the slice
    // hands them back explicitly.
    return vm.runInContext(
        app.slice(start, end) + '\n;({ QUOTE_EXTRAS, extraPrice, priceBookSet, priceBookGet, projectExtras })',
        ctx);
}

test('a price typed once is the price from then on', () => {
    const { priceBookSet, priceBookGet } = load();
    assert.equal(priceBookGet('בדיקת חשמלאי בודק'), null, 'nothing is remembered before he types');
    priceBookSet('בדיקת חשמלאי בודק', 800);
    assert.equal(priceBookGet('בדיקת חשמלאי בודק'), 800);
    // The same item written with different spacing is the same item.
    assert.equal(priceBookGet('  בדיקת   חשמלאי בודק '), 800);
});

test('clearing the field forgets the price instead of storing a zero', () => {
    const { priceBookSet, priceBookGet } = load();
    priceBookSet('הובלה ואספקה', 200);
    priceBookSet('הובלה ואספקה', '');
    assert.equal(priceBookGet('הובלה ואספקה'), null, 'an empty box should fall back to the suggestion');
});

test('an extra falls back to the suggested price until he overrides it', () => {
    const ctx = load();
    const inspector = ctx.QUOTE_EXTRAS.find((x) => x.key === 'inspector');
    assert.ok(inspector, 'the inspector line is gone');
    assert.equal(ctx.extraPrice(inspector), inspector.suggested);
    ctx.priceBookSet(inspector.label, 800);
    assert.equal(ctx.extraPrice(inspector), 800);
});

test('the extras a customer either wants or does not are all togglable lines', () => {
    const { QUOTE_EXTRAS } = load();
    const keys = QUOTE_EXTRAS.map((x) => x.key);
    assert.ok(keys.includes('inspector'), 'the inspector fee is not a separate line any more');
    for (const x of QUOTE_EXTRAS) {
        assert.ok(x.label && Number(x.suggested) > 0, `${x.key} has no suggested price`);
    }
});

test('the quote is told the extras are their own lines', () => {
    // Rolling the inspector into the installation price is exactly the mistake
    // this feature exists to prevent, so the writer prompt has to say so.
    assert.match(app, /שורה נפרדת בהצעה|שורה נפרדת\)/, 'the extras no longer travel as separate lines');
    assert.match(app, /const extrasOn = QUOTE_EXTRAS\.filter/, 'the quote stopped reading the extras');
});
