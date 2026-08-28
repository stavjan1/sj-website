// The pricing-benchmark pipeline is the one place in the product where data
// from many electricians is pooled, and the whole deal it offers is: aggregate
// only, no client details, no way to trace a sample to a person. Two properties
// hold that deal up, and neither is visible in a diff.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'functions', 'api', 'stats.js'), 'utf8');

test('one sender cannot suppress another sender\'s sample', () => {
    // The quote id is chosen by the caller, on an endpoint that requires no
    // account. While the dedup key was global, claiming an id in advance made
    // the real submission arrive and be dropped as a duplicate — deleting
    // somebody else's contribution without touching their data.
    assert.match(SRC, /stats:seen:\$\{who\}:\$\{quoteId\}/,
        'the dedup key is scoped to the sender, not global');
    assert.ok(!/`stats:seen:\$\{quoteId\}`/.test(SRC), 'and the global form is gone');
});

test('the scope is a hash, not an address', () => {
    // An anonymous pipeline that quietly starts storing IP addresses next to
    // pricing samples is no longer an anonymous pipeline.
    const i = SRC.indexOf('async function senderScope');
    assert.ok(i > 0, 'senderScope exists');
    const body = SRC.slice(i, SRC.indexOf('\n}', i));
    assert.match(body, /SHA-256/, 'the address is hashed');
    assert.ok(!/return ip\b/.test(body), 'and never returned raw');
    assert.match(body, /catch/, 'and a platform without subtle crypto still answers');
});

test('a bad or missing sample never breaks the export it rides on', () => {
    // Every rejection path here answers 200 with a reason: this call happens
    // during a PDF download, and a failure that surfaces to the user turns a
    // silent benchmark into a broken button.
    for (const skip of ['no-kv', 'rate', 'out-of-bounds']) {
        assert.match(SRC, new RegExp("skipped: '" + skip + "' \\}, 200"),
            `${skip} answers 200, not an error`);
    }
});
