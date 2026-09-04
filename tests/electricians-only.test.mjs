// The product is for electricians. Only electricians.
//
// Stav, 4.9.2026: a friend signed in for the first time and the app asked him
// which trade he works in. That question was a leftover of a multi-trade
// design (plumbers, HVAC, renovators, "general") that was dropped as a product
// but survived as code: a first-login modal, a settings control, an eight-way
// prompt switch, and a stats bucket per trade. The last one was a real bug —
// guests posted their prices under 'general' while the agent priced them as an
// electrician, so the benchmark was split across two buckets.
//
// These guards keep the trade question from coming back in any of its forms.
// Comments are stripped before matching: the code carries comments that
// explain this cleanup and necessarily quote what was removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

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
            // A trailing line comment after code: keep the code, drop the note.
            const at = l.indexOf(' // ');
            return at === -1 ? l : l.slice(0, at);
        })
        .join('\n');
}

const SALE_HTML = stripComments(read('site/sale/index.html'));
const HOME_HTML = stripComments(read('site/index.html'));
const SERVICES_HTML = stripComments(read('site/services.html'));
const ZEREM_HTML = stripComments(read('site/zerem/index.html'));
const LLMS = read('site/llms.txt');
const APP = stripComments(readApp());
const STATS = stripComments(read('functions/api/stats.js'));

test('a first sign-in is never asked which trade it works in', () => {
    assert.ok(!/google-profession-modal/.test(SALE_HTML), 'the first-login trade modal is back');
    assert.ok(!/google-reg-profession/.test(SALE_HTML), 'the trade <select> of the first-login modal is back');
    assert.ok(!/saveGoogleUserProfession/.test(APP + SALE_HTML), 'the trade modal submit handler is back');
    assert.ok(!/tempGoogleUser/.test(APP), 'a sign-in is parked in window.tempGoogleUser waiting for a trade answer');
});

test('the first-login callback opens the app as an electrician, straight away', () => {
    const at = APP.indexOf('function handleGoogleLogin(');
    assert.ok(at !== -1, 'handleGoogleLogin moved');
    const body = APP.slice(at, APP.indexOf('\nasync function completeGoogleLogin(', at));
    assert.match(body, /completeGoogleLogin\(email, 'electrician', token, rememberMe\)/,
        'the Google token callback does not call completeGoogleLogin with the one trade');
    // The account record is written in the callback itself (the modal used to
    // be the only place that created it).
    assert.match(body, /profession: 'electrician'/, 'a new account record is not written as an electrician');
    assert.match(body, /localStorage\.setItem\('sj_app_users'/, 'the callback does not persist the account record');
});

test('the walkthrough fires right after the first sign-in, not on the next reload', () => {
    for (const fn of ['async function completeGoogleLogin(', 'function proceedAsGuest(']) {
        const at = APP.indexOf(fn);
        assert.ok(at !== -1, `${fn} moved`);
        const body = APP.slice(at, APP.indexOf('\n}\n', at));
        assert.match(body, /queueWelcomeOnboarding\(\)/, `${fn} does not queue the first-run walkthrough`);
    }
});

test('there is no trade list and no trade control anywhere in the app', () => {
    assert.ok(!/\bPROFESSIONS\b/.test(APP), 'a closed trade list is back in the app');
    assert.ok(!/fillProfessionOptions|professionAiRole|updateUserProfileProfession/.test(APP),
        'a trade-list helper is back');
    assert.ok(!/LABOR_BOOK_PROFESSIONS/.test(APP), 'the labour book is gated by trade again');
    assert.ok(!/settings\.profession\b/.test(APP.replace(/settings\.profession = 'electrician'/g, '')),
        'something reads settings.profession to decide behaviour');
    assert.ok(!/תחום עיסוק/.test(SALE_HTML), 'a "תחום עיסוק" control is back in the settings');
    assert.ok(!/settings-profession|profile-field-profession/.test(SALE_HTML), 'the settings trade row is back');
});

test('every agent prompt addresses one trade', () => {
    assert.match(APP, /const AI_ROLE = 'חשמלאי מוסמך'/, 'the agent role is no longer the one literal');
    assert.ok(!/case 'plumber'|case 'hvac'|case 'renovator'|case 'contractor'/.test(APP),
        'the pricing prompt switches on trade again');
    // Eval scripts locate the pricing prompt by this name — it must survive.
    assert.match(APP, /function getProfessionSystemInstruction\(/, 'the eval harness lost its prompt anchor');
    assert.ok(!/אינסטלטור|טכנאי מיזוג|קבלן שיפוצים|קבלן בנייה/.test(APP), 'a non-electrical role is back in a prompt');
});

test('the stats pipeline has one bucket, whatever the client sends', () => {
    assert.match(STATS, /function normProfession\(\)\s*\{\s*return PROF;\s*\}/,
        'normProfession does not collapse every input to the one trade');
    assert.match(STATS, /const PROF = 'electrician'/, 'the bucket literal changed — that is a KV migration');
    assert.ok(!/searchParams\.get\('prof'\)/.test(STATS), 'the server reads ?prof= again');
    assert.ok(!/'general'/.test(STATS), "a 'general' fallback bucket is back on the server");
    assert.ok(!/prof=/.test(APP), 'the client sends ?prof= again');
    assert.ok(!/\|\| 'general'/.test(APP), "the client falls back to a 'general' bucket again");
    assert.ok(!/<th>מקצוע<\/th>/.test(APP), 'the admin stats table shows a trade column again');
    assert.match(STATS, /const key = bucketKey\(job\);/,
        'the sample is not filed under the job the client sent');
    assert.ok(!/bucketKey\(prof/.test(STATS),
        'bucketKey is called with the old (prof, job) shape — the trade lands as the job and every sample goes to other');
});

test('the words a new user reads say electricians', () => {
    const banned = /לבעלי מקצוע|לאנשי מקצוע|קבלני שיפוצים|אינסטלט/;
    const pages = [
        ['site/sale/index.html', SALE_HTML], ['site/zerem/index.html', ZEREM_HTML], ['llms.txt', LLMS],
        ['index.html', HOME_HTML], ['services.html', SERVICES_HTML],
    ];
    for (const [name, text] of pages) {
        const hit = text.match(banned);
        assert.ok(!hit, `${name} still addresses another trade: "${hit && hit[0]}"`);
    }
    assert.match(SALE_HTML, /תמחור והצעות מחיר לחשמלאים/, 'the lock card no longer says who the product is for');
    assert.match(SALE_HTML, /הצעות המחיר החכמה לחשמלאים/, 'the About card no longer says who the product is for');
    assert.match(LLMS, /for electricians/, 'llms.txt no longer says who the product is for in English');
    assert.match(HOME_HTML, /הצעות המחיר שלנו לחשמלאים/, 'the homepage promo no longer says who the product is for');
    assert.match(SERVICES_HTML, /לחשמלאים: מערכת הצעות המחיר החכמה/, 'the services card no longer says who the product is for');
    assert.ok(!/ובהמשך גם/.test(LLMS), 'llms.txt promises other trades again');
    assert.ok(!/תחום עיסוק/.test(read('functions/api/assistant.js')),
        'the system helper directs users to a trade control that does not exist');
});
