// Putting a catalogue price on an item the model named.
//
// Stav approved building this after the measurement that made it necessary:
// searchMaterials always returns something, has no way to say "not found", and
// its top hit is confidently wrong often enough to matter. Two of the first
// nine were wrong by more than ten times —
//
//     "מפסק פקט 40A"        → מפסק פקט 3X25 מוגן פיצוץ    1,705 ₪
//     "גוף תאורה שקוע בגבס"  → גוף תאורה היקפית 4000lm     1,355 ₪
//
// — and substituting a top hit blindly would put those into a customer's quote.
//
// So this gate is built for PRECISION, not coverage. Measured on 40 bill-of-
// quantities lines: 13 priced, and all 13 correct. The other 27 keep the
// model's own estimate, marked as an estimate, which is exactly what the rest
// of the product already does. A missed price costs nothing; a wrong one costs
// Stav in front of a customer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { identityTokens, confidentMatch } from '../functions/api/_price_match.js';
import { hydrate } from '../functions/api/_materials.js';

// Built through the real hydrate(), so the index these are tested against is
// the index production uses — a hand-rolled stand-in would quietly skip the
// token expansion the matcher depends on.
const db = hydrate({
  cats: ['בדיקה'],
  units: ['יחידה'],
  //     sku, name,                                          price,  unit, cat, attrs
  items: [
    ['1', 'ממסר פחת 4X40A 30MA דגם VEGA A',                  86.53, 0, 0, '40A'],
    ['2', 'מפסק פקט 3X25 מוגן פיצוץ+מגע עזר N.O',            1705,  0, 0, ''],
    ['3', 'מסגרת לבנה 60x60 להפיכת פנל שקוע לחיצוני',        55.34, 0, 0, ''],
    ['4', 'פס השוואה 4x40x200 כ- 7 ברגים',                   34.07, 0, 0, ''],
    ['5', 'נעל כבל נחושת 10 ממ"ר חור 10',                    0.76,  0, 0, '16'],
    ['6', 'נעל כבל נחושת 16 ממ"ר חור 10',                    0.9,   0, 0, ''],
    ['7', 'דיבל 6 מ"מ (100)',                                3.9,   0, 0, '8'],
  ],
});

test('a rating that is missing from the name is not a match', () => {
  // The trap that started this: everything but the rating lined up, and the
  // rating is the entire difference between the item and its neighbour.
  assert.equal(confidentMatch(db, 'מפסק פקט 40A'), null,
    'a 3X25 explosion-proof switch was priced as a 40A pakat');
});

test('a rating found only in the attributes does not count', () => {
  // "נעל כבל 16" took a 10 ממ"ר lug whose ATTRIBUTES happened to contain 16,
  // and "דיבל 8" took a 6 מ"מ plug the same way. A rating has to be in the name.
  const lug = confidentMatch(db, 'נעל כבל 16');
  assert.ok(lug, 'the real 16 ממ"ר lug was not found');
  assert.match(lug.name, /16 ממ/, `took the wrong lug: ${lug.name}`);
  assert.equal(confidentMatch(db, 'דיבל 8'), null, 'a 6 מ"מ plug was priced as an 8');
});

test('the head noun has to be the head, not a word further along', () => {
  // Both of these contain every word asked for, and neither is the product.
  assert.equal(confidentMatch(db, 'פנל לד 60x60'), null,
    'a frame FOR a panel was priced as a panel');
  assert.equal(confidentMatch(db, 'ברגים 4x40'), null,
    'a busbar that mentions screws was priced as screws');
});

test('a genuine match is still made', () => {
  const rcd = confidentMatch(db, 'ממסר פחת 4x40A');
  assert.ok(rcd, 'rejected an item that matches on every term');
  assert.equal(rcd.price, 86.53);
  assert.equal(rcd.sku, '1');
});

test('nothing to identify means no price', () => {
  // An empty or filler-only name must never be handed the first thing in the
  // catalogue.
  for (const junk of ['', '   ', 'יחידה', 'רגיל']) {
    assert.equal(confidentMatch(db, junk), null, `priced junk: "${junk}"`);
  }
});

test('ratings and sizes are always part of the identity', () => {
  const t = identityTokens('כבל N2XY 5x6 ממ"ר');
  assert.ok(t.includes('5x6'), 'the cross-section is not treated as identifying');
  assert.ok(!t.includes('מ'), 'a one-letter filler became identifying');
});
