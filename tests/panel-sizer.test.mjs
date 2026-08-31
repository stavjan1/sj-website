// Guards for the panel module calculator.
//
// The whole reason this is code and not a paragraph in a prompt is that the
// arithmetic has to be exactly right — a panel one size too small is a second
// trip and a second panel. So the tests are the worked examples an electrician
// would recognise, with the numbers stated.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sizePanel, renderPanelSizerBlock, MODULE_WIDTHS, STANDARD_SIZES,
} from '../functions/api/_panel_sizer.js';

test('the widths that matter are the widths the trade uses', () => {
  // Stav's own numbers, which are also DIN 43880.
  assert.equal(MODULE_WIDTHS.rcd_4p.modules, 4);      // פחת תלת-פאזי
  assert.equal(MODULE_WIDTHS.main_3p.modules, 3);     // הראשי
  assert.equal(MODULE_WIDTHS.contactor.modules, 3);   // מגען
  assert.equal(MODULE_WIDTHS.shabbat_timer.modules, 4); // ~3.5 physically, planned as 4
  assert.equal(MODULE_WIDTHS.mcb_1p.modules, 1);
});

test('a plain three-phase flat panel comes out at the size you would buy', () => {
  // 3P main (3) + 4P RCD (4) + 12 single-pole MCBs (12) = 19 equipped.
  const r = sizePanel([
    { type: 'main_3p' },
    { type: 'rcd_4p' },
    { type: 'mcb_1p', qty: 12 },
  ]);
  assert.equal(r.equipped, 19);
  assert.equal(r.spare, 5);        // ceil(19 * 0.25) = 5, above the floor of 4
  assert.equal(r.required, 24);
  assert.equal(r.size, 24);
  assert.equal(r.rows, 2);         // 2 × 12
});

test('a contactor and a Shabbat timer are 7 modules between them', () => {
  // The two devices most often left out of a size estimate, because they are
  // not breakers and do not appear on a circuit list.
  const bare = sizePanel([{ type: 'main_3p' }, { type: 'rcd_4p' }, { type: 'mcb_1p', qty: 12 }]);
  const withExtras = sizePanel([
    { type: 'main_3p' }, { type: 'rcd_4p' }, { type: 'mcb_1p', qty: 12 },
    { type: 'contactor' }, { type: 'shabbat_timer' },
  ]);
  assert.equal(withExtras.equipped - bare.equipped, 7);
  assert.equal(withExtras.equipped, 26);
  assert.equal(withExtras.required, 33);
  assert.equal(withExtras.size, 36);   // 26 equipped still needs a 36, not a 24
  assert.equal(withExtras.rows, 2);    // 2 × 18
});

test('spare space has a floor, so a tiny panel still gets room', () => {
  // 25% of 3 is 1 module of spare, which is not a panel anyone would install.
  const r = sizePanel([{ type: 'main_1p' }, { type: 'mcb_1p' }]);
  assert.equal(r.equipped, 3);
  assert.equal(r.spare, 4);        // the floor, not the ratio
  assert.equal(r.required, 7);
  assert.equal(r.size, 8);
});

test('the result always rounds UP to something you can actually buy', () => {
  for (let n = 1; n <= 40; n++) {
    const r = sizePanel([{ type: 'mcb_1p', qty: n }]);
    assert.ok(STANDARD_SIZES.includes(r.size), `size ${r.size} is not a real panel`);
    assert.ok(r.size >= r.required, `size ${r.size} is smaller than the ${r.required} required`);
  }
});

test('a panel bigger than anything sold reports null rather than a fiction', () => {
  // 72 is the largest standard size. Beyond it the honest answer is "this is
  // not one panel" — inventing a size would put a number in a quote that
  // cannot be ordered.
  const r = sizePanel([{ type: 'mcb_1p', qty: 200 }]);
  assert.equal(r.size, null);
  assert.equal(r.rows, null);
  assert.equal(r.equipped, 200);
});

test('an unrecognised device is reported, never silently dropped', () => {
  // Silently ignoring a device is exactly how a panel ends up one size short.
  const r = sizePanel([{ type: 'mcb_1p', qty: 4 }, { type: 'flux_capacitor' }]);
  assert.deepEqual(r.unknown, ['flux_capacitor']);
  assert.equal(r.equipped, 4);
});

test('quantities are honoured and zero means zero', () => {
  assert.equal(sizePanel([{ type: 'mcb_3p', qty: 3 }]).equipped, 9);
  assert.equal(sizePanel([{ type: 'mcb_1p', qty: 0 }]).equipped, 0);
  assert.equal(sizePanel([]).equipped, 0);
  assert.equal(sizePanel([]).size, null);
});

test('the prompt block carries the table and the counting trap', () => {
  const b = renderPanelSizerBlock();
  assert.ok(b.includes('DIN 43880'));
  assert.ok(b.includes('שעון שבת'), 'Shabbat timer missing from the table');
  assert.ok(b.includes('מגען'), 'contactor missing from the table');
  // The single most expensive counting mistake in a panel quote.
  assert.ok(b.includes('ספור מוליכים'), 'the conductors-not-breakers trap is missing');
  // Empty modules are not billable — this is what stops a 36-way panel being
  // quoted as 36 × 150 ₪.
  assert.ok(b.includes('מקומות ריקים אינם מתומחרים'));
  assert.ok(b.length < 3000, `block is ${b.length} chars — too fat to ride with the kit`);
});
