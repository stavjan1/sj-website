// The next-step card is a guide, and a guide that is wrong is worse than none:
// it teaches the wrong move at the exact moment somebody is looking for the
// right one. Two properties keep it honest, and both are checked here rather
// than trusted.
//
// 1. Every card is the COMPLEMENT of a gate that already exists, so a card and
//    an action bar can never be on screen together.
// 2. Every card decides from persisted state — never from the DOM, never from
//    "is that button visible". The buttons on that screen are being reworded and
//    may be renamed; when that happens, only the copy in nextstep.js should have
//    to change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const SRC = read('site', 'sale', 'nextstep.js');
const APP = readApp();
const HTML = read('site', 'sale', 'index.html');

// The file in a jar, with the app's five predicates stubbed. Everything the
// cards are allowed to read is passed in here — if a card ever reaches for
// something else, it lands as undefined and its test fails loudly.
function load(world) {
    const w = Object.assign({
        getProjectStage: (p) => p.stage || 'planning',
        specCoverage: (p) => ({ missingCritical: p._missing || [] }),
        pricingTotals: (p) => ({ total: p._total || 0, lab: {} }),
        appState: { history: [] },
        localStorage: { getItem: () => null, setItem: () => {} },
        getStorageKey: (k) => k,
        escapeHtml: (s) => String(s),
        document: undefined,
        requestAnimationFrame: (f) => f(),
    }, world || {});
    const ctx = createContext(Object.assign(w, { window: undefined }));
    runInContext('var window = this;', ctx);
    runInContext(SRC, ctx);
    return ctx;
}

// One project per interesting state, plus the boring ones in between.
function matrix() {
    const two = [{ id: 'a', label: 'סוג קיר' }, { id: 'b', label: 'אורך' }];
    return [
        { name: 'fresh, nothing said', p: { stage: 'planning', planChatHistory: [{ role: 'model' }] } },
        { name: 'planning, gaps', p: { stage: 'planning', planChatHistory: [{ role: 'user' }, { role: 'model' }], _missing: two } },
        { name: 'planning, complete', p: { stage: 'planning', planChatHistory: [{ role: 'user' }, { role: 'model' }], _missing: [] } },
        { name: 'pricing, no numbers', p: { stage: 'pricing', chatHistory: [{ role: 'user' }, { role: 'model' }], _total: 0 } },
        { name: 'pricing, numbers', p: { stage: 'pricing', chatHistory: [{ role: 'user' }, { role: 'model' }], _total: 900 } },
        { name: 'pricing, only the handoff turn', p: { stage: 'pricing', chatHistory: [{ role: 'user', handoff: true }, { role: 'model' }], _total: 0 } },
        { name: 'draft, empty quote', p: { stage: 'draft', _total: 4200, quoteData: { items: [{ title: 'פרק א', price: 0 }], basePrice: 0 } } },
        { name: 'draft, priced quote', p: { stage: 'draft', _total: 4200, quoteData: { items: [{ title: 'פרק א', price: 4200 }], basePrice: 4200 } } },
        { name: 'quote left, still a draft', p: { stage: 'draft', _total: 10, quoteData: { basePrice: 10 }, quoteOutAt: 1700000000000, status: 'טיוטה' } },
        { name: 'quote left, marked sent', p: { stage: 'draft', _total: 10, quoteData: { basePrice: 10 }, quoteOutAt: 1700000000000, status: 'נשלח' } },
    ];
}

test('the resolver returns one card or none, never a pile', () => {
    const { nextStepFor } = load();
    for (const { name, p } of matrix()) {
        const got = nextStepFor(p);
        assert.ok(got === null || (got && typeof got.id === 'string'), name + ': one object or null');
    }
});

