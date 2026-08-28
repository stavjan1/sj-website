// The screen that shows every user's conversations to the operator.
//
// It exists so the pricing agent can be tuned against what electricians
// actually type. It also returns other people's businesses — customer names,
// addresses, prices — so five independent attacks were run against it before it
// shipped. The gate held; everything below is what did not, and each of these
// tests is one of those findings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const API = read('functions/api/admin-convos.js');
const ADMIN = read('sale/admin.js');

test('the gate is the first thing that happens, and nothing writes', () => {
    // Order matters literally: any read of SJ_DATA that could be reached before
    // adminGate would serve data to whoever asked.
    const gate = API.indexOf('await adminGate(request)');
    const firstRead = API.indexOf('env.SJ_DATA');
    assert.ok(gate > -1, 'the admin gate is gone');
    assert.ok(gate < firstRead, 'something touches storage before the gate');
    // A GET-only surface cannot be talked into writing or deleting.
    assert.ok(!/onRequestPost|onRequestPut|onRequestDelete|onRequestPatch/.test(API),
        'this endpoint gained a writing method — it is meant to be read-only');
    // And no branch may return a whole person's record: one user without one
    // thread id is refused.
    assert.match(API, /if \(!target \|\| !id\)/,
        'a user can be requested without naming a thread, which returns everything they have written');
});

test('a timestamp from a user record cannot take the screen down', () => {
    // /api/data stores {...incoming} unfiltered, so `touched` is whatever a
    // signed-in browser last sent. new Date(n).toISOString() throws RangeError
    // outside ±8.64e15, and the throw was inside a .map() — so one user could
    // have permanently blanked the card AND every keystroke in its search box.
    assert.match(API, /8\.64e15/, 'the timestamp clamp is gone from threadTime');
    const feed = ADMIN.slice(ADMIN.indexOf('function renderAdminConvoList'));
    const body = feed.slice(0, feed.indexOf('\n}'));
    assert.ok(!/toISOString/.test(body),
        'the feed is formatting dates with toISOString again — it throws, and it throws inside a map');
    assert.match(body, /crWhen\(/, 'the feed no longer uses the safe date helper');
});

test('what the app hides from the user is not shown to the operator', () => {
    // The agent appends a ```json block to every answer and is told the block is
    // not shown to the user. The client strips it in visibleChatText; the stored
    // record keeps it. A reader that does not strip shows machinery the user
    // never saw — in both the feed and the full thread, since both go through
    // turnText.
    const fn = API.slice(API.indexOf('function turnText'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /indexOf\('```'\)/, 'turnText stopped cutting the hidden block');
    // The same cut the client makes, so the two cannot drift.
    const chat = read('sale/chat.js');
    assert.match(chat, /function visibleChatText[\s\S]{0,220}indexOf\('```'\)/,
        'the client-side cut moved — the server copy of this rule needs to move with it');
});

test('a greeting is not a conversation', () => {
    // Every JOB is seeded with a model greeting that is not marked hidden, so
    // counting turns said "1" before anybody had typed a word — and the feed
    // filled with jobs whose only content was a title the app had generated from
    // a customer's name. The test is whether a person said something.
    assert.match(API, /turns\.some\(\(m\) => m\.role === 'user'\)/,
        'the feed is back to listing threads nobody has spoken in');
});

test('one refresh cannot spend the day\'s storage budget', () => {
    // The daily KV budget is shared with the whole product: when it runs out,
    // /api/data returns 500 to every electrician and the pricing agent stops
    // answering. A held Enter key on a focused refresh button is ~30 requests a
    // second, and each request was one read per user.
    const cap = API.match(/const MAX_USERS = (\d+)/);
    assert.ok(cap && Number(cap[1]) <= 150, 'MAX_USERS is above the reviewed ceiling of 150');
    assert.equal((API.match(/cacheTtl: 300/g) || []).length, 2,
        'both storage reads must be cached — a repeat refresh should cost almost nothing');

    const fn = ADMIN.slice(ADMIN.indexOf('async function renderAdminConvos'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /if \(_convosLoading\) return;/, 'the double-click guard is gone');
    assert.match(body, /finally\s*\{[\s\S]{0,80}_convosLoading = false;/,
        'the guard is not released in a finally — one failed load would lock the button forever');
});

test('one unreadable record does not discard the whole scan', () => {
    assert.match(API, /catch \{ failed \+= 1; continue; \}/,
        'a single failed read throws away every read already paid for');
});

test('the label does not claim a recency the scan never established', () => {
    // KV lists keys alphabetically by email, so stopping early drops whoever
    // sorts after the cut — not the oldest. Two different truncations, and only
    // one of them means "the newest are shown".
    assert.match(API, /usersTruncated/, 'the two kinds of truncation are conflated again');
    const i = ADMIN.indexOf('מוצגות האחרונות בלבד');
    if (i > -1) {
        const around = ADMIN.slice(Math.max(0, i - 400), i);
        assert.match(around, /usersTruncated/,
            'the "most recent" label is shown even when the scan stopped alphabetically');
    }
});

test('the terms tell users this screen exists', () => {
    // The one check here that is not about code, and the one that matters most:
    // a refactor could keep the screen and quietly drop the disclosure. The
    // document that governs ZEREM is zerem/terms.html — privacy.html points at
    // it — and its section 5 used to license processing "for providing the
    // service ONLY", which this is not.
    const terms = read('zerem/terms.html');
    assert.match(terms, /עיון בשיחות עם הסוכן/,
        'the terms no longer disclose that the operator can read stored conversations');
    assert.match(terms, /ועיון של המפעיל בשיחות עם הסוכן/,
        'the content licence in section 5 no longer covers reading conversations');
    // And it must stay honest about whose details end up in there.
    assert.match(terms, /לקוחותיו \(שם, כתובת, הערות\)/,
        'the terms stopped saying that a conversation may contain the user\'s own customers\' details');
});
