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

test('the landing page sells the plans the app actually gives', () => {
    // The price section advertised "ללא הגבלת פרויקטים" on the free plan while
    // the app gives three, and promised a Pro tier "בקרוב" that had been live
    // for months. A landing page that oversells by one number is not marketing,
    // it is the first broken promise a new user meets: he opens the fourth job
    // and hits a wall nobody warned him about.
    const raw = readFileSync(new URL('../site/zerem/index.html', import.meta.url), 'utf8');
    // Scan the PAGE, not the notes about it. A comment explaining which claim
    // was removed contains that claim, and a test that reads it fails on the
    // very fix it is guarding.
    const land = raw.replace(/<!--[\s\S]*?-->/g, '');

    for (const label of ['סילבר', 'גולד', 'דיימונד']) {
        assert.ok(land.includes(label), `the landing page lost the ${label} plan`);
    }
    // The two prices Stav set. If they move in the app they must move here.
    for (const price of ['19', '49']) {
        assert.ok(land.includes('₪' + price), `the landing page does not show the ₪${price} plan`);
    }
    assert.ok(!/ללא הגבלת פרויקטים/.test(land),
        'the landing page promises unlimited projects on a plan capped at 3');
    assert.ok(!/גרסת Pro[^<]*בקרוב/.test(land),
        'the landing page still calls the paid tier "coming soon"');
    // The free plan's cap must be stated where the free plan is sold.
    assert.ok(/3 עבודות פתוחות/.test(land),
        'the free plan is sold without naming its limit');
});

test('a paid capability is enforced where it cannot be edited — on the server', () => {
    // The browser hides the camera button when chatPhotos is false, and that was
    // the whole enforcement: functions/api/chat.js never mentioned the flag, so a
    // request carrying images was served to any tier. A vision call costs
    // meaningfully more than a text one, on a quota everybody shares, and the
    // browser is the one place a user can edit.
    const chat = readFileSync(new URL('../functions/api/chat.js', import.meta.url), 'utf8');
    assert.match(chat, /limits\.chatPhotos/,
        'the chat endpoint does not consult chatPhotos — the photo gate is browser-only again');
    assert.match(chat, /images: undefined/,
        'images are no longer stripped for a tier that may not send them');
});

test('invoicing is a diamond capability, enforced on the server and named in both tables', () => {
    // Stav, 30/08: "לחיצה עליהם תגיד שזה למשתמשי דיימונד." Invoicing moved out of
    // gold on that call, and the server used to decide it with a hardcoded
    // `tier !== 'pro' && tier !== 'business'` — two places to change, one of
    // which would have been missed.
    const inv = readFileSync(new URL('../functions/api/invoice.js', import.meta.url), 'utf8');
    assert.match(inv, /limits\.invoicing !== true/,
        'the invoice endpoint no longer gates on the capability');
    assert.doesNotMatch(inv, /tier !== 'pro'/,
        'the invoice endpoint is naming tiers again instead of reading the flag');

    // business true, pro/free/guest false — on BOTH sides.
    const seg = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));
    for (const [label, src, pro, biz] of [
        ['server', SERVER, 'pro: {', 'business: {'],
        ['client', APP, 'pro:      {', 'business: {'],
    ]) {
        assert.match(seg(src, pro, biz), /invoicing: false/,
            `${label}: gold still has invoicing`);
    }
    assert.match(SERVER.slice(SERVER.indexOf('business: {')), /invoicing: true/,
        'server: diamond lost invoicing');
    assert.match(APP.slice(APP.indexOf('business: {')), /invoicing: true/,
        'client: diamond lost invoicing');
});
