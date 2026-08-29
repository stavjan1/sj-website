// The free KV tier allows 1,000 WRITES PER DAY across the whole product, and the
// owner has decided not to upgrade. That budget is shared by the things that
// matter (every electrician's cloud backup, the AI quotas) and the things that
// do not (page-view counters, anonymous pricing samples).
//
// Both of the "do not" writers were unauthenticated and unbounded against that
// budget: /api/stats could spend ~45 writes on one request, and the analytics
// ceiling meant to protect the budget was set six times ABOVE it. Either one
// could take cloud sync down for every user, and the failure surfaced as
// Cloudflare's bare 502.
//
// These pin the arithmetic, because it is the kind that drifts one constant at
// a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const num = (src, name) => {
    // No regex: the escapes in this repo have been mangled by tooling
    // more than once, and a broken pattern here reads as "the constant
    // is gone" rather than as a broken test.
    const i = src.indexOf('const ' + name);
    assert.ok(i > -1, `${name} is gone`);
    const seg = src.slice(i + name.length + 6, i + name.length + 40);
    const digits = seg.replace(/[^0-9]/g, ' ').trim().split(' ')[0];
    assert.ok(digits, `${name} has no numeric value`);
    return Number(digits);
};

const BUDGET = 1000;   // Cloudflare KV free tier, writes/day

test('one anonymous /api/stats request cannot cost a tenth of the daily budget', () => {
    const stats = read('functions/api/stats.js');
    const items = num(stats, 'ITEMS_PER_QUOTE');
    // limiter + daily-cap + dedup + bucket + items + 2 global counters
    const worst = 1 + 1 + 1 + 1 + items + 2;
    assert.ok(worst <= BUDGET / 10,
        `one request can cost ${worst} KV writes against a budget of ${BUDGET}/day`);
});

test('the stats endpoint has a day ceiling, not only a per-IP minute one', () => {
    // A per-IP limiter bounds one abuser and not a hundred. Without a day
    // ceiling the endpoint itself is unbounded.
    const stats = read('functions/api/stats.js');
    assert.match(stats, /dailyQuota\(env, 'stats:intake'/,
        'the stats intake lost its daily ceiling');
});

test('the analytics ceiling sits below the budget it exists to protect', () => {
    const a = read('functions/api/analytics.js');
    const cap = num(a, 'DAILY_HIT_CAP');
    // Every ACCEPTED hit costs two writes: rateLimit writes its own key first.
    assert.ok(cap * 2 < BUDGET,
        `${cap} hits x 2 writes = ${cap * 2}, above the ${BUDGET}/day budget it is meant to protect`);
});

test('a failed cloud save reaches the user instead of escaping as a 502', () => {
    const data = read('functions/api/data.js');
    const i = data.indexOf('SJ_DATA.put(key, payload)');
    assert.ok(i > -1, 'the cloud save moved');
    assert.match(data.slice(Math.max(0, i - 400), i), /try \{/,
        'the cloud write is unguarded again — an exhausted budget throws out of the Function');
    assert.match(data, /503/, 'the cloud save no longer answers with a status the client can act on');

    const app = readFileSync(new URL('../sale/app.js', import.meta.url), 'utf8');
    const j = app.indexOf('async function cloudSaveNow');
    const fn = app.slice(j, j + 2600);
    assert.match(fn, /res\.status === 503/,
        'the client swallows a failed cloud save again — the user believes their work is backed up');
});
