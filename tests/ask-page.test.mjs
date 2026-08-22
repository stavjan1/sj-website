// The public pricing page, /ask/ — the one an electrician opens from a WhatsApp
// group, having never heard of any of this before.
//
// Stav, looking at it on his phone: "נראה קצת גימיק וחלבי… אני חייב לשבת איתך
// על זה בשביל לא לצאת ליצן ברגע שאפרסם את זה." These are the decisions we
// settled, written down so they survive the next edit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASK = readFileSync(join(ROOT, 'ask', 'index.html'), 'utf8');
// Comments quote the copy they removed, so the rules below read code only.
const CODE = ASK.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

test('no advertisement appears inside an answer', () => {
  // The decision: this page is a tool, full stop. A sales line under a pricing
  // answer cheapens the answer, and it is repetition that turns a sentence into
  // an advert — it used to appear under every single reply.
  for (const ad of [
    'אהבת? זו רק ההתחלה',
    'המשך את זה במערכת',
    'רוצה לנהל את זה כהצעת מחיר מלאה',
    'בוא נאפיין את זה כמו שצריך',
  ]) {
    assert.ok(!CODE.includes(ad), `an advert survived inside the answer: ${ad}`);
  }
  // The prompt must also stop TELLING the model to sell.
  assert.match(CODE, /אל תסיים בשורת שיווק/, 'the model is still told to pitch at the end');
});

test('the headline is the number, and the caveats are not', () => {
  // "טווח גס: 2,200–3,800 ₪ לפני מע\"מ, לא כולל העמדה עצמה ובודק." was rendered
  // ENTIRELY at 1.15rem/800 — four lines of yellow shouting, most of it
  // footnotes. The number is the answer; the conditions belong underneath it.
  const m = CODE.match(/h = h\.replace\((\/\^\([^\n]*?\/),/);
  assert.ok(m, 'the price-line pattern is gone or was reshaped');
  const rx = new RegExp(m[1].slice(1, -1));

  const cases = [
    ['מחיר מומלץ: 4,200 ₪. כולל חומר, עבודה, ותיאום עם חברת החשמל.', 'מחיר מומלץ: 4,200 ₪'],
    ['הערכה ראשונית: 2,200–3,800 ₪ לפני מע"מ, לא כולל בודק.', 'הערכה ראשונית: 2,200–3,800 ₪'],
  ];
  for (const [line, big] of cases) {
    const got = rx.exec(line);
    assert.ok(got, `no match on a real headline: ${line}`);
    assert.equal(got[1], big, 'the big type swallowed the caveats again');
    assert.ok(got[2].length > 0, 'the caveats vanished instead of being demoted');
  }
  assert.match(CODE, /class="price-note"/, 'there is nowhere for the caveats to go');
});

test('the standard answer arrives already ticked', () => {
  // Stav: "שהדברים הסטנדרטיים כבר יהיו מסומנים". Four questions at four taps
  // each, where most answers are simply what is usual, IS the length of the
  // path he wanted cut.
  assert.match(CODE, /Number\.isInteger\(q\.def\)/, 'a default answer is never pre-selected');
  assert.match(CODE, /oi === def.*classList\.add\('on'\)/s, 'the default is computed but not shown as chosen');
  assert.match(ASK, /"def":\s*\d/, 'the example the model copies carries no def, so it will never send one');

  // Clamped, because it comes from a language model: a def of 7 on a
  // three-option question must select nothing rather than throw mid-render.
  assert.match(CODE, /q\.def >= 0 && q\.def < list\.length/, 'an out-of-range default is not clamped');

  // And it has to be visible that it can be changed, or a pre-ticked chip reads
  // as a decision taken on his behalf.
  assert.match(CODE, /שנה רק מה ששונה אצלך/, 'nothing tells the user the ticks are his to change');
});

test('the questions got shorter, not just prettier', () => {
  assert.match(CODE, /\*\*עד 3 שאלות\*\*/, 'still up to four questions');
  // The same "what could raise this" said twice, once as prose and once as the
  // open block, is what made the answer long.
  assert.ok(!CODE.includes('**אל תשכח**'), 'the price-raisers are still listed twice');
  assert.match(CODE, /אל תוסיף שורת נימוק/, 'the model still explains itself in a spare paragraph');
});

test('the phone can zoom, and the browser cannot inflate on its own', () => {
  // He reads this on a phone already set to enlarged text. maximum-scale=1 took
  // away his ability to pinch out of it, and no text-size-adjust let Chrome add
  // a second multiplier on top.
  assert.ok(!/maximum-scale/.test(ASK), 'pinch-zoom is blocked again');
  assert.match(ASK, /text-size-adjust:100%/, 'the browser may inflate the text on its own again');
});
