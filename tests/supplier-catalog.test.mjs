// The 7,364-item supplier catalog reaches the person, not only the agent.
//
// It shipped in data/materials months ago and only functions/api/chat.js ever
// read it: the "הוספה מהמאגר" picker searched the user's own saved prices and
// told everyone who had not built one yet that the catalog was empty. These
// pin the two things that make the wiring safe to trust — that a price he
// typed himself still wins, and that a retail number never silently becomes
// his cost.
//
// Wave E moved the picker into the "＋ הוסף חומר" panel (mpAdd → mpCommit);
// the supplier path here is the merged list with one supplier result on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp().replace(/\r\n/g, '\n');

// Read out of the source, so the stub cannot drift from the app. A hardcoded
// copy lived here for months and guarded nothing: when גליל was added so pipe
// could be quoted by the coil, this file went on asserting that גליל is a unit
// the table cannot draw — the opposite of the truth — and stayed green. A guard
// holding its own copy of the thing it guards is decoration.
const MATERIAL_UNITS = (() => {
    const m = /const MATERIAL_UNITS = \[([^\]]*)\];/.exec(APP);
    assert.ok(m, 'MATERIAL_UNITS moved or was renamed');
    return m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').replace(/\\'/g, "'"));
})();

function load(opts = {}) {
    const start = APP.indexOf('let _cpSupplier');
    const end = APP.indexOf('// ── שורה חופשית');
    assert.ok(start > -1 && end > start, 'the catalog picker moved or was renamed');
    const project = { id: 'p1', materials: [] };
    const saved = [];
    const ctx = createContext({
        appState: { settings: opts.settings || {} },
        persistSettings: () => {},
        priceCatalog: opts.catalog || [],
        priceBookGet: (name) => (opts.book && name in opts.book ? opts.book[name] : null),
        _pbKey: (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80),
        matQty: (m) => (Number(m && m.qty) > 0 ? Number(m.qty) : 1),
        MATERIAL_UNITS,
        _ptProj: () => project,
        _ptSave: (p) => saved.push(p),
        showToast: () => {},
        escapeHtml: (x) => String(x),
        heNum: (n) => String(n),
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        setTimeout, clearTimeout, fetch: async () => { throw new Error('offline'); },
        Number, String, Object, Array, Math, JSON, Map, Set, Date,
    });
    const api = runInContext(
        APP.slice(start, end) +
        '\n;({ tradeDiscount, setTradeDiscount, tradePrice, ptAddFromSupplier: (i) => mpAdd(i), setItems: (x) => { _cpSupplier = { q: "q", items: x, loading: false, error: "", meta: null }; renderMatPicker(); } })',
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
    assert.equal(row.source, 'catalog');
    // The SKU still travels so the exact item can be re-ordered, but it is a
    // field now rather than words in the visible פירוט — a customer reading a
    // quote has no use for a supplier's part number (Stav, 28/08).
    assert.equal(row.sku, '5951160', 'the SKU travels with the line, so it can be ordered');
    assert.ok(!/5951160/.test(row.details), 'and never in the text anyone reads');
});

test('a price he typed once beats the catalog, discount and all', () => {
    const app = load({ settings: { tradeDiscount: 25 }, book: { 'כבל 5X6 FR N2XY': 12.5 } });
    app.setItems([{ sku: '1', name: 'כבל 5X6 FR N2XY', price: 20, unit: 'מטר' }]);
    app.ptAddFromSupplier(0);
    assert.equal(app.project.materials[0].price, 12.5, 'the price book is the whole point');
    assert.equal(app.project.materials[0].suggested, 20);
});

test('a unit the table CAN draw survives the import', () => {
    // גליל is the case that made this matter. The agent quotes pipe by the coil
    // now — shops do not sell 15 metres out of a 100m reel — so a coil arriving
    // from the supplier has to reach the row AS a coil, not be flattened to יח'
    // with the real unit buried in a note.
    assert.ok(MATERIAL_UNITS.includes('גליל'), 'גליל is a unit the table knows');
    const app = load();
    app.setItems([{ sku: '9', name: 'צינור מריכף 20', price: 180, unit: 'גליל' }]);
    app.ptAddFromSupplier(0);
    assert.equal(app.project.materials[0].unit, 'גליל');
});

test('a unit the table cannot list still reaches the row as itself', () => {
    // The catalog's units come from a supplier's product pages; the table has a
    // closed list, but it draws a unit off the list as its own option (the
    // "אחר…" path), so nothing is flattened to יח' or buried in a note.
    const unknown = 'צרור';
    assert.ok(!MATERIAL_UNITS.includes(unknown), 'the example must be a unit the app really lacks');
    const app = load();
    app.setItems([{ sku: '1', name: 'סרט בידוד', price: 4, unit: unknown }]);
    app.ptAddFromSupplier(0);
    assert.equal(app.project.materials[0].unit, unknown);
    assert.equal(app.project.materials[0].details, '');
});
