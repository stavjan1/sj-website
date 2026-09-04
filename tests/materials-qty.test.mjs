// The quantity trap.
//
// The pricing prompt used to ask for materials as {name, price, details:"15 מטר"}
// — no qty. Rows landed without one, matQty() read that as 1, and the catalogue
// pass then swapped the price for the supplier's UNIT price: a 15-metre run of
// 5x6 cable was priced as 1 × 17.54 ₪. These pin the model that fixes it —
// price is per unit, qty and unit are explicit, the line is qty × price — on
// the source as shipped, through node:vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readApp } from './_app-source.mjs';

const app = readApp();

function slice(from, to, fromRx) {
    const a = fromRx ? app.search(from) : app.indexOf(from);
    const b = app.indexOf(to, a);
    assert.ok(a > -1 && b > a, `source moved: ${from}`);
    return app.slice(a, b);
}

function load(ctxExtra = {}) {
    const ctx = vm.createContext({
        Number, String, Object, Math, Array, JSON, RegExp, console,
        appState: { settings: {} },
        showToast: () => {}, saveProjects: () => {}, touchProject: () => {},
        renderMaterialsChecklist: () => {}, renderPricingEngine: () => {},
        pricingRefreshMaterials: () => {},
        document: { getElementById: () => null },
        ...ctxExtra,
    });
    vm.runInContext(
        // matQty / matUnit / matLineTotal — the table's own arithmetic.
        slice('const MATERIAL_UNITS =', 'function openPricingTable')
        + '\n' + slice('function projectMaterialsCost(proj)', 'function ensureProjectPricing')
        // the parser, the row builder and the catalogue pass
        + '\n' + slice('const QTY_UNIT_RX =', 'function applyMaterialsFromResponse')
        + '\n' + slice('async function catalogPriceMaterials(proj)', 'function renderWizardScope')
        + '\n;globalThis.api = { parseQtyFromDetails, parseUnitFromDetails, materialRowFromModel,'
        + ' catalogPriceMaterials, matQty, matUnit, matLineTotal, projectMaterialsCost };',
        ctx);
    return ctx.api;
}

test('a quantity is read out of the free-text details', () => {
    const { parseQtyFromDetails, parseUnitFromDetails } = load();
    assert.equal(parseQtyFromDetails('15 מטר'), 15);
    assert.equal(parseQtyFromDetails("15 מ'"), 15);
    assert.equal(parseQtyFromDetails('x3'), 3);
    assert.equal(parseQtyFromDetails("3 יח'"), 3);
    assert.equal(parseQtyFromDetails('כ-20 מטר'), 20);
    assert.equal(parseQtyFromDetails('כבל 5x6, 15 מטר, תוואי חיצוני'), 15,
        'the cable size must not be mistaken for the count');
    assert.equal(parseQtyFromDetails('גליל 100 מ'), 100);
    assert.equal(parseQtyFromDetails('2.5 מטר'), 2.5);
    assert.equal(parseQtyFromDetails('1,5 מטר'), 1.5);
    assert.equal(parseQtyFromDetails('מא"ז 16A x 3'), 3);
    // Not quantities: a rating, a cross-section, a cable size, nothing at all.
    assert.equal(parseQtyFromDetails('40A'), 1);
    assert.equal(parseQtyFromDetails('2.5 ממ"ר'), 1);
    assert.equal(parseQtyFromDetails('כבל 3x2.5'), 1);
    assert.equal(parseQtyFromDetails(''), 1);
    assert.equal(parseQtyFromDetails(undefined), 1);

    assert.equal(parseUnitFromDetails('15 מטר'), 'מטר');
    assert.equal(parseUnitFromDetails("15 מ'"), 'מטר');
    assert.equal(parseUnitFromDetails("3 יח'"), "יח'");
    assert.equal(parseUnitFromDetails('1 גליל'), 'גליל');
    assert.equal(parseUnitFromDetails('x3'), '');
});

