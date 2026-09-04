// Stav's field rulings of 4.9.2026, pinned.
//
// The product cares about PRICING and nothing else: not the electrician's
// paperwork with a house committee, the neighbours or the municipality. The
// electric company stays (an inspector order or a bigger supply changes the
// price). The chat answers with the number first and at most one line of why;
// "ביקור" is the user's own arrival fee, set once in the settings; nothing is
// priced under 250 ₪; a fault call is visit + hourly and the REPAIR is never
// priced before the diagnosis. The checks that are not prices ("make sure
// there is room in the panel") live behind the "הערות" button — behind it, and
// in no prompt.
//
// Every one of those is a sentence in a prompt or a line in a checklist, which
// is exactly the kind of thing that drifts back in one edit at a time. So each
// is asserted here against the real source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { readApp } from './_app-source.mjs';
import { DEFAULT_PRICING_MAP } from '../functions/api/_pricing_map.js';
import { renderCoverageBlock } from '../functions/api/_coverage.js';
import { SEED_ITEMS } from '../functions/api/helper-prices.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const APP = readApp();
const COVERAGE_SRC = read('site/sale/coverage.js');
const SHIPPED = JSON.parse(read('site/data/coverage/checklists.json'));

// A top-level `function name(` up to the next top-level function. Not sliced
// on '\n}\n': the prompt builders carry a JSON example whose closing brace sits
// in column 0, which is exactly where that cut would land.
function fn(src, name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start > -1, `${name} is gone`);
    const next = src.slice(start + 1).search(/\n(async )?function /);
    return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

// getVisitPrice + getConciseRuleBlock + getSjPriceBlock, run against a stub
// settings object and a stub price book — the vm pattern from
// agent-knowledge.test.mjs.
function loadPricing(settings, decisions) {
    const code = [fn(APP, 'getVisitPrice'), fn(APP, 'getConciseRuleBlock'), fn(APP, 'getSjPriceBlock')].join('\n');
    const ctx = createContext({
        appState: { settings },
        sjPriceBook: {
            decisions,
            rows: [
                { name: 'נקודת מאור', unit: "נק'", price: 375, starter: true },
                { name: 'חציבה בבלוקים', price: 700, next_m: 280, basis: 'chase' },
            ],
        },
        Number, Array, Math, String,
    });
    return runInContext(code + '\n;({ getVisitPrice, getConciseRuleBlock, getSjPriceBlock })', ctx);
}

// Everything a model can read: the three prompt builders and the knowledge
// blocks in app.js/chat.js, the server pricing map, and the coverage block the
// server renders for every job type. Notes are deliberately NOT here — the
// test below asserts they never get in.
function promptCorpus() {
    const parts = [
        DEFAULT_PRICING_MAP,
        fn(APP, 'getProfessionSystemInstruction'),
        fn(APP, 'getPlanningSystemInstruction'),
        fn(APP, 'getAskSystemInstruction'),
        fn(APP, 'getSternLaborPromptBlock'),
        fn(APP, 'getMarketAnchorsPromptBlock'),
        fn(APP, 'getToolsPromptBlock'),
        fn(APP, 'getSjPriceBlock'),
        fn(APP, 'getConciseRuleBlock'),
        APP.slice(APP.indexOf('const GENERIC_CHECKLIST'), APP.indexOf('\n};', APP.indexOf('const GENERIC_CHECKLIST'))),
    ];
    for (const job of Object.keys(SHIPPED)) parts.push(renderCoverageBlock(SHIPPED, job));
    return parts.join('\n');
}

// The authored checklists, minus the notes (which are allowed to say "check
// the panel has room" — that is what they are for).
function checklistCorpus() {
    const start = COVERAGE_SRC.indexOf('{', COVERAGE_SRC.indexOf('const COVERAGE_CHECKLISTS'));
    const end = COVERAGE_SRC.indexOf('\n};', start);
    const lists = JSON.parse(COVERAGE_SRC.slice(start, end + 2));
    // One authored string per line, so a line-level check sees a sentence
    // and not a whole job type.
    const out = [];
    const walk = (v) => {
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const list of Object.values(lists)) {
        const { notes, ...rest } = list;
        walk(rest);
    }
    return out.join('\n');
}

