// Stav's rulings of 4.9.2026 for the quote screen, pinned:
//   - consumables are an automatic 5% line on labour + materials, per project,
//     switchable off, and a quote already sent does not grow by 5% on deploy;
//   - a private customer reads the total INCLUDING VAT as the big number, a
//     business reads the net;
//   - what blocks a price lives behind a quiet "הערות" button, never in the
//     chat or on the main screen; the toolbox behind "כלים וחומרים".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readApp().replace(/\r\n/g, '\n');
const html = readFileSync(join(ROOT, 'site', 'sale', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

// The pricing-table slice, the same way tests/pricing-table.test.mjs loads it.
function loadTable() {
    const pbStart = app.indexOf('function _pbKey(name)');
    const pbEnd = app.indexOf('const MATERIAL_UNITS =');
    const ptStart = app.indexOf('const MATERIAL_UNITS =');
    const ptEnd = app.indexOf('function openPricingTable');
    const qStart = app.indexOf('function quoteBuildMode(proj)');
    const qEnd = app.search(/(?:async\s+)?function ptToQuote\(\)/);
    assert.ok(pbStart > -1 && ptStart > -1 && qStart > -1 && qEnd > -1, 'the pricing helpers moved or were renamed');
    const ctx = vm.createContext({
        appState: { settings: { priceBook: {}, pricingRules: {} } },
        showToast: () => {}, saveProjects: () => {}, touchProject: () => {}, persistSettings: () => {},
        heNum: (n) => Number(n || 0).toLocaleString('he-IL'),
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        priceCatalog: [],
        Date, Number, String, Object, Math, Array, JSON,
    });
    vm.runInContext(`function getPricingRules() { return Object.assign(
        { materialMarkup: 20, defaultRate: 300, ratePresets: [200,300,500], complexityMult: 1.3,
          urgencyUrgent: 1.5, urgencyRush: 2, riskPct: 10, defaultDailyTarget: 1500,
          dayRate: 2000, hoursPerDay: 8, dayRounding: 'full', laborMode: 'sum' },
        (appState.settings && appState.settings.pricingRules) || {}); }`, ctx);
    return vm.runInContext(
        app.slice(pbStart, pbEnd) + '\n' + app.slice(ptStart, ptEnd) + '\n' + app.slice(qStart, qEnd)
        + '\n;({ pricingTotals, consumablesPct, quoteItemsFromTable, CONSUMABLES_DEFAULT_PCT })',
        ctx);
}

// The totals layout of the quote editor: pure functions, no DOM.
function loadTotals() {
    const start = app.indexOf('function quoteVatSplit(');
    const end = app.indexOf('function renderQuoteTotals(');
    assert.ok(start > -1 && end > start, 'the totals layout moved or was renamed');
    const ctx = vm.createContext({ Number, String, Math, Object });
    return vm.runInContext(
        'const VAT_RATE = 0.18; const VAT_PCT = 18;\n'
        + 'function formatPriceString(v) { return String(v).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }\n'
        + app.slice(start, end) + '\n;({ quoteVatSplit, quoteTotalsLayout, customerTypeOf })',
        ctx);
}

// 2,200 labour + 971 materials (809.5 cost + 20%) + 600 inspector; the 5% is
// on 3,171.4, which is 158.57.
const job = (extra = {}) => ({
    materials: [
        { name: 'כבל 5x10', price: 28.9, qty: 25, checked: true },
        { name: 'ממסר פחת', price: 87, checked: true },
    ],
    laborPrice: 2200,
    laborItems: [{ name: 'השחלה', price: 700 }, { name: 'התקנה', price: 900 }, { name: 'לוח', price: 600 }],
    extras: { inspector: true },
    ...extra,
});

test('consumables: 5% of labour + materials, its own row, and the extras stay out of it', () => {
    const { pricingTotals } = loadTable();
    const t = pricingTotals(job({ consumablesPct: 5 }));
    assert.equal(t.consumablesPct, 5);
    assert.equal(Math.round(t.consumables * 100) / 100, 158.57, '5% of 971.4 + 2,200');
    assert.equal(Math.round(t.total), 3930, 'the line is in the total');
    assert.equal(Math.round(t.cost), 3610, 'it is income, not a cost he paid');
});

test('consumables: off is off, and the percentage is his within 0–15', () => {
    const { pricingTotals, consumablesPct } = loadTable();
    assert.equal(pricingTotals(job({ consumablesPct: 0 })).consumables, 0);
    assert.equal(Math.round(pricingTotals(job({ consumablesPct: 0 })).total), 3771);
    assert.equal(consumablesPct({ consumablesPct: 12 }), 12);
    assert.equal(consumablesPct({ consumablesPct: 40 }), 15, 'nothing above 15');
    assert.equal(consumablesPct({ consumablesPct: -3 }), 0, 'nothing below 0');
});

test('a draft without the field gets 5%; a sent quote keeps what it was sent with', () => {
    const { consumablesPct, pricingTotals, CONSUMABLES_DEFAULT_PCT } = loadTable();
    assert.equal(CONSUMABLES_DEFAULT_PCT, 5, 'Stav chose 5');
    assert.equal(consumablesPct({}), 5, 'no status is a draft');
    assert.equal(consumablesPct({ status: 'טיוטה' }), 5);
    // Sent, done and paid quotes predate the field: their total is a number a
    // customer holds, so the missing field reads as nothing added.
    for (const status of ['נשלח', 'הושלם', 'שולם']) {
        assert.equal(consumablesPct({ status }), 0, `a ${status} quote must not grow by 5% overnight`);
        assert.equal(Math.round(pricingTotals(job({ status })).total), 3771);
    }
    // And a sent quote that HAD the line keeps its stored value, not the default.
    assert.equal(consumablesPct({ status: 'נשלח', consumablesPct: 8 }), 8);
    assert.equal(consumablesPct({ status: 'נשלח', consumablesPct: 0 }), 0, 'switched off stays off');
});

test('the quote carries the consumables as a separate line, in both build modes', () => {
    const { quoteItemsFromTable, pricingTotals } = loadTable();
    const detailed = quoteItemsFromTable(job({ consumablesPct: 5, quoteBuild: 'detailed' }));
    const last = detailed[detailed.length - 1];
    assert.match(last.title, /חומרי עזר, קיבוע ומתכלים \(5%\)/, 'the line is not on the quote');
    assert.equal(last.price, 159);
    const sum = detailed.reduce((a, x) => a + x.price, 0);
    const total = Math.round(pricingTotals(job({ consumablesPct: 5 })).total);
    assert.ok(Math.abs(sum - total) <= detailed.length, `lines sum to ${sum}, total is ${total}`);

    const komplet = quoteItemsFromTable(job({ consumablesPct: 5, name: 'החלפת לוח', quoteData: {} }));
    assert.equal(komplet.length, 2, 'komplet is one line plus the consumables line');
    assert.equal(komplet[0].title, 'החלפת לוח');
    assert.match(komplet[1].title, /חומרי עזר/);
    assert.equal(komplet[0].price + komplet[1].price, total);

    const off = quoteItemsFromTable(job({ consumablesPct: 0, name: 'החלפת לוח', quoteData: {} }));
    assert.equal(off.length, 1, 'switched off, komplet is one line again');
});

test('the switch is in the materials header and the row is in the totals', () => {
    const i = app.indexOf('function renderPricingTable()');
    const fn = app.slice(i, app.indexOf('function ptInCatalog', i));
    assert.match(fn, /setConsumablesOn\(this\.checked\)/, 'the on/off switch is gone from the table');
    assert.match(fn, /setConsumablesPct\(this\.value\)/, 'the percentage is no longer editable');
    assert.match(fn, /max="\$\{CONSUMABLES_MAX_PCT\}"/, 'the percent box lost its ceiling');
    assert.match(fn, /class="ptf-cons"/, 'the consumables row is gone from the totals');
    assert.match(app, /function setConsumablesOn\(/);
    assert.match(app, /function setConsumablesPct\(/);
});

test('private: the big number is the total including VAT; business: the net', () => {
    const { quoteTotalsLayout } = loadTotals();
    const priv = quoteTotalsLayout(1000, 'exclude', 'private');
    assert.equal(priv.big, 1180);
    assert.match(priv.bigLabel, /כולל מע"מ/);
    assert.deepEqual(JSON.parse(JSON.stringify(priv.above.map((l) => l.value))), ['1,000 ש"ח', '180 ש"ח'], 'net and VAT sit above, smaller');
    assert.equal(priv.below.length, 0);

    const biz = quoteTotalsLayout(1000, 'exclude', 'business');
    assert.equal(biz.big, 1000);
    assert.match(biz.bigLabel, /לפני מע"מ/);
    assert.equal(biz.above.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(biz.below.map((l) => l.value))), ['180 ש"ח', '1,180 ש"ח'], 'VAT and gross follow the net');
    // The label that travels with finalPrice (the gross) must describe the gross.
    assert.match(biz.vatLabel, /כולל מע"מ 18%/);

    const inc = quoteTotalsLayout(1180, 'include', 'private');
    assert.equal(Math.round(inc.big), 1180);
    assert.equal(inc.above[0].value, '1,000 ש"ח', 'include peels the VAT out of the base');

    const exempt = quoteTotalsLayout(1000, 'exempt', 'private');
    assert.equal(exempt.big, 1000);
    assert.equal(exempt.above.length + exempt.below.length, 0, 'an עוסק פטור has no VAT lines');
});

test('the customer type defaults to private and survives the round trip', () => {
    const { customerTypeOf } = loadTotals();
    assert.equal(customerTypeOf({}), 'private');
    assert.equal(customerTypeOf({ customerType: 'business' }), 'business');
    assert.equal(customerTypeOf({ customerType: 'company' }), 'private', 'an unknown value is private');
    // syncCurrentQuoteToProject REPLACES quoteData with a fixed set of keys, so
    // the field must be in that set or the first keystroke forgets it.
    const i = app.indexOf('function syncCurrentQuoteToProject()');
    assert.match(app.slice(i, i + 2500), /customerType: appState\.currentQuote\.customerType/,
        'quoteData drops customerType on the next edit');
    // And the share link's payload carries it, for the customer page.
    const s = app.indexOf('async function shareQuoteLink()');
    assert.match(app.slice(s, s + 3000), /customerType: q\.customerType/, 'the /q/ snapshot has no customer type');
});

test('the sheet has the marks the layout writes into, and the chips sit by the client name', () => {
    const sheet = html.slice(html.indexOf('id="quote-pdf-sheet"'), html.indexOf('</footer>', html.indexOf('id="quote-pdf-sheet"')));
    for (const id of ['pdf-price-above', 'pdf-total-label', 'pdf-total-price', 'pdf-price-below', 'pdf-vat-label']) {
        assert.ok(sheet.includes(`id="${id}"`), `#${id} is missing from the A4`);
    }
    assert.ok(sheet.indexOf('id="pdf-price-above"') < sheet.indexOf('id="pdf-total-price"')
        && sheet.indexOf('id="pdf-total-price"') < sheet.indexOf('id="pdf-price-below"'),
        'above, big number, below — in that order');
    const create = html.slice(html.indexOf('id="panel-create"'), html.indexOf('id="quote-pdf-sheet"'));
    const name = create.indexOf('id="form-client-name"');
    const chips = create.indexOf('id="form-customer-type"');
    assert.ok(name > -1 && chips > name && chips - name < 900, 'the private/business chips are not next to the client name');
    assert.match(create, /setCustomerType\('private'\)/);
    assert.match(create, /setCustomerType\('business'\)/);
    assert.match(app, /function setCustomerType\(/);
});

test('the two quiet buttons live at the end of the pricing tab, with their panels and handlers', () => {
    const panel = html.slice(html.indexOf('id="panel-pricing"'), html.indexOf('id="panel-create"'));
    assert.ok(panel.indexOf('id="pricing-foot"') < panel.indexOf('id="btn-pricing-notes"'), 'הערות comes after the totals');
    assert.match(panel, /id="btn-pricing-notes"[^>]*onclick="openPricingNotes\(\)"/);
    assert.match(panel, /id="btn-pricing-tools"[^>]*onclick="openPricingTools\(\)"/);
    assert.match(panel, /<aside[^>]*id="pricing-notes"/, 'the notes panel is missing');
    assert.match(panel, /<aside[^>]*id="pricing-tools"/, 'the tools panel is missing');
    assert.match(panel, /id="pricing-notes-text"[^>]*onchange="savePricingNotes\(this\.value\)"/, 'free text is not saved');
    // Three panels since Wave E: notes, tools, and the materials picker.
    assert.equal((panel.match(/onclick="closePricingSide\(\)"/g) || []).length, 3, 'each panel needs its close button');
    for (const fn of ['openPricingNotes', 'openPricingTools', 'closePricingSide', 'savePricingNotes']) {
        assert.match(app, new RegExp(`function ${fn}\\(`), `${fn} is not defined`);
    }
    // Escape closes, and notesFor() is optional — the panel must not depend on it.
    assert.match(app, /e\.key === 'Escape'\) closePricingSide\(\)/, 'Escape no longer closes the panel');
    assert.match(app, /typeof notesFor !== 'function'/, 'the notes panel would throw without coverage.js');
    assert.match(app, /proj\.notes = String\(value/, 'the free text is not stored on the project');
    // The panels are never shown unprompted: nothing opens them but their buttons.
    const opens = (app.match(/openPricingSide\('pricing-/g) || []).length;
    assert.equal(opens, 2, 'something else opens a pricing side panel');
});
