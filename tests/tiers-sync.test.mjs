// The tier table exists twice — once on the server, which ENFORCES it, and once
// in the client, which needs a number before any request has been answered.
// Two copies of the same table is how a limit gets changed in one place and
// quietly not in the other: the guest ceiling was cut to 3 on the server and
// the client kept telling people they had 100, so the warning that fires at
// "one left" never fired at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();
const SERVER = readFileSync(join(ROOT, 'functions', 'api', '_tiers.js'), 'utf8');

const num = (src, tier, field) => {
    const i = src.indexOf(tier + ':');
    if (i < 0) return null;
    const m = src.slice(i, i + 400).match(new RegExp(field + ':\s*(-?\d+)'));
    return m ? Number(m[1]) : null;
};

test('the two copies of the tier table agree on every limit', () => {
    const drift = [];
    for (const tier of ['guest', 'free', 'pro', 'business']) {
        for (const field of ['aiDaily', 'projects', 'quotesPerMonth', 'catalogItems']) {
            const a = num(SERVER, tier, field);
            const b = num(APP, tier, field);
            if (a !== null && b !== null && a !== b) drift.push(`${tier}.${field}: server ${a}, client ${b}`);
        }
    }
    assert.deepEqual(drift, [], 'the client is showing limits the server does not enforce');
});

test('the plan names agree too, and the stored values never move', () => {
    // Silver/Gold/Diamond are LABELS. The stored tier values are free/pro/
    // business and are written into every tier:<email> key already in KV —
    // renaming those would reassign every existing customer to a plan they
    // never chose.
    for (const label of ['סילבר', 'גולד', 'דיימונד']) {
        assert.ok(SERVER.includes(label), `the server lost the label ${label}`);
        assert.ok(APP.includes(label), `the client lost the label ${label}`);
    }
    assert.match(SERVER, /TIER_NAMES = \['guest', 'free', 'pro', 'business'\]/,
        'the stored tier values changed — every existing customer just moved plan');
});
