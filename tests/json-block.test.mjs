// The JSON block at the end of a pricing reply is the bill of quantities. The
// pricing parser used to fall back to /({[\s\S]*?})/ when the model skipped
// the ```json fence — non-greedy, so it stopped at the FIRST closing brace,
// which in {"materials":[{...},{...}]} is the end of the first material. The
// cut string failed JSON.parse, the catch swallowed it, and the side panel
// stayed empty with no error anywhere. Every parse now goes through
// extractJsonBlock (fenced first, else first '{' to last '}').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readApp } from './_app-source.mjs';

const app = readApp();
const chat = readFileSync(new URL('../site/sale/chat.js', import.meta.url), 'utf8');

function slice(from, to) {
    const a = app.indexOf(from);
    const b = app.indexOf(to, a);
    assert.ok(a > -1 && b > a, `source moved: ${from}`);
    return app.slice(a, b);
}

const FENCELESS = `הנחתי: לוח שקוע, ~4 שעות עבודה.
A: חומרים — כבל 5x6 ×15 מ', מא"ז 40A.
{"laborPriceEstimate": 1800, "laborHoursEstimate": 4,
 "materials": [
   {"name": "כבל 5x6", "qty": 15, "unit": "מטר", "price": 28, "details": "תוואי חיצוני", "checked": true},
   {"name": "מא\\"ז 40A", "qty": 1, "unit": "יח'", "price": 45, "details": "", "checked": true}
 ],
 "fees": [{"name": "חשמלאי בודק", "price": 600, "note": "שורה נפרדת"}],
 "blindSpots": ["תוואי הכבל"]}`;

test('extractJsonBlock takes the whole object of a fenceless reply', () => {
    const ctx = vm.createContext({});
    vm.runInContext(slice('function extractJsonBlock(text)', '// ====') + ';globalThis.f = extractJsonBlock;', ctx);
    const parsed = JSON.parse(ctx.f(FENCELESS));
    assert.equal(parsed.materials.length, 2, 'the array was cut at the first material');
    assert.equal(parsed.fees[0].price, 600);
    // A fenced block still wins over surrounding prose braces.
    const fenced = 'טקסט {לא json}\n```json\n{"a": {"b": 1}}\n```\nעוד טקסט';
    assert.deepEqual(JSON.parse(ctx.f(fenced)), { a: { b: 1 } });
});

test('the pricing parser reads a fenceless reply with several materials', () => {
    const calls = [];
    const ctx = vm.createContext({
        Number, String, Object, Math, Array, JSON, RegExp, console: { error: (m) => calls.push(m), warn: () => {} },
        document: { getElementById: () => null },
        saveProjects: () => {}, renderPricingEngine: () => {}, renderMaterialsChecklist: () => {},
        catalogPriceMaterials: () => {}, renderWizardScope: () => {}, renderWizardTools: () => {},
        escapeHtml: (s) => s,
    });
    vm.runInContext(
        slice('function extractJsonBlock(text)', '// ====')
        + '\n' + slice('const QTY_UNIT_RX =', '// Ask the catalogue what these actually cost.')
        + ';globalThis.apply = applyMaterialsFromResponse;', ctx);
    const proj = { materials: [] };
    ctx.apply(proj, FENCELESS);
    assert.equal(calls.length, 0, 'parse error: ' + calls[0]);
    assert.equal(proj.laborPrice, 1800);
    assert.equal(proj.laborHours, 4);
    assert.equal(proj.materials.length, 2, 'only the first material survived the parse');
    assert.equal(proj.materials[0].qty, 15);
    assert.equal(proj.materials[0].unit, 'מטר');
    assert.equal(proj.materials[0].price, 28);
    assert.equal(proj.fees.length, 1);
    // A reply with no JSON at all is simply ignored, not thrown on.
    const plain = { materials: [{ name: 'x', price: 1 }] };
    ctx.apply(plain, 'רק שאלה: איזה קיר?');
    assert.equal(plain.materials.length, 1);
});