test('every state that has a card gets the RIGHT card', () => {
    const { nextStepFor } = load();
    const id = (p) => (nextStepFor(p) || {}).id || null;
    const m = Object.fromEntries(matrix().map((x) => [x.name, x.p]));
    assert.equal(id(m['fresh, nothing said']), null, 'nothing to say before the agent answered');
    assert.equal(id(m['planning, gaps']), 'plan-gap');
    assert.equal(id(m['planning, complete']), null, 'the handoff bar speaks here instead');
    assert.equal(id(m['pricing, no numbers']), 'price-empty');
    assert.equal(id(m['pricing, numbers']), null, 'the pricing bar speaks here instead');
    assert.equal(id(m['pricing, only the handoff turn']), null, 'a button press is not a conversation');
    assert.equal(id(m['draft, empty quote']), 'draft-empty');
    assert.equal(id(m['draft, priced quote']), null);
    assert.equal(id(m['quote left, still a draft']), 'quote-out');
    assert.equal(id(m['quote left, marked sent']), null);
});

test('no card decides by looking at the screen', () => {
    // This is the guard that keeps the owner free to rename or delete
    // "תמחר פרויקט זה" without touching a line of this file's logic.
    const table = SRC.slice(SRC.indexOf('var NEXT_STEP_CARDS'), SRC.indexOf('function nextStepMuted'));
    for (const forbidden of ['document.', 'getElementById', 'querySelector', 'plan-action-bar', 'price-action-bar', 'תמחר פרויקט זה']) {
        assert.ok(!table.includes(forbidden), `a card predicate reaches for "${forbidden}"`);
    }
});