function loadNotesFor() {
    const ctx = createContext({ window: {}, document: { addEventListener() {} } });
    runInContext(`${COVERAGE_SRC}\n;globalThis.__N = notesFor; globalThis.__CC = COVERAGE_CHECKLISTS;`, ctx, { timeout: 10000 });
    return { notesFor: ctx.__N, lists: ctx.__CC };
}

// Third-party bureaucracy. "ועד" is matched as a word on its own (not במועד,
// not ועדיין, not "מעל 50 ועד 100" in a price row), plus its prefixed forms.
const BUREAUCRACY = /(?<![א-ת])ועד(?![א-ת])(?!\s*[\d~])|לוועד|הוועד|ועדי בית|MID|DLM|ניהול עומסים|היתר(?!ה)|שכנים|דיירים|עיריי?ה|חברת ניהול/;

test('the concise rule rides on all three prompt builders', () => {
    for (const name of ['getProfessionSystemInstruction', 'getPlanningSystemInstruction', 'getAskSystemInstruction']) {
        assert.ok(/getConciseRuleBlock\(\)/.test(fn(APP, name)), `${name} does not append the concise rule`);
    }
});

test('the concise rule says: number first, one line, one question, and carries the breaker anchor', () => {
    const { getConciseRuleBlock } = loadPricing({ visitPrice: 400 }, { visit: 350 });
    const block = getConciseRuleBlock();
    assert.ok(/המספר קודם/.test(block), 'number first');
    assert.ok(/שורה קצרה אחת/.test(block), 'one line of reasoning');
    assert.ok(/שאל שאלה אחת, לא רשימה/.test(block), 'one question, not a list');
    assert.ok(/בלי "בשמחה", "כמובן"/.test(block), 'no openers');
    // Stav's calibration example, verbatim.
    assert.ok(block.includes('"נהוג לקחת 100."'), 'the breaker anchor is gone');
    assert.ok(block.includes('לא חינם — יכולת ללכת ללקוח אחר'), 'the one-line reason is gone');
    // "ביקור" is the user's arrival fee, and never a two-second favour.
    assert.ok(block.includes('400 ₪'), 'the visit price from the settings is not in the rule');
    assert.ok(/לעולם לא לטובה של שתי שניות/.test(block));
    // The parsed blocks stay: the rule is about prose, not structure.
    assert.ok(/\[\[שאלות\]\]/.test(block) && /\[\[רשימות\]\]/.test(block) && /json/.test(block));
});

test('the visit price flows from the settings into the SJ block, with the book as fallback', () => {
    let P = loadPricing({ visitPrice: 420 }, { visit: 350, hourly_mode: { rate: 250 } });
    assert.equal(P.getVisitPrice(), 420);
    let block = P.getSjPriceBlock();
    assert.ok(block.includes('ביקור 420 ₪'), 'the settings price is not the visit in the SJ block');
    assert.ok(!block.includes('ביקור 350 ₪'), 'the book default leaked past a set visit price');
    assert.ok(block.includes('250 ₪ לכל שעה'), 'the hourly figure must stay the book decision');

    // No setting → the book's decision. No book either → 350.
    P = loadPricing({}, { visit: 300, hourly_mode: { rate: 250 } });
    assert.equal(P.getVisitPrice(), 300);
    assert.ok(P.getSjPriceBlock().includes('ביקור 300 ₪'));
    P = loadPricing({ visitPrice: 'abc' }, {});
    assert.equal(P.getVisitPrice(), 350);
});

test('minimums and faults read as Stav ruled them', () => {
    const block = loadPricing({ visitPrice: 350 }, { visit: 350, hourly_mode: { rate: 250 } }).getSjPriceBlock();
    assert.ok(/שום עבודה מתחת ל-250 ₪/.test(block), 'the 250 floor');
    assert.ok(/קריאה קצרה 250–350 ₪/.test(block), 'a short call is the visit');
    assert.ok(/600–650 ₪ בלי חומר/.test(block), 'an hour of fault-finding');
    assert.ok(/ביקור 350 ₪ \+ 250 ₪ לכל שעה/.test(block), 'fault-finding = visit + hourly');
    assert.ok(/לא מתמחרים לפני האיתור/.test(block) && /"ביקור ואיתור"/.test(block), 'the repair is never priced in advance');
    assert.ok(/התיקון מתומחר בשטח/.test(block));
    // Consumables: the app adds the 5% line, the model must not.
    assert.ok(/חומרי עזר ומתכלים 5%/.test(block) && /אל תוסיף שורת מתכלים/.test(block));
});

