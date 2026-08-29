// The pricing table is where the conversation's list becomes a price, so the
// arithmetic behind it is the arithmetic of the quote. These pin it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readApp().replace(/\r\n/g, '\n');

function load(catalog = [], book = {}, rules = {}) {
    const pbStart = app.indexOf('function _pbKey(name)');
    const pbEnd = app.indexOf('const MATERIAL_UNITS =');
    const ptStart = app.indexOf('const MATERIAL_UNITS =');
    const ptEnd = app.indexOf('function openPricingTable');
    const qStart = app.indexOf('function quoteBuildMode(proj)');
    // Anchored with the optional `async`, because the slice ends AT this index:
    // matching only the `function` keyword left a bare `async` dangling off the
    // end of the extracted source the moment ptToQuote learned to await.
    const qEnd = app.search(/(?:async\s+)?function ptToQuote\(\)/);
    assert.ok(pbStart > -1 && ptStart > -1, 'the pricing helpers moved or were renamed');
    const ctx = vm.createContext({
        appState: { settings: { priceBook: book, pricingRules: rules } },
        showToast: () => {},
        heNum: (n) => Number(n || 0).toLocaleString('he-IL'),
        saveProjects: () => {},
        touchProject: () => {},
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        persistSettings: () => {},
        priceCatalog: catalog,
        document: { getElementById: () => null },
        Date, Number, String, Object, Math, Array, JSON,
    });
    // The rules live elsewhere in the file; the sandbox gets the same defaults.
    vm.runInContext(`function getPricingRules() { return Object.assign(
        { materialMarkup: 20, defaultRate: 300, ratePresets: [200,300,500], complexityMult: 1.3,
          urgencyUrgent: 1.5, urgencyRush: 2, riskPct: 10, defaultDailyTarget: 1500,
          dayRate: 2000, hoursPerDay: 8, dayRounding: 'full', laborMode: 'sum' },
        (appState.settings && appState.settings.pricingRules) || {}); }`, ctx);
    return vm.runInContext(
        app.slice(pbStart, pbEnd) + '\n' + app.slice(ptStart, ptEnd) + '\n' + app.slice(qStart, qEnd)
        + '\n;({ matQty, matUnit, matLineTotal, laborItems, syncLaborPrice, pricingTotals, priceBookSet,'
        + ' projectExtras, QUOTE_EXTRAS, quoteItemsFromTable, hoursToDays, rowPrice, laborSummary,'
        + ' extraState, setExtraState, extraLineTotal, laborMode, MATERIAL_UNITS })',
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

test('only what is ticked reaches the total, and materials carry a margin', () => {
    const { pricingTotals } = load();
    const t = pricingTotals(proj());
    // COST is what he paid. It stays a cost, because the pricing engine reads
    // this field into materialsCost and a field named cost must hold one.
    assert.equal(Math.round(t.materials), 810, 'the unticked stand should not be in there');
    // PRICE is what the customer pays. Materials used to reach the quote at
    // cost, which made the electrician a delivery service for his supplier:
    // "אני לא מוכר פחת ב-168 ₪, זה מה ששילמתי עליו." The markup rule already
    // existed (materialMarkup, 20%) and was simply never applied on this path.
    assert.equal(Math.round(t.materialsPrice), 971, 'materials reach the quote at cost again');
    assert.equal(t.markup, 20, 'the default materials markup is gone');
    assert.equal(t.labor, 2200);
    assert.equal(t.extras, 600, 'the inspector is on, at its suggested price');
    // The customer is quoted the PRICE; `cost` is kept alongside so the margin
    // is a number the product can show rather than one it hides.
    assert.equal(Math.round(t.total), 3771);
    assert.equal(Math.round(t.cost), 3610);
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
    const items = quoteItemsFromTable({ ...proj(), quoteBuild: 'detailed' });
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
    assert.equal(quoteItemsFromTable({ materials: [], laborItems: [], extras: {}, quoteBuild: 'detailed' }).length, 0);
    assert.equal(quoteItemsFromTable({ materials: [], laborItems: [], extras: {} }).length, 0, 'komplet has nothing to sell either');
});

// ── Pricing by time ─────────────────────────────────────────────────────────
// Stav's own arithmetic, which is the point of the feature: "לקנות זה שעתיים,
// לנסוע ולחזור שעתיים, עבודה 5, יוצא יום וחצי, ואני רוצה 2,000 יומית, אז אני
// גובה 4,000 מעל החומרים."
const dayProject = () => ({
    materials: [],
    laborMode: 'days',
    laborItems: [
        { name: 'קניות אצל הספק', mode: 'hours', qty: 2 },
        { name: 'נסיעות הלוך וחזור', mode: 'hours', qty: 2 },
        { name: 'עבודה באתר', mode: 'hours', qty: 5 },
    ],
    extras: {},
});

test('nine hours is two days, and two days is four thousand', () => {
    const { laborSummary, pricingTotals } = load();
    const lab = laborSummary(dayProject());
    assert.equal(lab.hours, 9);
    assert.equal(lab.days, 2, 'nine hours do not fit in one day, so they are billed as two');
    assert.equal(lab.total, 4000);
    assert.equal(pricingTotals(dayProject()).labor, 4000);
});

test('the rounding is a choice, and each choice is honest', () => {
    assert.equal(load().hoursToDays(9), 2, 'the default rounds up to a whole day');
    assert.equal(load([], {}, { dayRounding: 'half' }).hoursToDays(9), 1.5);
    assert.equal(load([], {}, { dayRounding: 'none' }).hoursToDays(9), 1.125);
    assert.equal(load([], {}, { hoursPerDay: 9 }).hoursToDays(9), 1, 'a nine-hour day makes nine hours one day');
});

test('hours and days price a row, and a sum stays a sum', () => {
    const { rowPrice } = load();
    assert.equal(rowPrice({ mode: 'hours', qty: 3 }), 900, '3 × 300 an hour');
    assert.equal(rowPrice({ mode: 'days', qty: 1.5 }), 3000, '1.5 × 2,000 a day');
    assert.equal(rowPrice({ mode: 'sum', price: 750 }), 750);
});

test('an extra can be time too, and a legacy boolean still means "on"', () => {
    const ctx = load();
    const proj = { extras: { inspector: true, travel: { on: true, mode: 'hours', qty: 2 } } };
    assert.equal(ctx.extraState(proj, 'inspector').on, true, 'the old shape must keep working');
    const travel = ctx.QUOTE_EXTRAS.find((x) => x.key === 'travel');
    assert.equal(ctx.extraLineTotal(proj, travel), 600, 'two hours at the hourly rate');
});

test('sold by the day, the customer sees days, not a per-line breakdown', () => {
    const { quoteItemsFromTable } = load();
    const items = quoteItemsFromTable({ ...dayProject(), quoteBuild: 'detailed' });
    assert.equal(items.length, 1, 'the labour is one line when it is sold by the day');
    assert.match(items[0].title, /2 ימי עבודה/);
    assert.equal(items[0].price, 4000);
    assert.match(items[0].description, /קניות אצל הספק/, 'what fills the days still belongs in the detail');
});

test('a material carries its unit, and defaults to a piece', () => {
    const { matUnit, MATERIAL_UNITS } = load();
    assert.equal(matUnit({}), MATERIAL_UNITS[0]);
    assert.equal(matUnit({ unit: 'מטר' }), 'מטר');
    assert.ok(MATERIAL_UNITS.includes('קומפלט'), 'קומפלט is how half his lines are sold');
});

test('a quote can be one line, and that line is his sentence', () => {
    // "לא שולחים ללקוח הצעה עם עלות חומרים, רושמים סעיף קומפלט."
    assert.match(app, /function quoteBuildMode/, 'the komplet/detailed choice is gone');
    assert.match(app, /if \(quoteBuildMode\(proj\) === 'komplet'\)/, 'the builder stopped honouring the choice');
    assert.match(app, /function rememberKomplet/, 'the wording is no longer remembered per job type');
});

test('the document itself is editable, and writes back through the form', () => {
    assert.match(app, /function applySheetEditing/, 'on-document editing is gone');
    assert.match(app, /function sheetSetItem/, 'a field on the page no longer writes into the row');
    assert.match(app, /function sheetAddRow/, 'the "+" that adds a row is gone');
    assert.match(app, /getWorkItemsFromForm\(true\)/, 'an empty row would have nowhere to be typed');
    assert.match(app, /function openClientPicker/, 'the client picker is gone');
    assert.match(app, /function pickNewClient/, 'adding a client from the picker is gone');
});

test('komplet sells the whole table as one line', () => {
    const { quoteItemsFromTable, pricingTotals } = load();
    const withName = { ...dayProject(), name: 'התקנת עמדת טעינה 22kW', quoteData: {} };
    const items = quoteItemsFromTable(withName);
    assert.equal(items.length, 1, 'one line is the whole point');
    assert.equal(items[0].title, 'התקנת עמדת טעינה 22kW');
    assert.equal(items[0].price, Math.round(pricingTotals(withName).total));
});