test('the plan card is the exact complement of the pricing gate', () => {
    // canPriceProject(proj) is specCoverage(proj).ready — the same term, so the
    // bar and the card cannot both be right (or both wrong) at once.
    assert.match(APP, /function canPriceProject\(proj\) \{\s*return specCoverage\(proj\)\.ready;/);
    const { nextStepFor } = load();
    const base = { stage: 'planning', planChatHistory: [{ role: 'user' }, { role: 'model' }] };
    assert.equal((nextStepFor({ ...base, _missing: [{ id: 'a' }, { id: 'b' }] }) || {}).id, 'plan-gap');
    assert.equal(nextStepFor({ ...base, _missing: [] }), null);
});

test('no second door to the quote stacks over the composer', () => {
    // The bar is gone entirely. Stav, 28/08: "להמשיך לטיוטה זה מיותר. גם ככה יש
    // בצד כפתור הצעת מחיר", and the three errands beside it went with it. What
    // this guards now is that it stays gone, that it never grows back the
    // prose-sniffing trigger it once had, and — the part that matters — that
    // everything it used to carry is still reachable beside the thread.
    const i = APP.indexOf('function updatePriceActionBar');
    const body = APP.slice(i, APP.indexOf('\n}', i));
    assert.ok(!body.includes('pricingTotals'), 'the bar no longer decides anything');
    assert.ok(!body.includes('סה'), 'and never went back to reading the conversation');
    const HTML = readFileSync(join(ROOT, 'site', 'sale', 'index.html'), 'utf8');
    assert.match(HTML, /id="side-asks"/, 'the side column exists');
    assert.match(HTML, /openSpecFromChat\(\)/, 'דיוק העבודה is still reachable');
    assert.match(HTML, /askListInChat\('materials'\)/, 'רשימת חומרים is still reachable');
    assert.match(HTML, /askListInChat\('tools'\)/, 'רשימת כלים is still reachable');
});

test('a dismissal is per project, survives a reload, and stays out of quoteData', () => {
    const { nextStepFor } = load();
    const p = { stage: 'planning', planChatHistory: [{ role: 'user' }, { role: 'model' }], _missing: [{ id: 'a' }], quoteData: { items: [], basePrice: 0 } };
    const before = JSON.stringify(p.quoteData);
    p.nextStepOff = { 'plan-gap': 1 };
    const round = JSON.parse(JSON.stringify(p));
    round._missing = p._missing;                       // the stub's own field
    assert.equal(nextStepFor(round), null, 'a dismissed card stays dismissed after a reload');
    assert.equal(JSON.stringify(p.quoteData), before, 'and never touches quoteData');
    // syncCurrentQuoteToProject rebuilds quoteData from a fixed key list on
    // every keystroke — anything stored there would vanish silently.
    const i = APP.indexOf('function syncCurrentQuoteToProject');
    assert.ok(!APP.slice(i, i + 3000).includes('nextStepOff'));
});

test('a card disappears because the state changed, not because it was closed', () => {
    const { nextStepFor } = load();
    const cases = [
        [{ stage: 'planning', planChatHistory: [{ role: 'user' }, { role: 'model' }], _missing: [{ id: 'a' }] }, (p) => { p._missing = []; }],
        [{ stage: 'pricing', chatHistory: [{ role: 'user' }, { role: 'model' }], _total: 0 }, (p) => { p._total = 900; }],
        [{ stage: 'draft', _total: 4200, quoteData: { items: [], basePrice: 0 } }, (p) => { p.quoteData.basePrice = 4200; }],
        [{ stage: 'draft', _total: 10, quoteData: { basePrice: 10 }, quoteOutAt: 1, status: 'טיוטה' }, (p) => { p.status = 'נשלח'; }],
    ];
    for (const [p, advance] of cases) {
        assert.ok(nextStepFor(p), 'the card is there to begin with');
        advance(p);
        assert.equal(nextStepFor(p), null, 'and gone once the state moved — with no dismissal involved');
    }
});

test('someone who has run the loop twice is left alone', () => {
    const p = { stage: 'planning', planChatHistory: [{ role: 'user' }, { role: 'model' }], _missing: [{ id: 'a' }] };
    assert.ok(load({ appState: { history: [1] } }).nextStepFor(p), 'still helping on the first quote');
    assert.equal(load({ appState: { history: [1, 2] } }).nextStepFor(p), null, 'and quiet from the second on');
    assert.equal(load({ localStorage: { getItem: () => '1', setItem: () => {} } }).nextStepFor(p), null, 'or when he asked it to stop');
});

test('guests are not locked out of the one thing that helps them most', () => {
    // The opposite of the tour, and deliberate: guests are the funnel
    // population these cards exist for.
    assert.ok(!/isGuestUser|isGuest\b/.test(SRC));
    assert.ok(!/tierAllows/.test(SRC), 'and it is not sold as a plan feature');
});

test('the quote-out card cannot fire before the quote actually left', () => {
    const { nextStepFor } = load();
    assert.equal(nextStepFor({ stage: 'draft', _total: 10, quoteData: { basePrice: 10 }, status: 'טיוטה' }), null);
    // Four ways a quote leaves the machine; all four must stamp it.
    assert.ok(APP.includes('function markQuoteOut()'), 'the stamp exists');
    assert.ok((APP.match(/markQuoteOut\(\)/g) || []).length >= 5, 'declaration plus at least four call sites');
});

test('the slots exist once each, start hidden, and the assets are loaded', () => {
    for (const id of ['next-step-wizard', 'next-step-draft']) {
        assert.equal((HTML.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id + ' appears exactly once');
    }
    assert.match(HTML, /<div class="next-step" id="next-step-wizard" hidden>/);
    assert.match(HTML, /<div class="next-step" id="next-step-draft" hidden>/);
    assert.match(HTML, /nextstep\.css\?v=\d+/);
    assert.match(HTML, /nextstep\.js\?v=\d+/);
    // [hidden] loses to display:block without this, and the card would sit
    // there empty forever.
    assert.match(read('site', 'sale', 'nextstep.css'), /\.next-step\[hidden\][^}]*display:\s*none\s*!important/);
});

test('the guide and the cards do not both own the same moment', () => {
    const coach = read('site', 'sale', 'coach.js');
    for (const gone of ['first-project', 'first-priced', 'first-quote-saved']) {
        assert.ok(!coach.includes("'" + gone + "'"), `${gone} still has a spotlight as well as a card`);
        assert.ok(!APP.includes("coachSay('" + gone + "'"), `${gone} is still fired from the app`);
    }
    assert.match(coach, /window\.coachBusy/, 'the guide says when it is talking');
    assert.match(SRC, /coachBusy/, 'and the card listens before it paints');
});

test('the funnel can tell whether any of this worked', () => {
    const funnel = read('functions', 'api', 'funnel.js');
    assert.match(funnel, /!m\.handoff && !m\.hidden/, 'a button press is not a conversation');
    assert.match(funnel, /reachedPricing:/);
    assert.match(funnel, /reachedDraft:/);
    assert.match(read('site', 'sale', 'finance.js'), /הגיעו לתמחור/, 'and the admin screen shows them');
});
