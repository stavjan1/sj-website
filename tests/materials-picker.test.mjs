// "＋ הוסף חומר" — the materials list by hand, without the chat.
//
// Stav (5.9.2026): "במקום שהרכיבים יהיו רק דרך הצ'אט — שיהיה אפשר פשוט להזין
// לסל את המוצרים." The chat stays a door; this is the other one. These pin the
// rules that make the picker safe to trust: the order of the three sources,
// that a second add of the same item is more of it and not a twin row, that a
// number he typed survives the catalogue pass, that the shelf of recent items
// stays twenty and never repeats, and that the panel is actually wired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readApp } from './_app-source.mjs';

const app = readApp();
const html = readFileSync(new URL('../site/sale/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(new URL('../site/sale/css/panels.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function slice(from, to) {
    const a = app.indexOf(from);
    const b = app.indexOf(to, a);
    assert.ok(a > -1 && b > a, `source moved: ${from}`);
    return app.slice(a, b);
}

// Values built inside the vm carry its own Array/Object prototypes, which
// strict deepEqual compares; a JSON round-trip compares the shape only.
const plain = (v) => JSON.parse(JSON.stringify(v));
const pbKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
const matQty = (m) => (Number(m && m.qty) > 0 ? Number(m.qty) : 1);

// The pure helpers, on fakes: no DOM, no storage, no fetch.
function loadPure(extra = {}) {
    const ctx = vm.createContext({
        Number, String, Object, Math, Array, JSON, Map, Set, Date, RegExp,
        _pbKey: pbKey, matQty,
        appState: { settings: {} }, persistSettings: () => {},
        priceCatalog: [], priceBookGet: () => null,
        ...extra,
    });
    vm.runInContext(
        slice('let _cpSupplier', '// ── The panel ──')
        + '\n;globalThis.api = { mpSameItem, mpIsSkuQuery, mpMergeSources, mpRowFromPick, mpAddRow, mpPushRecent, mpMyPrice, tradePrice, MP_RECENT_MAX };',
        ctx);
    return ctx.api;
}

// ── 1. The three sources, in their order ────────────────────────────────────
test('his prices come first, then the shelf, then the supplier — and one item shows once', () => {
    const { mpMergeSources } = loadPure();
    const rows = mpMergeSources({
        q: 'מאז',
        mine: [{ name: 'מאז 3x25', price: 40, unit: "יח'" }],
        recent: [
            { name: 'מאז 3x25', price: 38, sku: '', origin: 'catalog' },          // same name as his → dropped
            { name: 'מאז 1x16', price: 12, sku: '7001', origin: 'catalog' },
        ],
        supplier: [
            { sku: '7001', name: 'מאז 1x16 C', price: 15, unit: "יח'" },           // same sku as the shelf → dropped
            { sku: '7002', name: 'מאז 3x32', price: 60, unit: "יח'" },
        ],
        myPrice: () => null,
        toCost: (r) => r * 0.8,
    });
    assert.deepEqual(plain(rows.map((r) => [r.name, r.source, r.group])), [
        ['מאז 3x25', 'mine', 'mine'],
        ['מאז 1x16', 'recent', 'recent'],
        ['מאז 3x32', 'catalog', 'supplier'],
    ]);
    assert.equal(rows[0].price, 40, 'his catalogue price, as is');
    assert.equal(rows[2].price, 48, 'the supplier line costs him retail less the discount');
    assert.equal(rows[2].suggested, 60, 'and retail stays on it as the suggestion');
});

test('a supplier line he already has a price for is shown at HIS price and says so', () => {
    const { mpMergeSources } = loadPure();
    const rows = mpMergeSources({
        q: 'כבל', mine: [], recent: [],
        supplier: [{ sku: '5951160', name: 'כבל 5X6 FR N2XY', price: 20, unit: 'מטר' }],
        myPrice: (name) => (name === 'כבל 5X6 FR N2XY' ? 12.5 : null),
        toCost: (r) => r,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'mine');
    assert.equal(rows[0].price, 12.5);
    assert.equal(rows[0].suggested, 20, 'retail is still there to compare against');
});

test('with the search empty the shelf comes first; a typed word filters every source', () => {
    const { mpMergeSources } = loadPure();
    const recent = [{ name: 'שקע כפול', price: 30, sku: '', origin: 'free' }, { name: 'תעלה 40', price: 9, sku: '', origin: 'catalog' }];
    const mine = [{ name: 'מאז 3x25', price: 40 }, { name: 'תעלה 40', price: 7 }];
    const empty = mpMergeSources({ q: '', mine, recent, supplier: [] });
    assert.deepEqual(plain(empty.map((r) => [r.name, r.group])), [['שקע כפול', 'recent'], ['מאז 3x25', 'mine'], ['תעלה 40', 'mine']],
        'the shelf is the one-tap list, so it is on top — but a name his catalogue has is his, at his price');
    assert.equal(empty[2].price, 7);
    assert.equal(empty[0].source, 'free', 'a free row on the shelf stays his number when it comes back');
    const typed = mpMergeSources({ q: 'תעלה', mine: [{ name: 'שקע', price: 1 }], recent, supplier: [] });
    assert.deepEqual(plain(typed.map((r) => r.name)), ['תעלה 40']);
});

test('the same item is the SKU when both sides have one, else the name', () => {
    const { mpSameItem, mpMergeSources } = loadPure();
    assert.equal(mpSameItem({ name: 'מאז 3X32A', sku: '' }, { name: 'מאז 3X32A', sku: '7004' }), true,
        'his catalogue rarely carries SKUs — the supplier line with the same name is the same item');
    assert.equal(mpSameItem({ name: 'מאז 3X32A', sku: '7004' }, { name: 'מאז 3X32A', sku: '7005' }), false,
        'two supplier products sharing a name but not a number stay two');
    assert.equal(mpSameItem({ name: '', sku: '' }, { name: '', sku: '' }), false, 'nothing is the same as nothing');
    // Seen in the browser: the row showed twice, once from his list and once from the supplier.
    const rows = mpMergeSources({ q: 'מאז', mine: [{ name: 'מאז 3X32A C 6kA', price: 39 }], recent: [],
        supplier: [{ sku: '7004', name: 'מאז 3X32A C 6kA', price: 52 }], myPrice: () => null, toCost: (r) => r });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'mine');
});

test('a run of digits is a part number', () => {
    const { mpIsSkuQuery } = loadPure();
    assert.equal(mpIsSkuQuery('5951160'), true);
    assert.equal(mpIsSkuQuery('3x25'), false);
    assert.equal(mpIsSkuQuery('16'), false, 'two digits is an amperage, not a SKU');
    assert.match(app, /mpIsSkuQuery\(q\) \? 'sku=' \+ encodeURIComponent\(q\) : 'q=' \+ encodeURIComponent\(q\)/,
        'a SKU query must hit the endpoint by sku');
});

test('his own price is the price book first, then his catalogue by exact name — never a loose match', () => {
    const { mpMyPrice } = loadPure({
        priceBookGet: (n) => (n === 'כבל 5x6' ? 17 : null),
        priceCatalog: [{ name: 'מאז 3x25', price: 40 }],
    });
    assert.equal(mpMyPrice('כבל 5x6'), 17);
    assert.equal(mpMyPrice('מאז 3x25'), 40);
    assert.equal(mpMyPrice('מאז 3x25 שניידר'), null, 'a longer supplier name must not borrow his price for a different product');
});

// ── 2. Adding: same shape as the chat, and a second add is more of it ───────
test('a pick becomes the row the chat makes: name, qty, unit, unit price, details, checked, plus sku and source', () => {
    const { mpRowFromPick } = loadPure();
    const row = mpRowFromPick({ name: 'מאז 3x25', unit: "יח'", price: 40, suggested: 48, sku: '7003', source: 'catalog' }, '3');
    assert.deepEqual(plain(row), {
        name: 'מאז 3x25', qty: 3, unit: "יח'", price: 40, suggested: 48, sku: '7003',
        source: 'catalog', checked: true, details: '',
    });
    assert.equal(mpRowFromPick({ name: 'x', price: 1 }, 0).qty, 1, 'a zero count is one');
    assert.equal(mpRowFromPick({ name: 'x', price: 1, source: 'whatever' }, 1).source, 'free', 'an unknown source is a free row');
});

test('the same sku a second time adds to the line instead of a twin row', () => {
    const { mpRowFromPick, mpAddRow } = loadPure();
    const list = [];
    const first = mpAddRow(list, mpRowFromPick({ name: 'מאז 3x25', price: 40, sku: '7003', source: 'catalog' }, 2));
    assert.equal(first.merged, false);
    const again = mpAddRow(list, mpRowFromPick({ name: 'מאז 3x25 (שם אחר)', price: 40, sku: '7003', source: 'catalog' }, 3));
    assert.equal(again.merged, true);
    assert.equal(list.length, 1, 'one row, not two');
    assert.equal(list[0].qty, 5, '2 + 3');
    // Without a sku the name is the identity, so a free row typed twice also merges.
    mpAddRow(list, mpRowFromPick({ name: 'שקע כפול', price: 30, source: 'free' }, 1));
    mpAddRow(list, mpRowFromPick({ name: 'שקע  כפול ', price: 30, source: 'free' }, 1));
    assert.equal(list.length, 2);
    assert.equal(list[1].qty, 2);
});

test('the free row carries his number and nothing else', () => {
    const { mpRowFromPick } = loadPure();
    const row = mpRowFromPick({ name: 'קופסת חיבורים', unit: "יח'", price: 8, suggested: 8, source: 'free' }, 4);
    assert.equal(row.source, 'free');
    assert.equal(row.sku, '');
    assert.equal(row.price, 8);
    assert.equal(row.suggested, 8, 'his number is also the suggestion — nothing to flag as changed');
    assert.equal(row.checked, true);
    assert.equal(row.details, '');
});

// ── 3. The shelf: twenty, newest first, no repeats ──────────────────────────
test('the recent list is capped at 20 and never lists the same item twice', () => {
    const { mpPushRecent, MP_RECENT_MAX } = loadPure();
    assert.equal(MP_RECENT_MAX, 20);
    let list = [];
    for (let i = 1; i <= 25; i++) list = mpPushRecent(list, { name: 'פריט ' + i, price: i, sku: 'S' + i, source: 'catalog' });
    assert.equal(list.length, 20);
    assert.equal(list[0].name, 'פריט 25', 'newest first');
    assert.equal(list[19].name, 'פריט 6', 'the oldest five fell off');
    // Adding an item already on the shelf moves it to the front, once.
    list = mpPushRecent(list, { name: 'פריט 10 (שם חדש)', price: 10, sku: 'S10', source: 'catalog' });
    assert.equal(list.length, 20);
    assert.equal(list[0].sku, 'S10');
    assert.equal(list.filter((e) => e.sku === 'S10').length, 1);
    // The source travels as `origin`, so a free row comes back as his number.
    list = mpPushRecent(list, { name: 'שקע', price: 30, source: 'free' });
    assert.equal(list[0].origin, 'free');
    assert.ok(mpPushRecent(list, { name: '' }).length <= 20, 'a nameless row adds nothing');
});

test('the shelf is written on every add and when a quote is built', () => {
    const commit = slice('function mpCommit(row)', '// ── שורה חופשית');
    assert.match(commit, /mpAddRow\(proj\.materials, row\)/, 'the add goes through the dedupe');
    assert.match(commit, /_ptSave\(proj\)/, 'and through the same save the chat uses');
    assert.match(commit, /mpRememberRecent\(\[added\.row\]\)/);
    assert.match(commit, /showToast\(`נוסף: \$\{added\.row\.name\} ×/, 'the toast names the item and the count');
    const toQuote = slice('async function ptToQuote()', '// ── What the job needs, on paper');
    assert.match(toQuote, /mpRememberRecent\(\(proj\.materials \|\| \[\]\)\.filter/, 'building the quote must update the shelf');
    assert.match(app, /getStorageKey\(MP_RECENT_KEY\)/, 'the shelf is per user, like every other store');
});

// ── 4. His number survives the catalogue pass ───────────────────────────────
function loadCatalogPass(fetchImpl) {
    const ctx = vm.createContext({
        Number, String, Object, Math, Array, JSON, RegExp, console,
        appState: { settings: {} },
        showToast: () => {}, saveProjects: () => {}, touchProject: () => {},
        renderMaterialsChecklist: () => {}, renderPricingEngine: () => {},
        pricingRefreshMaterials: () => {},
        document: { getElementById: () => null },
        fetch: fetchImpl,
    });
    vm.runInContext(
        slice('const MATERIAL_UNITS =', 'function openPricingTable')
        + '\n' + slice('function projectMaterialsCost(proj)', 'function ensureProjectPricing')
        + '\n' + slice('const QTY_UNIT_RX =', 'function applyMaterialsFromResponse')
        + '\n' + slice('async function catalogPriceMaterials(proj)', 'function renderWizardScope')
        + '\n;globalThis.api = { catalogPriceMaterials };',
        ctx);
    return ctx.api;
}

test("'mine' and 'free' rows keep their price through a catalogue pass; catalogue rows are refreshed", async () => {
    const { catalogPriceMaterials } = loadCatalogPass(async () => ({ ok: true, json: async () => ({ items: [
        { matched: true, price: 99, unit: "יח'", sku: 'A' },
        { matched: true, price: 99, unit: "יח'", sku: 'B' },
        { matched: true, price: 17.54, unit: 'מטר', sku: 'C' },
        { matched: true, price: 99, unit: "יח'", sku: 'D' },
    ] }) }));
    const proj = { pricing: {}, materials: [
        { name: 'מאז 3x25', qty: 2, unit: "יח'", price: 40, source: 'mine', checked: true, details: '' },
        { name: 'קופסה', qty: 1, unit: "יח'", price: 8, source: 'free', checked: true, details: '' },
        { name: 'כבל 5x6', qty: 15, unit: 'מטר', price: 28, source: 'catalog', checked: true, details: '' },
        { name: 'שקע', qty: 1, unit: "יח'", price: 30, source: 'recent', checked: true, details: '' },
    ] };
    await catalogPriceMaterials(proj);
    assert.equal(proj.materials[0].price, 40, "his catalogue price is the truth ('mine')");
    assert.equal(proj.materials[0].fromCatalog, undefined);
    assert.equal(proj.materials[1].price, 8, "a free row is the truth ('free')");
    assert.equal(proj.materials[2].price, 17.54, 'a catalogue row may be refreshed');
    assert.equal(proj.materials[2].sku, 'C');
    assert.equal(proj.materials[3].price, 99, 'a shelf row that came from the catalogue may be refreshed too');
});

// ── 5. The panel is real: markup, ids, handlers, the empty state ────────────
test('the panel is in the pricing tab with its search, list, free row and close', () => {
    const panel = html.slice(html.indexOf('id="panel-pricing"'), html.indexOf('id="panel-create"'));
    assert.match(panel, /<aside class="stern-drawer pt-side pt-side-picker" id="mat-picker"/, 'the picker reuses the side-panel chrome');
    assert.match(panel, /id="mat-picker-q"[^>]*oninput="mpOnSearch\(\)"/, 'the search field is not wired');
    assert.match(panel, /id="mat-picker-q"[^>]*placeholder='שם או מק"ט… למשל מא"ז 3x25'/);
    assert.match(panel, /id="mat-picker-list"/);
    for (const id of ['mp-free-name', 'mp-free-qty', 'mp-free-unit', 'mp-free-price']) {
        assert.match(panel, new RegExp(`id="${id}"`), `the free row is missing #${id}`);
    }
    assert.match(panel, /onclick="mpAddFree\(\)"/);
    assert.match(panel, /id="mat-picker"[\s\S]*?onclick="closePricingSide\(\)"/, 'the × closes it');
    assert.match(app, /if \(e\.key === 'Escape'\) closePricingSide\(\)/, 'Escape closes it');
    // The free row's units are filled from the table's own list, not typed twice.
    assert.match(panel, /<select id="mp-free-unit" aria-label="יחידה"><\/select>/, 'the unit select must start empty');
    assert.match(app, /unit\.innerHTML = MATERIAL_UNITS\.map/, 'and be filled from MATERIAL_UNITS');
});

test('every handler the panel and its rows name is a function that exists', () => {
    for (const fn of ['openMatPicker', 'mpOnSearch', 'mpSearchKey', 'mpSearchSupplier', 'renderMatPicker',
        'mpStep', 'mpAdd', 'mpCommit', 'mpAddFree', 'mpFreeFromQuery', 'setTradeDiscount', 'closePricingSide']) {
        assert.match(app, new RegExp(`^(?:async )?function ${fn}\\(`, 'm'), `${fn} is not defined`);
    }
    const render = slice('function renderMatPicker()', 'function _mpQtyInput');
    assert.match(render, /onclick="mpStep\(\$\{i\}, -1\)"/, 'each row needs its − step');
    assert.match(render, /onclick="mpStep\(\$\{i\}, 1\)"/, 'each row needs its + step');
    assert.match(render, /class="mp-qty"[^>]*value="1"/, 'the stepper starts at one');
    assert.match(render, /onclick="mpAdd\(\$\{i\}\)">הוסף</, 'each row needs its הוסף');
    assert.match(render, /המחיר שלי/, 'his own price is marked');
    assert.match(render, /מחפש…/);
    assert.match(render, /אין תוצאה — <button[^>]*onclick="mpFreeFromQuery\(\)">הוסף שורה חופשית</);
});

test('the table header and the empty state both open the picker', () => {
    const table = slice('function renderPricingTable()', 'function ptInCatalog');
    assert.match(table, /onclick="openMatPicker\(\)"[^>]*>＋ הוסף חומר</, 'the header button');
    assert.match(table, /class="pt-empty-state">[\s\S]*?אפשר להוסיף חומרים מהמאגר בלי הצ'אט\.[\s\S]*?onclick="openMatPicker\(\)">＋ הוסף חומר</,
        'the empty state must say so and carry the same button');
    assert.ok(!/openCatalogPicker|cat-picker/.test(app), 'the old dialog is gone, not doubled');
});

test('the supplier is asked once per pause, at 2+ characters, and remembered per query', () => {
    assert.match(app, /const MP_DEBOUNCE_MS = 250;/);
    assert.match(app, /const MP_MIN_CHARS = 2;/);
    assert.match(app, /_cpTimer = setTimeout\(mpSearchSupplier, MP_DEBOUNCE_MS\)/);
    assert.match(app, /if \(_mpCache\.has\(q\)\)/, 'a repeated query must not cost a request');
    assert.match(app, /_mpCache\.set\(q, \{ items, meta/, 'answers are kept for the session');
    assert.match(app, /res\.status === 429/, 'the public endpoint is rate-limited, and the panel says so in his words');
    // The endpoint caps at 60 a minute per address; 24 rows per query is plenty.
    assert.match(app, /const MP_SUPPLIER_LIMIT = 24;/);
});

test('phones get the 44px targets and a bottom sheet', () => {
    assert.match(css, /@media \(pointer: coarse\) \{\n    \.mp-step-btn \{ width: 44px; min-height: 44px; \}/);
    assert.match(css, /\.pt-side-picker \{\n\s+inset-inline: 0; inset-block: auto 0;/, 'the sheet stands up from the bottom on a phone');
    assert.match(css, /\.pt-side-picker\.open \{ transform: none; \}/);
});

// ── 6. The guide: the picker is a full road in, not a dead end ──────────────
function loadGuideState() {
    const ctx = vm.createContext({ Number, Array, String, Object, Math, pricingTotals: undefined });
    vm.runInContext(
        slice('function guideStepState(proj)', 'function guideActiveProject')
        + '\n;globalThis.api = { guideStepState, guideHasNumbers };', ctx);
    return ctx.api;
}

test('a job whose materials came only from the picker is priced for the road — step 1 is not required', () => {
    const { guideStepState, guideHasNumbers } = loadGuideState();
    const proj = { id: 'p1', status: 'טיוטה', chatHistory: [{ role: 'model', content: 'שלום' }],
        materials: [{ name: 'מאז 3x25', qty: 2, price: 40, source: 'catalog', checked: true }] };
    const st = guideStepState(proj);
    assert.equal(st.done[0], true, 'materials on the table tick step 1 without a word to the agent');
    assert.equal(st.step, 2);
    assert.equal(guideHasNumbers(proj), true);
    assert.match(app, /תקן מה שצריך, או הוסף חומרים בעצמך\./, 'the step-2 card names the second door');
    const card = slice("} else if (cur === 'pricing') {", "} else if (cur === 'create') {");
    assert.match(card, /onclick="openMatPicker\(\)"/, 'and carries its button');
});
