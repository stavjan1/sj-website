// An id must identify ONE element. When two share it, getElementById returns the
// first, so code that means "the button the user pressed" silently operates a
// different element somewhere else in the document.
//
// Both instances of this in sale/index.html were real bugs, and one of them cost
// money: two buttons shared id="btn-export-to-quote", and both fire the
// quote-writer — the most expensive AI call in the product, it ships the whole
// conversation. Pressing the second one disabled and spinner-ed the FIRST one,
// four hundred lines up and off screen, so the button the user actually pressed
// looked untouched. That is an invitation to press again, and every press is
// another full request against a shared Gemini quota.
//
// The other pair left the "צינור העבודה" panel permanently empty under a heading
// promising a pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const PAGES = ['site/sale/index.html', 'site/index.html', 'site/zerem/index.html', 'site/ask/index.html', 'site/q/index.html'];

test('no element id appears twice on any page', () => {
    const problems = [];
    for (const page of PAGES) {
        let src;
        try { src = readFileSync(new URL('../' + page, import.meta.url), 'utf8'); } catch { continue; }
        const counts = new Map();
        const re = /\bid="([^"]+)"/g;
        let m;
        while ((m = re.exec(src))) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
        for (const [id, n] of counts) if (n > 1) problems.push(page + ' -> #' + id + ' x' + n);
    }
    assert.deepEqual(problems, [], 'duplicate ids: getElementById will silently pick the first');
});

test('every control that fires the quote-writer is locked together', () => {
    // Two buttons call exportChatToQuote. Whatever their ids, the handler must
    // disable ALL of them, or the twin stays live while a request is in flight.
    const html = readFileSync(new URL('../site/sale/index.html', import.meta.url), 'utf8');
    const triggers = (html.match(/exportChatToQuote/g) || []).length;
    const marked = (html.match(/js-export-to-quote/g) || []).length;
    assert.equal(marked, triggers,
        'a control fires the quote-writer without the class the handler uses to lock them all');

    const chat = readFileSync(new URL('../site/sale/chat.js', import.meta.url), 'utf8');
    const i = chat.indexOf('async function exportChatToQuote');
    // A generous window: the function is long, and matching its closing brace
    // by scanning for the first one lands inside a nested block.
    const fn = chat.slice(i, chat.indexOf('THE CONVERSATION AGENT', i));
    assert.ok(fn.includes('querySelectorAll'), 'the handler locks one button by id again');
    assert.ok(/_exportingQuote = false/.test(fn.slice(fn.indexOf('finally'))),
        'the re-entry guard is not released in the finally — one failure and the button is dead');
});