test('a row that carries qty is a unit price times a count', () => {
    const { materialRowFromModel, matLineTotal, matQty, matUnit } = load();
    const row = materialRowFromModel({ name: 'כבל 5x6', qty: 15, unit: 'מטר', price: 28, details: 'תוואי חיצוני' });
    assert.equal(matQty(row), 15);
    assert.equal(matUnit(row), 'מטר');
    assert.equal(row.price, 28, 'the unit price is stored as written');
    assert.equal(matLineTotal(row), 420);
    assert.equal(row.checked, true);
    // A stored tick survives a re-price of the same line.
    assert.equal(materialRowFromModel({ name: 'x', qty: 1, price: 5 }, { checked: false }).checked, false);
});

test('the old shape (no qty) keeps its line total and learns its count from the details', () => {
    // Pre-4.9 the prompt said "a price per item, then sum them", so the price
    // was the line. The line must not double: 15 metres at "420" stays 420.
    const { materialRowFromModel, matLineTotal, matQty, matUnit } = load();
    const row = materialRowFromModel({ name: 'כבל 5x6', price: 420, details: '15 מטר' });
    assert.equal(matQty(row), 15);
    assert.equal(matUnit(row), 'מטר');
    assert.equal(matLineTotal(row), 420, 'the model\'s line total was doubled');
    assert.equal(row.price, 28, 'the unit price is total ÷ qty');
    // No quantity anywhere → one unit at the written price.
    const one = materialRowFromModel({ name: 'ממסר פחת', price: 87, details: '40A' });
    assert.equal(matQty(one), 1);
    assert.equal(one.price, 87);
});

test('a catalogue price replaces the UNIT price and the line is still qty × unit', async () => {
    // The money bug itself: 15 metres, catalogue says 17.54 per metre.
    const { materialRowFromModel, catalogPriceMaterials, matLineTotal, projectMaterialsCost } = load({
        fetch: async () => ({ ok: true, json: async () => ({ items: [
            { matched: true, price: 17.54, unit: 'מטר', sku: 'C56', catalogName: 'כבל N2XY 5X6' },
        ] }) }),
    });
    const proj = { pricing: {}, materials: [
        materialRowFromModel({ name: 'כבל 5x6', qty: 15, unit: 'מטר', price: 28, details: '' }),
    ] };
    await catalogPriceMaterials(proj);
    const m = proj.materials[0];
    assert.equal(m.price, 17.54);
    assert.equal(m.qty, 15, 'the catalogue pass dropped the count');
    assert.equal(m.fromCatalog, true);
    assert.equal(Math.round(matLineTotal(m) * 100) / 100, 263.1, 'the line must be 15 × the unit price');
    assert.equal(Math.round(projectMaterialsCost(proj) * 100) / 100, 263.1);
    assert.equal(Math.round(proj.pricing.materialsCost * 100) / 100, 263.1);
});

test('a legacy row with no qty is re-counted from its details when the catalogue prices it', async () => {
    // Projects saved before the fix carry {name, price, details:"15 מטר"} and
    // nothing else. Re-pricing one of those must not become 1 × unit again.
    const { catalogPriceMaterials, matLineTotal } = load({
        fetch: async () => ({ ok: true, json: async () => ({ items: [
            { matched: true, price: 17.54, unit: 'מטר' },
        ] }) }),
    });
    const proj = { pricing: {}, materials: [{ name: 'כבל 5x6', price: 420, details: '15 מטר', checked: true }] };
    await catalogPriceMaterials(proj);
    assert.equal(proj.materials[0].qty, 15);
    assert.equal(proj.materials[0].unit, 'מטר');
    assert.equal(Math.round(matLineTotal(proj.materials[0]) * 100) / 100, 263.1);
});

test('the prompt asks for qty, unit and a per-unit price', () => {
    // The schema the model answers to. If this line goes back to a
    // details-only shape the parser above becomes the only defence.
    const schema = /"qty": 15, "unit": "מטר", "price": 25/.test(app);
    assert.ok(schema, 'the materials schema in the pricing prompt no longer names qty/unit');
    assert.ok(/qty × price/.test(app), 'the prompt no longer says the line is qty × price');
});
