// The pricing table is where the conversation's list becomes a price, so the
// arithmetic behind it is the arithmetic of the quote. These pin it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8').replace(/\r\n/g, '\n');

function load(catalog = [], book = {}) {
    const pbStart = app.indexOf('function _pbKey(name)');
    const pbEnd = app.indexOf('function renderMaterialsChecklist');
    const ptStart = app.indexOf('function matQty(m)');
    const ptEnd = app.indexOf('function openPricingTable');
    const qStart = app.indexOf('function quoteItemsFromTable(proj)');
    const qEnd = app.indexOf('function ptToQuote()');
    assert.ok(pbStart > -1 && ptStart > -1, 'the pricing helpers moved or were renamed');
    const ctx = vm.createContext({
        appState: { settings: { priceBook: book } },
        persistSettings: () => {},
        priceCatalog: catalog,
        document: { getElementById: () => null },
        Date, Number, String, Object, Math, Array,
    });
    return vm.runInContext(
        app.slice(pbStart, pbEnd) + '\n' + app.slice(ptStart, ptEnd) + '\n' + app.slice(qStart, qEnd)
        + '\n;({ matQty, matLineTotal, laborItems, syncLaborPrice, pricingTotals, priceBookSet, projectExtras, QUOTE_EXTRAS, quoteItemsFromTable })',
        ctx);
}

const proj = () => ({
    materials: [
        { name: 'כבל 5x10', price: 28.9, qty: 25, checked: true },
        { name: 'ממסר פחת', price: 87, checked: true },
        { name: 'עמוד', price: 450, checked: false },
    ],
    laborPrice: 2200,
    laborItems: [{ name: 'השחלה', price: 700 }, { name: 'התקנה', price: 900 }, { name: 'לוח', price: 600 }],
    extras: { inspector: true },
});

test('a quantity multiplies, and a missing one means one', () => {
    const { matQty, matLineTotal } = load();
    assert.equal(matQty({ price: 10 }), 1, 'no quantity should price a single unit');
    assert.equal(matQty({ qty: 0 }), 1, 'zero is not a quantity anyone means');
    assert.equal(matLineTotal({ price: 28.9, qty: 25 }), 722.5);
});

test('only what is ticked reaches the total', () => {
    const { pricingTotals } = load();
    const t = pricingTotals(proj());
    assert.equal(Math.round(t.materials), 810, 'the unticked stand should not be in there');
    assert.equal(t.labor, 2200);
    assert.equal(t.extras, 600, 'the inspector is on, at its suggested price');
    assert.equal(Math.round(t.total), 3610);
});

test('an extra priced by him beats the suggestion, everywhere', () => {
    const { pricingTotals, priceBookSet } = load();
    priceBookSet('בדיקת חשמלאי בודק', 800);
    assert.equal(pricingTotals(proj()).extras, 800);
});

test('labour that was one number becomes one line, and the sum stays in step', () => {
    const { laborItems, syncLaborPrice } = load();
    const legacy = { laborPrice: 1500 };
    assert.deepEqual(JSON.parse(JSON.stringify(laborItems(legacy))), [{ name: 'עבודה', price: 1500 }]);
    legacy.laborItems.push({ name: 'עבודת לוח', price: 600 });
    syncLaborPrice(legacy);
    assert.equal(legacy.laborPrice, 2100, 'proj.laborPrice must stay the sum — the quote reads it');

    const fresh = { laborPrice: 0 };
    assert.equal(laborItems(fresh).length, 0, 'a project with no labour should not invent a line');
});

test('the table hands the quote whole lines, not a lump sum', () => {
    // The writer prompt must carry the labour breakdown and the extras as their
    // own lines; a customer reads "עבודת לוח 600", not one number.
    assert.match(app, /const laborLines = laborItems\(proj\)/, 'the quote stopped reading the labour lines');
    assert.match(app, /פירוט העבודה/, 'the labour breakdown no longer travels with the quote');
});

test('an item the catalog does not have can be put into it', () => {
    // His question: what happens to a line the chat knows and ארכה does not.
    assert.match(app, /function ptSaveToCatalog/, 'the save-to-catalog button is gone');
    assert.match(app, /priceCatalog\.unshift\(\{ name: m\.name\.trim\(\), price/, 'saving no longer writes the item');
    // And the reverse: adding from the catalog respects a price he already set.
    assert.match(app, /const mine = priceBookGet\(it\.name\);/, 'the catalog add ignores his own price');
});

test('the quote is built from the rows, in the order a customer reads them', () => {
    const { quoteItemsFromTable } = load();
    const items = quoteItemsFromTable(proj());
    const titles = items.map((x) => x.title);

    // Labour first: that is the work being bought.
    assert.deepEqual(JSON.parse(JSON.stringify(titles.slice(0, 3))), ['השחלה', 'התקנה', 'לוח']);
    // Then the materials, as one section with the list inside it.
    assert.equal(titles[3], 'חומרים וציוד');
    assert.equal(items[3].price, 810, 'the materials section is priced by the table');
    assert.match(items[3].description, /כבל 5x10 × 25/, 'quantities belong in the description');
    assert.doesNotMatch(items[3].description, /עמוד/, 'an unticked material must not reach the quote');
    // And each extra as its own line, never folded into the installation price.
    assert.equal(titles[4], 'בדיקת חשמלאי בודק');
    assert.equal(items[4].price, 600);
    assert.match(items[4].description, /סעיף נפרד/);

    const sum = items.reduce((s, x) => s + x.price, 0);
    assert.equal(sum, 3610, 'the sections must add up to the table total');
});

test('an empty section carries no filler text to a customer', () => {
    // "אין פירוט לסעיף זה" used to print under every labour line.
    assert.doesNotMatch(app, /\|\| 'אין פירוט לסעיף זה'/, 'the placeholder is back in the PDF');
});

test('nothing is built from an empty table', () => {
    const { quoteItemsFromTable } = load();
    assert.equal(quoteItemsFromTable({ materials: [], laborItems: [], extras: {} }).length, 0);
});
