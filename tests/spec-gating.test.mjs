// Guards for what the characterisation card asks, and what it admits it does
// not know.
//
// Both behaviours here are money, not polish. A question asked when its premise
// does not hold teaches the electrician to click through the card without
// reading it. A question answered "I don't know" that prints no caveat sends a
// quote out claiming a fact nobody established.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();
const CHECKLISTS = JSON.parse(readFileSync(join(ROOT, 'site', 'data', 'coverage', 'checklists.json'), 'utf8'));
const COVERAGE = readFileSync(join(ROOT, 'site', 'sale', 'coverage.js'), 'utf8');

test('an "I don\'t know" answer still prints its assumption', () => {
  // 21 chips across the checklists let you say you do not know. Storing a
  // non-empty value made specCoverage count the critical field as satisfied
  // while specAssumptions passed over it — it only looked at `skipped` — so the
  // quote carried no caveat on a fact nobody had established.
  assert.ok(/const UNKNOWN_ANSWER =/.test(APP), 'no unknown-answer detection');
  assert.ok(/function needsAssumption\(/.test(APP), 'no shared assumption predicate');

  // Both collectors must use it, or they disagree about the same field.
  const assumptionsFn = APP.slice(APP.indexOf('function specAssumptions('), APP.indexOf('function specAssumptions(') + 400);
  assert.ok(/needsAssumption/.test(assumptionsFn), 'specAssumptions ignores unknown answers');
  const coverageFn = APP.slice(APP.indexOf('function specCoverage('), APP.indexOf('function specCoverage(') + 900);
  assert.ok(/needsAssumption/.test(coverageFn), 'specCoverage ignores unknown answers');
});

test('the unknown pattern matches how the chips are actually worded', () => {
  // Written against the real chip text, not a guess at it.
  const m = APP.match(/const UNKNOWN_ANSWER = (\/.*\/);/);
  assert.ok(m, 'UNKNOWN_ANSWER not found');
  const rx = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')));
  for (const chip of [
    'לא ידוע',
    'לא ידוע · לפי תמונת הלוח',
    'לא ידוע · אצלם את המא"ז הראשי',
    'אין הארקה או לא ידוע',
    'מעל 60 / לא ידוע',
    'עוד לא סוכם',
  ]) {
    assert.ok(rx.test(chip), `unknown chip not recognised: ${chip}`);
  }
  // And must NOT swallow real answers.
  for (const chip of ['נחושת', '3×25 תלת-פאזי', 'יש פחת והשקעים עם הארקה', 'כן']) {
    assert.ok(!rx.test(chip), `real answer treated as unknown: ${chip}`);
  }
});

test('a question whose premise fails is never asked', () => {
  assert.ok(/function specFieldApplies\(/.test(APP), 'no conditional-field support');

  // Every place that walks the field list has to honour it, or the question
  // disappears from the card and reappears in the agent's "still open" list.
  for (const [label, marker] of [
    ['specCoverage', 'function specCoverage('],
    ['specAssumptions', 'function specAssumptions('],
    ['renderSpecCard', 'function renderSpecCard('],
    ['getPlanningSystemInstruction', 'function getPlanningSystemInstruction('],
  ]) {
    const body = APP.slice(APP.indexOf(marker), APP.indexOf(marker) + 2200);
    assert.ok(/specFieldApplies/.test(body), `${label} does not filter inapplicable fields`);
  }
});

test('the questions Stav ruled irrelevant stay gone', () => {
  // His call, and he is the licensed electrician: the supply conductor feeding
  // the panel does not change a charger quote, and a building's year is not a
  // usable proxy for its wiring or its earthing method. I argued for keeping
  // the first one behind a 3×63A condition; he overruled it, and a checklist
  // that asks questions the tradesman knows are pointless is a checklist he
  // stops reading.
  for (const gone of ['feed_conductor', 'existing_conductors']) {
    assert.ok(!COVERAGE.includes(`"id": "${gone}"`), `${gone} came back`);
  }
});

test('the charger fork still fires on the supply that needs it', () => {
  const fu = (CHECKLISTS.charger.followUps || [])[0];
  assert.ok(fu, 'the 3×25 follow-up is gone');
  assert.equal(fu.id, 'connection_size');
  assert.ok(fu.when.includes('3×25 תלת-פאזי'));
  // Two ways out, not three: the 'ניהול עומסים' option went with Stav's
  // 4.9.2026 ruling (DLM is out of the product), so the fork now offers
  // a bigger supply or the charger alone.
  assert.equal(fu.options.length, 2);
  assert.ok(!fu.options.some((o) => /ניהול עומסים/.test(o)), 'the DLM option came back');
  assert.ok(/ניתוקים בשעות העומס/.test(fu.prompt));
});

test('first person means the electrician everywhere', () => {
  // The card is filled in by Stav, so "אני" is him and the customer is
  // "הלקוח". Two ownership chips were written from the customer's mouth, which
  // in a card about who supplies what is a genuinely expensive ambiguity.
  const chips = COVERAGE.match(/"[^"]*אני[^"]*"/g) || [];
  for (const c of chips) {
    assert.ok(!/הנכס שלי|אני שוכר/.test(c),
      `chip is written in the customer's voice: ${c}`);
  }
});

test('every distance question asks for the route, not the crow flight', () => {
  // infra/route_length_m already carried the lesson in its own why-line: a
  // remembered or straight-line measurement runs 20-40% short. Cable is priced
  // per metre, so that gap is money, and four other checklists were still
  // asking the naive version.
  const questions = (COVERAGE.match(/"question": "([^"]*)"/g) || [])
    .map((q) => q.slice('"question": "'.length, -1))
    .filter((q) => /כמה מטר|מרחק/.test(q));
  assert.ok(questions.length >= 4, `only ${questions.length} distance questions found`);
  for (const q of questions) {
    assert.ok(/בפועל|לא בקו ישר/.test(q),
      `distance question does not ask for the real route: ${q}`);
  }
});