test('no prompt or checklist carries third-party bureaucracy', () => {
    for (const [label, text] of [['prompts', promptCorpus()], ['checklists', checklistCorpus()]]) {
        const m = text.match(BUREAUCRACY);
        assert.ok(!m, `${label}: "${m && m[0]}" — ${text.slice(Math.max(0, (m && m.index) - 60), (m && m.index) + 60)}`);
    }
});

test('the electric company stays, because it changes the price', () => {
    const text = promptCorpus() + checklistCorpus();
    assert.ok(/הזמנת בודק|חשמלאי בודק/.test(text));
    assert.ok(/הגדלת חיבור/.test(text));
    assert.ok(/הזמנת חיבור|הזמנת ניתוק/.test(text));
});

test('no fixed price for a fault REPAIR anywhere — only the visit and the diagnosis', () => {
    const text = promptCorpus() + '\n' + checklistCorpus();
    assert.ok(!/215/.test(text), 'the old 215 ₪ call-out figure is back');
    for (const line of text.split('\n')) {
        if (!/תיקון/.test(line) || !/תקלה|קצר/.test(line)) continue;
        // "תיקון" followed by a figure in the same clause is a price for the
        // repair. The visit and the hour are priced in their own clauses.
        assert.ok(!/תיקון[^.\n]{0,40}(\d{3}|₪)/.test(line),
            `a fault repair is priced in advance: ${line.slice(0, 160)}`);
    }
    // The map says it in so many words.
    assert.ok(/לעולם אל תיתן "מחיר לתיקון תקלה" כמספר אחד או כטווח/.test(DEFAULT_PRICING_MAP));
});

test('the helpers are asked for their visit price first', () => {
    assert.equal(SEED_ITEMS[0].id, 'visit');
    assert.equal(SEED_ITEMS[0].unit, 'ביקור');
    assert.ok(/ביקור/.test(SEED_ITEMS[0].name));
});

test('the route factor and the EV RCD rule are in the charger and infra checklists', () => {
    const { lists } = loadNotesFor();
    for (const job of ['charger', 'infra']) {
        const f = lists[job].fields.find((x) => x.id === 'distance_basis');
        assert.ok(f, `${job}: no route-basis question`);
        assert.ok(/40–60%/.test(f.why + f.pricingImpact), `${job}: the 40–60% shared-building factor is gone`);
        const blob = JSON.stringify(lists[job]);
        assert.ok(/6mA DC[^"]{0,60}Type B[^"]{0,40}900–1,200/.test(blob), `${job}: the Type B material rule is gone`);
    }
});

test('the checks that are not prices live in notes, and notes reach no prompt', () => {
    const { notesFor, lists } = loadNotesFor();
    const points = notesFor('points');
    assert.ok(points.length >= 2, 'points has no notes');
    assert.ok(points.some((n) => /מקום פנוי בלוח/.test(n)), 'room in the panel is not a note');
    assert.ok(notesFor('charger').some((n) => /מודולים פנויים/.test(n)));
    assert.ok(notesFor('infra').some((n) => /להפסיק חשמל/.test(n)));
    const none = notesFor('no-such-job');   // cross-realm array: no deepEqual
    assert.ok(Array.isArray(none) && none.length === 0);
    // A copy, not the array: a caller sorting it must not reorder the source.
    assert.notEqual(notesFor('points'), lists.points.notes);

    const prompts = promptCorpus();
    for (const [job, list] of Object.entries(lists)) {
        for (const n of list.notes || []) {
            assert.ok(!prompts.includes(n), `${job} note leaked into a prompt: ${n.slice(0, 80)}`);
        }
        assert.equal(SHIPPED[job].notes, undefined, `${job}: notes were extracted into the server data`);
    }
});
