// The agent is handed two price sources in the same request: the anchors in
// functions/api/_pricing_map.js and the user's own labour book, which the
// prompt calls "מקור אמת" and tells it to take "as it is".
//
// So they must not disagree. On 29/08 they did, on the single most-asked
// question in the product: the map said a point costs ~120-200 while the book
// said 485 (single) and 450 (in a batch). Four times apart, both in one prompt,
// two lines above "אל תהיה הזול בשוק".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = readFileSync(join(ROOT, 'functions', 'api', '_pricing_map.js'), 'utf8');
const BOOK = JSON.parse(readFileSync(join(ROOT, 'sale', 'stern-pricing.json'), 'utf8'));
const APP = readApp();

test('the map and the labour book agree on what a point costs', () => {
    const pointRows = BOOK.filter((r) => /נק' מאור רגילה/.test(r.description || ''));
    assert.ok(pointRows.length >= 2, 'the labour book lost its lighting-point rows');
    const lowest = Math.min(...pointRows.map((r) => Number(r.price)));

    const line = (MAP.match(/- \*\*נקודת חשמל בודדת:[^\n]*/) || [])[0];
    assert.ok(line, 'the point anchor is gone from the pricing map');
    const nums = (line.match(/\d{2,4}/g) || []).map(Number);
    const anchorLow = Math.min(...nums);

    // The map may quote a batch rate below the single-point rate — that is the
    // real distinction both our book and the market make. What it may not do is
    // sit far below the book's own floor, which is what "120" did.
    assert.ok(anchorLow >= lowest * 0.5,
        `the map anchors a point at ${anchorLow} while the labour book's own floor is ${lowest} — the agent gets two contradictory answers in one prompt`);
});

test('no tender number is given as an instruction', () => {
    // "במכרז השתמש ב-28/40" was an operating instruction built on a number
    // nobody had verified against a real bill of quantities. Quoting it wins the
    // tender and loses money on it.
    assert.ok(!/במכרז השתמש ב-?\d/.test(MAP),
        'the map tells the agent to quote a specific tender number again');
    assert.match(MAP, /אל תנקוב מספר — שאל/,
        'the tender branch no longer refuses to invent a number');
});

test('a service with no price is named, never priced at zero', () => {
    const unpriced = BOOK.filter((r) => r && r.description && !(Number(r.price) > 0));
    if (!unpriced.length) return;                 // nothing to protect
    const i = APP.indexOf('function getSternLaborPromptBlock');
    const body = APP.slice(i, APP.indexOf('\n}', i));
    // It must still be impossible to quote them at 0 …
    assert.match(body, /Number\(it\.price\) > 0/,
        'a zero-priced row can reach the priced list and be quoted as free');
    // … and equally impossible for them to vanish, which is what was happening:
    // five thermographic services the electrician actually sells, invisible to
    // the agent, so asked about one it did not know they existed.
    assert.match(body, /!\(Number\(it\.price\) > 0\)/,
        'rows with no price are silently dropped again — the agent cannot offer them at all');
    assert.match(body, /אל תמציא להם מחיר/,
        'the instruction not to invent a price for them is gone');
});
