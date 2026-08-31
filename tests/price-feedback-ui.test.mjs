// The strip under a pricing answer that asks whether the price was right.
//
// The backend for this was written and tested days ago; without the widget it
// had never received a single verdict. These cover the four ways a feedback
// prompt stops being answered — asking too often, asking about the wrong
// message, asking twice, and losing what it was told.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();
const FEEDBACK = readFileSync(join(ROOT, 'functions', 'api', 'feedback.js'), 'utf8');

// priceFeedbackEl builds a DOM node, so it gets the smallest document that
// satisfies it rather than a browser.
function load() {
  const start = APP.indexOf('const PRICE_VERDICTS = [');
  const end = APP.indexOf('function _pfDone(');
  assert.ok(start > -1 && end > start, 'the feedback widget moved or was renamed');
  const made = [];
  const ctx = createContext({
    document: {
      createElement: () => {
        const el = { style: {}, dataset: {}, className: '', innerHTML: '' };
        made.push(el);
        return el;
      },
    },
  });
  runInContext(APP.slice(start, end), ctx);
  return { el: ctx.priceFeedbackEl, made };
}

const priced = (text) => ({ role: 'model', parts: [{ text: text || 'עבודה: 2,400 ₪' }] });
const project = (msgs) => ({ laborPrice: 2400, spec: { jobType: 'charger' }, chatHistory: msgs });

test('the strip appears under a message that actually named a price', () => {
  const { el } = load();
  const p = project([priced()]);
  const strip = el(p, 0);
  assert.ok(strip, 'no strip on a priced answer');
  assert.match(strip.innerHTML, /נראה לך נכון/);
});

test('a follow-up question does not get asked about as if it were a price', () => {
  // laborPrice survives from an EARLIER answer, so "the project has a price" is
  // not the same question as "this message produced one". Without the second
  // check the strip lands under "מה גודל הלוח?" and asks whether that looks
  // right — which is the fastest way to teach someone to ignore the row.
  const { el } = load();
  const p = project([{ role: 'model', parts: [{ text: 'מה גודל הלוח הקיים?' }] }]);
  assert.equal(el(p, 0), null, 'a question with no price was offered for grading');
});

test('a job with no price yet is not graded', () => {
  const { el } = load();
  const p = project([priced()]);
  p.laborPrice = 0;
  assert.equal(el(p, 0), null);
});

test('answering once ends it for good', () => {
  const { el } = load();
  const p = project([priced()]);
  p.chatHistory[0].feedback = 'spot_on';
  p.chatHistory[0].feedbackSent = true;
  assert.equal(el(p, 0), null, 'the same answer is graded twice');
});

test('a verdict recorded but not sent comes back to be finished', () => {
  // The expensive failure mode. "ממש לא" is the only verdict that puts a
  // notification on Stav's phone, and it is the only one that asks a follow-up
  // question first — so tapping it and then switching tabs before typing would
  // mark the message answered and silently drop the alert. It has to return.
  const { el } = load();
  const p = project([priced()]);
  p.chatHistory[0].feedback = 'way_off';   // recorded
  const strip = el(p, 0);
  assert.ok(strip, 'an unsent verdict disappeared with the alert unsent');
  assert.match(strip.innerHTML, /מה היה לא בסדר/, 'it came back as the wrong question');
});

test('only the verdict that alerts asks a second question', () => {
  // Asking a satisfied user to explain himself is how a widget stops being
  // used. The other three are one tap and over.
  const src = APP.slice(APP.indexOf('function sendPriceFeedback('),
                        APP.indexOf('function submitPriceFeedback('));
  assert.match(src, /verdict === 'way_off'/, 'the follow-up is not gated on way_off');
  const afterGate = src.slice(src.indexOf("verdict === 'way_off'"));
  assert.match(afterGate, /_pfNoteHtml/, 'way_off does not ask why');
});

test('the four chips are exactly the four verdicts the server accepts', () => {
  // A fifth chip, or a renamed one, is a 400 the user never sees — the post is
  // deliberately silent, so a mismatch here would lose verdicts in total
  // silence rather than fail loudly.
  const chips = [...APP.slice(APP.indexOf('const PRICE_VERDICTS = ['),
                              APP.indexOf('const PF_WRAP')).matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
  const server = [...FEEDBACK.slice(FEEDBACK.indexOf('const VERDICTS = {'),
                                    FEEDBACK.indexOf('const KEEP_DAYS')).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(chips.slice().sort(), server.slice().sort(),
    `chips ${chips} do not match server verdicts ${server}`);
});

test('sending feedback can never surface an error to the user', () => {
  // It is telemetry. A widget that can interrupt the man reading his quote
  // costs more than the data it returns.
  // To the end of the function, not a fixed character count: a window that
  // stops early passes or fails on how many comment lines happen to precede
  // the line it is actually about.
  const from = APP.indexOf('function postPriceFeedback(');
  const rest = APP.slice(from);
  const src = rest.slice(0, rest.search(/\r?\n\}\r?\n/));
  assert.match(src, /\.catch\(\(\) => \{\}\)/, 'a failed post is not swallowed');
  assert.match(src, /try \{/, 'a throw would escape into the render path');
});

test('a job type with too few verdicts shows no rate', () => {
  // Two verdicts is not a rate, and printing one anyway is how a dashboard
  // talks somebody into re-pricing work he had right.
  const src = APP.slice(APP.indexOf('function adminFeedbackHtml('),
                        APP.indexOf('// ---- Admin: aggregate stats dashboard'));
  assert.match(src, /const MIN = \d/, 'no minimum sample before a rate is shown');
  assert.match(src, /מעט מדי/, 'a thin sample is not labelled as thin');
});
