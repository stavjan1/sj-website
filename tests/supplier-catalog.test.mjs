// The 7,364-item supplier catalog reaches the person, not only the agent.
//
// It shipped in data/materials months ago and only functions/api/chat.js ever
// read it: the "הוספה מהמאגר" picker searched the user's own saved prices and
// told everyone who had not built one yet that the catalog was empty. These
// pin the two things that make the wiring safe to trust — that a price he
// typed himself still wins, and that a retail number never silently becomes
// his cost.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'sale', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function load(opts = {}) {
    const start = APP.indexOf('let _cpSupplier');
    const end = APP.indexOf('function renderMaterialsChecklist');
    assert.ok(start > -1 && end > start, 'the catalog picker moved or was renamed');
    const project = { id: 'p1', materials: [] };
    const saved = [];
    const ctx = createContext({
        appState: { settings: opts.settings || {} },
        persistSettings: () => {},
        priceCatalog: opts.catalog || [],
        priceBookGet: (name) => (opts.book && name in opts.book ? opts.book[name] : null),
        MATERIAL_UNITS: ["יח'", 'מטר', 'קומפלט'],
        _ptProj: () => project,
        _ptSave: (p) => saved.push(p),
        showToast: () => {},
        escapeHtml: (x) => String(x),
        heNum: (n) => String(n),
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        setTimeout, clearTimeout, fetch: async () => { throw new Error('offline'); },
        Number, String, Object, Array, Math, JSON,
    });
    const api = runInContext(
        APP.slice(start, end) +
        '\n;({ tradeDiscount, setTradeDiscount, tradePrice, ptAddFromSupplier, _cpSupplier, setItems: (x) => { _cpSupplier = { q: "q", items: x, loading: false, error: "", meta: null }; } })',
        ctx);
    return { ...api, project, ctx };
}

test('with no trade discount, the supplier price is the supplier price', () => {
    const { tradePrice, tradeDiscount } = load();
    assert.equal(tradeDiscount(), 0);
    assert.equal(tradePrice(17.54), 17.54);
});

test('the trade discount is what he pays, and it is clamped to something real', () => {
    const app = load();
    app.setTradeDiscount(20);
    assert.equal(app.tradePrice(17.54), 14.03);        // 17.54 − 20%, to the agora
    app.setTradeDiscount(200);
    assert.equal(app.tradeDiscount(), 60, 'nobody buys at a 200% discount');
    app.setTradeDiscount(-5);
    assert.equal(app.tradeDiscount(), 0);
    app.setTradeDiscount('לא מספר');
    assert.equal(app.tradeDiscount(), 0);
});

test('a supplier line carries retail as the suggestion and his cost as the price', () => {
    const app = load({ settings: { tradeDiscount: 25 } });
    app.setItems([{ sku: '5951160', name: 'כבל 5X6 FR N2XY', price: 20, unit: 'מטר' }]);
    app.ptAddFromSupplier(0);
    const row = app.project.materials[0];
    assert.equal(row.suggested, 20, 'the catalog price is the SUGGESTION, always');
    assert.equal(row.price, 15, 'what he pays is the discounted one');
    assert.equal(row.unit, 'מטר');
    assert.equal(row.source, 'supplier');
    assert.match(row.details, /5951160/, 'the SKU travels with the line, so it can be ordered');
});

test('a price he typed once beats the catalog, discount and all', () => {
    const app = load({ settings: { tradeDiscount: 25 }, book: { 'כבל 5X6 FR N2XY': 12.5 } });
    app.setItems([{ sku: '1', name: 'כבל 5X6 FR N2XY', price: 20, unit: 'מטר' }]);
    app.ptAddFromSupplier(0);
    assert.equal(app.project.materials[0].price, 12.5, 'the price book is the whole point');
    assert.equal(app.project.materials[0].suggested, 20);
});

test('a unit the table cannot draw is left off rather than faked', () => {
    // The catalog's units come from a supplier's product pages; the table has a
    // closed list. An unknown one must not become an invented row type.
    const app = load();
    app.setItems([{ sku: '1', name: 'סרט בידוד', price: 4, unit: 'גליל' }]);
    app.ptAddFromSupplier(0);
    assert.equal(app.project.materials[0].unit, undefined);
    assert.match(app.project.materials[0].details, /גליל/, 'but it is still written down');
});
