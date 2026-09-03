// What the agent carries into a turn, and why the bias leans the way it does.
//
// The same rule the screen got: nothing rides along unless this turn can use
// it. A conversation was carrying 14,661 characters of reference — the whole
// labour price book, the field anchors, the tool bag — before the question had
// even been read, on top of what the server attaches. Asked "מה החתך ל-32 אמפר
// ב-25 מטר?", every one of those was dead weight, and the cost is not the token
// bill: a model holding three books it cannot use spends its attention deciding
// which one you meant, and the short answers this product is built on get
// harder to produce.
//
// The direction of the bias is the load-bearing decision here, so it is pinned
// rather than trusted. Withholding a book from a real pricing question produces
// a wrong number; carrying one into a regulation question merely wastes space.
// So: money knowledge rides unless the turn is CLEARLY not about money, and a
// bare digit never counts as money intent because cable questions are full of
// digits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { readApp } from './_app-source.mjs';

const APP = readApp().replace(/\r\n/g, '\n');

function load() {
    const start = APP.indexOf('const MONEY_HINTS');
    assert.ok(start > -1, 'the knowledge selector moved or was renamed');
    const end = APP.indexOf('\n}\n', APP.indexOf('function knowledgeFor')) + 3;
    const ctx = createContext({
        // Each book announces itself, so a test can see which ones rode along.
        getSternLaborPromptBlock: () => '[LABOUR]',
        getSjPriceBlock: () => '[SJ]',
        getMarketAnchorsPromptBlock: () => '[ANCHORS]',
        getToolsPromptBlock: () => '[TOOLS]',
        String, RegExp,
    });
    return runInContext(
        APP.slice(start, end) +
        '\n;({ wantsMoneyKnowledge, wantsToolKnowledge, knowledgeFor, lastUserSaid })',
        ctx);
}

const K = load();

test('a price question carries the books that hold prices', () => {
    for (const q of [
        'כמה לוקח קבלן משתלבות?',
        'כמה עולה אוטומט מדרגות',
        'תמחר לי החלפת לוח',
        'מה המחיר למטר חפירה',
    ]) assert.equal(K.wantsMoneyKnowledge(q), true, q);
});

test('a described job carries them too, with no number in the sentence', () => {
    for (const q of [
        'התקנת עמדת טעינה בחניה',
        'החלפת אביזרים בדירה',
        'הזזה של נקודת מאור',
    ]) assert.equal(K.wantsMoneyKnowledge(q), true, q);
});

test('a question about the trade does not', () => {
    // These are the ones that were paying for three reference works they could
    // not use. Note every one contains digits or looks technical — a bare digit
    // must not be read as money intent.
    for (const q of [
        'מה החתך שצריך ל-32 אמפר ב-25 מטר?',
        'מותר לשים פחת אחד לכל הבית?',
        'למה הפחת קופץ?',
        'מה ההפרש בין עקומה B לעקומה C',
    ]) assert.equal(K.wantsMoneyKnowledge(q), false, q);
});

test('an empty or unreadable turn carries everything', () => {
    // The generous direction. With nothing to judge by, the expensive mistake
    // is answering a pricing question without the price books.
    assert.equal(K.wantsMoneyKnowledge(''), true);
    assert.equal(K.wantsMoneyKnowledge(null), true);
    assert.equal(K.wantsMoneyKnowledge('אוקיי תודה'), true);
});

test('the tool bag rides only when tools are the subject', () => {
    assert.equal(K.wantsToolKnowledge('תן לי רשימת כלים'), true);
    assert.equal(K.wantsToolKnowledge('צריך ג\'וקר או פלייר שפיץ?'), true);
    assert.equal(K.wantsToolKnowledge('כמה עולה החלפת מפסק'), false);
    assert.equal(K.wantsToolKnowledge('התקנת עמדת טעינה'), false);
});

test('the itemised quote carries everything, because it produces the numbers', () => {
    const full = K.knowledgeFor('שום דבר מיוחד', { full: true });
    for (const book of ['[LABOUR]', '[ANCHORS]', '[TOOLS]']) {
        assert.ok(full.includes(book), `the full pass carries ${book}`);
    }
});

test('a regulation question carries no books at all', () => {
    assert.equal(K.knowledgeFor('מותר לשים פחת אחד לכל הבית?'), '');
});

test('the selector reads the last thing the person said, not the whole thread', () => {
    const said = K.lastUserSaid([
        { role: 'user', parts: [{ text: 'כמה עולה לוח' }] },
        { role: 'model', parts: [{ text: '1,500 ₪' }] },
        { role: 'user', parts: [{ text: 'ומה החתך?' }] },
        { role: 'user', hidden: true, parts: [{ text: 'הוראה מאחורי הקלעים' }] },
    ]);
    assert.equal(said, 'ומה החתך?', 'hidden instructions are not the question');
});
