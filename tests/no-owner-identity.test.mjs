// The product must not ship one man's business identity to everybody else.
//
// Found by walking in as a brand-new guest, which is the only way to find it:
// the DEFAULT business details were the builder's own — his business name, his
// name, his phone, his address and his עוסק פטור registration number. A new
// electrician signed up, priced a job, exported a PDF, and it came out carrying
// somebody else's tax number, ready to send to his customer.
//
// A quote with no business name is obviously unfinished and the app asks for
// one. A quote with the WRONG business name looks finished, and goes out.
//
// The same name was in the chat greeting — every user, forever — and inside the
// agent's own system prompts, which told it whose business it was working for
// across eight professions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'site', 'sale', 'index.html'), 'utf8');
const APP = readApp();

// Comments are prose, not shipped identity — and these files now carry comments
// EXPLAINING this bug, which necessarily quote the strings being banned. The
// first version of this test failed on its own explanations, which is the same
// trap the pricing map hit an hour earlier: a checker that cannot tell code
// from commentary reports the fix as the defect.
function stripComments(src) {
    let out = src;
    for (const [open, close] of [['<!--', '-->'], ['/*', '*/']]) {
        let i;
        while ((i = out.indexOf(open)) !== -1) {
            const j = out.indexOf(close, i + open.length);
            if (j === -1) break;
            out = out.slice(0, i) + ' ' + out.slice(j + close.length);
        }
    }
    return out
        .split('\n')
        .map((l) => {
            const t = l.trimStart();
            if (t.startsWith('//') || t.startsWith('*')) return '';
            return l;
        })
        .join('\n');
}

const HTML_CODE = stripComments(HTML);
const APP_CODE = stripComments(APP);

// His real, personal identifiers. The business NAME is allowed — it appears in
// the "built by" credit and on the marketing site, which is who made it. A tax
// registration number, a personal phone and a home-office address are not.
const PRIVATE = ['207382920', '053-530-2887', 'דרך בן גוריון 138'];

test('no personal identifier of the owner ships in the app', () => {
    const hits = [];
    for (const needle of PRIVATE) {
        for (const [label, src] of [['site/sale/index.html', HTML_CODE], ['app scripts', APP_CODE]]) {
            src.split('\n').forEach((line, n) => {
                if (line.includes(needle)) hits.push(`${label}:${n + 1} — ${needle}`);
            });
        }
    }
    assert.deepEqual(hits, [],
        "these ship the owner's own tax number / phone / address to every user of the product");
});

test('a new user starts with empty business details', () => {
    // Not "a sensible example" — empty. The one thing that must never be
    // pre-filled is the identity that ends up on a document sent to a customer.
    const i = APP_CODE.indexOf('businessDetails: {');
    assert.ok(i > -1, 'the default businessDetails object is gone');
    const block = APP_CODE.slice(i, APP_CODE.indexOf('terms:', i));
    for (const field of ['name', 'owner', 'id', 'phone', 'email', 'web', 'address']) {
        const m = block.match(new RegExp(field + ":\\s*'([^']*)'"));
        assert.ok(m, `businessDetails.${field} is gone`);
        assert.equal(m[1], '', `businessDetails.${field} ships pre-filled with "${m[1]}"`);
    }
});

test('the sheet and the settings form ship placeholders, not somebody', () => {
    assert.ok(!/id="pdf-comp-owner">סתיו/.test(HTML_CODE),
        'the quote sheet names the builder as the business owner');
    // A value= on a business field is a value that reaches a customer's PDF.
    const prefilled = [...HTML_CODE.matchAll(/<input[^>]*id="set-biz-\w+"[^>]*value="([^"]+)"/g)]
        .map((m) => m[0].slice(0, 60));
    assert.deepEqual(prefilled, [], 'these business fields ship pre-filled');
});

test('the agent is not told whose business it is working for', () => {
    // Eight profession prompts said the agent works "עבור סתיו ג'אן", and the
    // labour book was introduced as his price. For every other user both are
    // simply false, and an agent repeats what it is told.
    assert.ok(!/עבור סתיו/.test(APP_CODE), 'a profession prompt names the builder as the customer again');
    assert.ok(!/המחיר של סתיו/.test(APP_CODE), 'the labour book is attributed to the builder again');
});

test('the greeting greets whoever is actually there', () => {
    assert.ok(!/שלום סתיו/.test(HTML_CODE), 'the chat greets every user by the builder\'s name again');
    assert.match(APP_CODE, /function syncChatGreeting/, 'nothing personalises the greeting');
});