test('a [[רשימות]] list reply never reaches the priced bill, and string tools get names', () => {
    // requestToolsList asks for the list inside the pricing chat; the reply's
    // [[רשימות]] block is JSON too and, whole-object, it parsed: "tools" of
    // plain strings became nameless rows and a price-less "materials" list
    // would have replaced the bill. The block has its own renderer — the
    // pricing parser must look past it.
    const calls = [];
    let toolsRendered = null;
    const ctx = vm.createContext({
        Number, String, Object, Math, Array, JSON, RegExp, console: { error: (m) => calls.push(m), warn: () => {} },
        document: { getElementById: () => null },
        saveProjects: () => {}, renderPricingEngine: () => {}, renderMaterialsChecklist: () => {},
        catalogPriceMaterials: () => {}, renderWizardScope: () => {}, renderWizardTools: (t) => { toolsRendered = t; },
        escapeHtml: (s) => s,
    });
    vm.runInContext(
        slice('function extractJsonBlock(text)', '// ====')
        + '\n' + slice('const QTY_UNIT_RX =', '// Ask the catalogue what these actually cost.')
        + ';globalThis.apply = applyMaterialsFromResponse;', ctx);
    const proj = { materials: [{ name: 'כבל 5x6', qty: 15, unit: 'מטר', price: 17.54, details: '', checked: true }], tools: [] };
    ctx.apply(proj, 'הנה הרשימה:\n[[רשימות]]{"materials":[{"item":"כבל 5x6","qty":"15 מ\'"}],"tools":["מברגה","סרט מדידה"]}[[/רשימות]]');
    assert.equal(calls.length, 0, 'parse error: ' + calls[0]);
    assert.equal(proj.materials[0].price, 17.54, 'the list reply replaced the priced bill');
    assert.equal(proj.tools.length, 0, 'the list block was read as the pricing JSON');
    assert.equal(toolsRendered, null);
    // Tools that do arrive in the pricing JSON as bare strings still get a name.
    ctx.apply(proj, '```json\n{"tools": ["פטישון", {"name": "דיסק יהלום"}, {}]}\n```');
    assert.deepEqual(proj.tools.map((t) => t.name), ['פטישון', 'דיסק יהלום']);
});

test('no parse site in chat.js still uses the first-closing-brace fallback', () => {
    // The one place the non-greedy regex may still live is the last resort
    // inside stripJsonBlock, after the outermost span failed to parse.
    const code = chat.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    const hits = code.match(/\(\{\[\\s\\S\]\*\?\}\)/g) || [];
    assert.equal(hits.length, 1, 'the non-greedy brace regex is back outside stripJsonBlock');
    const stripFn = code.slice(code.indexOf('function stripJsonBlock'), code.indexOf('function applyMaterialsFromResponse'));
    assert.ok(/\(\{\[\\s\\S\]\*\?\}\)/.test(stripFn));
    // Every model reply parsed as an object goes through extractJsonBlock.
    const parses = chat.match(/JSON\.parse\(([^)]*)\)/g) || [];
    const modelReplies = parses.filter((p) => /responseText|resultText|jsonMatch|block\b/.test(p));
    assert.ok(modelReplies.length >= 4, 'the model-reply parse sites moved');
    for (const p of modelReplies) {
        assert.ok(/extractJsonBlock|\(block\)/.test(p), `a model reply is parsed without extractJsonBlock: ${p}`);
    }
});

test('the bubble shows none of a fenceless JSON block, and prose braces survive', () => {
    const ctx = vm.createContext({ String, JSON });
    vm.runInContext(slice('function stripJsonBlock(text)', '// Parse the trailing JSON block') + ';globalThis.s = stripJsonBlock;', ctx);
    const shown = ctx.s(FENCELESS);
    assert.ok(!shown.includes('{'), 'raw JSON left in the chat bubble: ' + shown);
    assert.ok(shown.startsWith('הנחתי:') && shown.includes('מא"ז 40A.'), 'the prose was cut');
    // Fenced: only the fence goes.
    assert.equal(ctx.s('שלום\n```json\n{"a":1}\n```\nביי'), 'שלום\n\nביי');
    // A stray brace in prose with no JSON after it takes nothing else with it.
    assert.equal(ctx.s('סוגריים {כאלה} בטקסט, ועוד משפט'), 'סוגריים  בטקסט, ועוד משפט');
});

test('the quote base price is the sum of its lines, not the model\'s own total', () => {
    const warns = [];
    const ctx = vm.createContext({ Number, Math, Array, console: { warn: (m) => warns.push(m) } });
    vm.runInContext(slice('function quoteBasePrice(result)', 'let _exportingQuote') + ';globalThis.q = quoteBasePrice;', ctx);
    // Lines add to 4200, the model wrote 3500: the lines win, and it is logged.
    assert.equal(ctx.q({ items: [{ price: 1200 }, { price: 3000 }], basePrice: 3500 }), 4200);
    assert.equal(warns.length, 1);
    // Within 1% nothing is said.
    assert.equal(ctx.q({ items: [{ price: 1000 }, { price: 2005 }], basePrice: 3000 }), 3005);
    assert.equal(warns.length, 1);
    // No lines to add: the written figure is all there is.
    assert.equal(ctx.q({ items: [], basePrice: 900 }), 900);
    assert.equal(ctx.q({}), 0);
});
