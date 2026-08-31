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
  // A turn about the utility keeps them. This used to assert the whole map came
  // back, because the trim's only job was removing these tables. It is a topic
  // router now, so a utility turn gets the utility blocks and drops the lighting
  // and industrial ones — what must still hold is that the TABLES are there.
  for (const t of ['הגדלת חיבור מ-1x40 ל-3x25', 'לוח פיצול', 'צריך להזמין את חח"י', 'מונה נפרד']) {
    const out = trimPricingMap(full, t);
    assert.ok(out.includes('## אגרות חברת החשמל'), `dropped the fee tables on: ${t}`);
    assert.ok(out.includes('### הגדלת חיבור · מגורים'), `dropped a fee table body on: ${t}`);
  }
  // A turn that cannot use them does not carry them.
  const trimmed = trimPricingMap(full, 'התקנת 6 גופי תאורה בתקרת גבס');
  assert.ok(trimmed.length < full.length, 'the fee tables were sent to a lighting job');
  assert.ok(!/1X25→3X40/.test(trimmed), 'a fee table survived the trim');
});

test('trimming never damages the rest of the map', () => {
  // Stav's own corrections must survive, but "survive" now means something more
  // precise than it did. Under the old trim every block outside the fee tables
  // came back on every turn, so listing four load-bearing strings was a fair
  // check. A topic router is allowed — required — to drop the inspector's fee
  // from a lighting question. What may NEVER be dropped is the universal layer
  // and the provenance heading that gives a kept block its standing.
  const trimmed = trimPricingMap(DEFAULT_PRICING_MAP, 'התקנת גופי תאורה');
  for (const must of ['## חוקי כבלים', '## כללי-על', '## עוגני עבודה נוספים']) {
    assert.ok(trimmed.includes(must), `the trim removed something universal: ${must}`);
  }
  // The lighting block was kept, so the heading that says these numbers OVERRIDE
  // the conflicting ones above it has to come with it.
  assert.ok(trimmed.includes('### התקנת גופי תאורה'), 'precondition: the lighting block is kept');
  assert.ok(trimmed.includes('## תיקוני שטח מסתיו'), 'kept a subsection but dropped its ruling parent');
  // And the section boundary is respected — no half-table left behind.
  assert.ok(!/### הגדלת חיבור/.test(trimmed), 'half a fee section survived');
});

test('the חח"י call-out fee reaches every job that can incur it', () => {
  // Stav's 300-per-visit rule applies to any PANEL job, and losing it re-opens
  // the 600 ₪ hole he found. It lives in "### הזמנת חח"י לניתוק ולחיבור",
  // which the router labels boards + utility + project — so every turn that
  // could actually incur the fee still carries it.
  for (const t of ['החלפת לוח דירתי', 'הגדלת חיבור', 'לוח חדש בדירה', 'צריך לנתק את המונה']) {
    assert.ok(trimPricingMap(DEFAULT_PRICING_MAP, t).includes('~300 ₪'),
      `the call-out fee did not reach: ${t}`);
  }
  // It is legitimately absent from a job that cannot incur it. Under the old
  // binary trim this block came back on every turn including this one; that was
  // never a decision, it was just what "drop only the fee tables" happened to do.
  const lighting = trimPricingMap(DEFAULT_PRICING_MAP, 'התקנת גופי תאורה');
  assert.ok(!lighting.includes('הזמנת חח"י לניתוק ולחיבור'),
    'a pure lighting turn does not need the IEC disconnect-and-reconnect fee');
});

// ── The catalogue index, ranked against the job ──────────────────────────────
//
// Stav's warning when this was proposed: "זה בעצם מועמד לפורענות, שיהיה חסר
// הרבה דברים." He was right, and the first attempt proved it — a wiring mistake
// meant the query never reached the ranker, so the block quietly shrank to 37%
// by pure truncation while looking like it had worked. These tests exist mainly
// to make that failure impossible to ship again.

import { renderTaxonomyBlock } from '../functions/api/_materials.js';

const fakeDb = (cats) => ({ items: cats.flatMap(([cat, n]) =>
  Array.from({ length: n }, (_, i) => ({ cat, price: 10 + i }))) });

const CATS = [
  ['פיקוד ובקרה / מאמ"תים', 198],
  ['כלי עבודה / כלי עבודה חשמליים', 158],
  ['תאורה / גופי תאורה פנים / שקועי תקרה', 67],
  ['תאורה / גופי תאורה חוץ', 40],
  ['טעינה לרכב / עמדות טעינה', 12],
  ['כבלי חשמל / כבלי פיקוד', 125],
];

test('the job the question is about comes first, not the biggest shelf', () => {
  const out = renderTaxonomyBlock(fakeDb(CATS), 45, 'התקנת גופי תאורה בתקרת גבס');
  const lines = out.split('\n').filter((l) => l.startsWith('•'));
  assert.match(lines[0], /תאורה/, `a lighting job still opens with: ${lines[0]}`);
});

test('ranking really is driven by the question, not by the cut', () => {
  // The bug that shipped for ten minutes: the query never arrived, the block
  // shrank anyway, and two different jobs produced byte-identical output. If
  // these two ever match again, the wiring is broken in exactly that way.
  const light = renderTaxonomyBlock(fakeDb(CATS), 4, 'גופי תאורה');
  const charger = renderTaxonomyBlock(fakeDb(CATS), 4, 'עמדת טעינה לרכב');
  assert.notEqual(light, charger, 'two different jobs got an identical catalogue index');
  assert.match(light.split('\n').filter((l) => l.startsWith('•'))[0], /תאורה/);
  assert.match(charger.split('\n').filter((l) => l.startsWith('•'))[0], /טעינה/);
});

test('a job still gets the general shelves its own words never name', () => {
  // Screws, terminals, conduit: nobody says them out loud, and a parts list
  // without them is a parts list that sends somebody back to the shop.
  const out = renderTaxonomyBlock(fakeDb(CATS), 6, 'גופי תאורה');
  const lines = out.split('\n').filter((l) => l.startsWith('•'));
  assert.ok(lines.length > 2, 'only the matching families survived');
  assert.ok(lines.some((l) => !/תאורה/.test(l)), 'nothing but the matched families was kept');
});

test('no question means no filtering', () => {
  // An unknown job should get everything, biggest first — the old behaviour,
  // unchanged.
  const all = renderTaxonomyBlock(fakeDb(CATS), 120);
  const lines = all.split('\n').filter((l) => l.startsWith('•'));
  assert.equal(lines.length, CATS.length);
  assert.match(lines[0], /מאמ/, 'the no-query path stopped ranking by size');
});
