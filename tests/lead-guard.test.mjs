// /api/lead sends SJ-branded mail to an address the caller chooses, without
// asking anyone to sign in. That is fine while RESEND_API_KEY is unset (nothing
// goes out) and is an open relay the moment it is set — which is exactly when
// nobody will be looking. These pin the ceilings that bound it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyQuota } from '../functions/api/_tiers.js';

// A KV double with the two calls the guard uses.
function kv(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        SJ_DATA: {
            get: async (k) => (store.has(k) ? store.get(k) : null),
            put: async (k, v) => { store.set(k, v); },
        },
    };
}

test('the same address cannot be mailed all day', async () => {
    const env = kv();
    assert.equal(await dailyQuota(env, 'lead:victim@example.com', 2), true);
    assert.equal(await dailyQuota(env, 'lead:victim@example.com', 2), true);
    assert.equal(await dailyQuota(env, 'lead:victim@example.com', 2), false);
    // A different address is a different bucket — a real visitor is unaffected.
    assert.equal(await dailyQuota(env, 'lead:someone@else.com', 2), true);
});

test('a global ceiling bounds the whole day, whatever the addresses', async () => {
    const env = kv();
    for (let i = 0; i < 60; i++) {
        assert.equal(await dailyQuota(env, 'lead:all', 60), true, 'send ' + i);
    }
    assert.equal(await dailyQuota(env, 'lead:all', 60), false);
});

test('the counter is per day, and expires on its own', async () => {
    const env = kv();
    await dailyQuota(env, 'lead:all', 60);
    const key = [...env.store.keys()][0];
    assert.match(key, /^dq:lead:all:\d{4}-\d{2}-\d{2}$/, 'the day is in the key');
});

test('no KV, or a broken one, opens the gate rather than closing the endpoint', async () => {
    assert.equal(await dailyQuota({}, 'lead:all', 1), true);
    assert.equal(await dailyQuota(null, 'lead:all', 1), true);
    const broken = { SJ_DATA: { get: async () => { throw new Error('KV down'); }, put: async () => {} } };
    assert.equal(await dailyQuota(broken, 'lead:all', 1), true,
        'a limiter that takes the endpoint down with it is worse than no limiter');
});

test('the endpoint refuses a "conversation" that is not one', () => {
    const src = readSource();
    assert.match(src, /turns\.some\(\(m\) => m\.role === 'user'\)/);
    assert.match(src, /turns\.some\(\(m\) => m\.role === 'assistant'\)/);
    // Both ceilings must be checked BEFORE the AI call, or a flood still costs
    // tokens even when no mail goes out.
    const guardAt = src.indexOf("dailyQuota(env, 'lead:all'");
    const aiAt = src.indexOf('await generate(env');
    assert.ok(guardAt > -1 && aiAt > guardAt, 'the guards must come before the model call');
});

function readSource() {
    return readFileSync(new URL('../functions/api/lead.js', import.meta.url), 'utf8');
}
import { readFileSync } from 'node:fs';
