// The plans dialog is a price list. Everything on it is a promise, and a promise
// the product refuses the first time it is used costs more than the feature was
// worth: the free card offered "תמונה או שתיים ביום" while BOTH tier tables set
// chatPhotos:false for free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readApp } from './_app-source.mjs';

const APP = readApp();
const SERVER = readFileSync(new URL('../functions/api/_tiers.js', import.meta.url), 'utf8');

function cardFor(tier) {
    const i = APP.indexOf("tier: '" + tier + "'");
    assert.ok(i > -1, 'the ' + tier + ' plan card is gone');
    const end = APP.indexOf('},', i);
    // Scan the CARD, not the notes beside it. A comment recording which promise
    // was removed contains that promise, and a test that reads it fails on the
    // very fix it is guarding. That has now happened four times in this repo.
    return APP.slice(i, end).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

// Capability -> the words that would be selling it on a card.
const SOLD_AS = {
    chatPhotos: ['תמונה', 'תמונות'],
    reports: ['דוח', 'דוחות'],
    reminders: ['תזכורת', 'תזכורות'],
    shareLink: ['קישור אישור'],
};

test('the free plan card never advertises a capability the tier tables deny it', () => {
    const card = cardFor('free');
    const broken = [];
    for (const [cap, words] of Object.entries(SOLD_AS)) {
        // Both tables must agree the free tier does NOT have it.
        const clientOff = new RegExp(cap + ': false').test(APP.slice(APP.indexOf('free:     {'), APP.indexOf('pro:      {')));
        const serverOff = new RegExp(cap + ': false').test(SERVER.slice(SERVER.indexOf('free: {'), SERVER.indexOf('pro: {')));
        if (!(clientOff && serverOff)) continue;
        for (const w of words) {
            if (card.includes(w)) broken.push(cap + ' is off for free but the card says "' + w + '"');
        }
    }
    assert.deepEqual(broken, [], 'the plans dialog promises the free plan something it does not get');
});
