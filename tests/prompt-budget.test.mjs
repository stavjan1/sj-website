// The free tier's real ceiling is TOKENS per day, not requests per day.
//
// Measured: ~11,000 input tokens on a pricing turn and ~18,000 on a
// characterisation one, because the map plus the checklists plus the catalogue
// lookup is 20–33KB of Hebrew every time. Ninety-two questions spent roughly
// 1.7 million tokens — which is how a "1,500 requests a day" allowance ran out
// after ninety.
//
// These guard the trimming, and mostly they guard it from being too eager: a
// block wrongly withheld makes the answer worse, and a worse answer costs far
// more than the tokens ever will.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING_MAP, trimPricingMap, isTrivialTurn } from '../functions/api/_pricing_map.js';

test('a greeting carries no pricing knowledge at all', () => {
  for (const t of ['שלום', 'היי', 'תודה', 'תודה רבה', 'אוקיי', 'בוקר טוב', 'כן', 'מעולה']) {
    assert.ok(isTrivialTurn(t), `still sends the whole map for: ${t}`);
  }
});

test('anything that could be a job keeps everything', () => {
  // The expensive mistake would be here. A question with work in it must never
  // be treated as small talk, however short it is.
  for (const t of [
    'כמה עולה נקודת חשמל',
    'החלפת לוח',
    '3 שקעים',
    'עמדת טעינה',
    'כמה זה עולה',
    'תמחר לי בבקשה החלפת לוח דירתי',
    'הזזת נקודה',
  ]) {
    assert.ok(!isTrivialTurn(t), `treated a real question as a greeting: ${t}`);
  }
});

test('the utility fee tables go only where they can be used', () => {
  const full = DEFAULT_PRICING_MAP;
  // A turn about the utility keeps them.
  for (const t of ['הגדלת חיבור מ-1x40 ל-3x25', 'לוח פיצול', 'צריך להזמין את חח"י', 'מונה נפרד']) {
    assert.equal(trimPricingMap(full, t).length, full.length, `dropped the fee tables on: ${t}`);
  }
  // A turn that cannot use them does not carry them.
  const trimmed = trimPricingMap(full, 'התקנת 6 גופי תאורה בתקרת גבס');
  assert.ok(trimmed.length < full.length, 'the fee tables were sent to a lighting job');
  assert.ok(!/1X25→3X40/.test(trimmed), 'a fee table survived the trim');
});

test('trimming never damages the rest of the map', () => {
  // The parts that carry Stav's own corrections must survive every trim, or the
  // saving costs a wrong price.
  const trimmed = trimPricingMap(DEFAULT_PRICING_MAP, 'התקנת גופי תאורה');
  for (const must of ['תיקוני שטח מסתיו', 'חוקי כבלים', 'בלוק: ~700', 'חשמלאי בודק']) {
    assert.ok(trimmed.includes(must), `the trim removed something load-bearing: ${must}`);
  }
  // And the section boundary is respected — no half-table left behind.
  assert.ok(!/### הגדלת חיבור/.test(trimmed), 'half a fee section survived');
});

test('the חח"י call-out fee survives, because it is not a utility TABLE', () => {
  // Stav's 300-per-visit rule lives above the fee tables and applies to any
  // panel job. Losing it with the tables would re-open the 600 ₪ hole he found.
  const trimmed = trimPricingMap(DEFAULT_PRICING_MAP, 'התקנת גופי תאורה');
  assert.ok(trimmed.includes('~300 ₪'), 'the call-out fee was trimmed away with the tables');
});
