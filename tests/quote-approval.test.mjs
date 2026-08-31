// The customer approves from the link he was sent: no account, no app. The
// token is the authorisation, exactly as it is for reading the quote, so the
// rules around it are worth pinning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/quote-share.js';

function fakeKV(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        store,
        get: async (k) => (store.has(k) ? store.get(k) : null),
        put: async (k, v) => { store.set(k, v); },
    };
}

const put = (token, body, env) => onRequest({
    request: new Request('https://x/api/quote-share?t=' + token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    }),
    env,
});

test('the holder of the link can approve, once', async () => {
    const env = { SJ_DATA: fakeKV({ 'share:abcdefghij': JSON.stringify({ subject: 'עמדת טעינה', finalPrice: 5000 }) }) };
    const res = await put('abcdefghij', { name: 'דנה כהן' }, env);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.approved && body.approved.at, 'no approval was stamped');
    assert.equal(body.approved.name, 'דנה כהן');

    // A second press must not overwrite the first approval's time.
    const again = await (await put('abcdefghij', { name: 'מישהו אחר' }, env)).json();
    assert.equal(again.approved.at, body.approved.at, 'the approval time moved');
    assert.equal(again.approved.name, 'דנה כהן', 'the approver was overwritten');
});

test('a bad or unknown token approves nothing', async () => {
    const env = { SJ_DATA: fakeKV() };
    assert.equal((await put('!!', {}, env)).status, 400);
    assert.equal((await put('abcdefghij', {}, env)).status, 404);
});

test('the terms travel with the shared quote', async () => {
    // A customer deciding on a price needs to see how long it holds and what it
    // does not include, or the link is worse than the PDF.
    const src = readShare();
    for (const field of ['validityDays', 'paymentTerms', 'startWithinDays', 'durationDays', 'warranty', 'exclusions']) {
        assert.ok(src.includes(field + ':'), `${field} is not stored with a shared quote`);
    }
});

function readShare() {
    return readFileSync(new URL('../functions/api/quote-share.js', import.meta.url), 'utf8');
}
