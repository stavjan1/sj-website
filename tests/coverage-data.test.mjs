// Guards for the coverage checklists reaching the pricing model.
//
// sale/coverage.js is the authored source and data/coverage/checklists.json is
// a generated mirror of it. A mirror nobody checks is a mirror that goes stale
// silently — Stav edits the checklist, the UI updates, and the model keeps
// being told last month's version with no error anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extract } from '../scripts/build_coverage_data.mjs';
import { detectJobType, renderCoverageBlock } from '../functions/api/_coverage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const shipped = JSON.parse(readFileSync(join(ROOT, 'data', 'coverage', 'checklists.json'), 'utf8'));

test('the shipped mirror matches the authored source', () => {
  // Regenerate from sale/coverage.js and compare. This is the whole point of
  // the file existing: it is derived data, and derived data that can drift is
  // a second source of truth nobody declared.
  const fresh = extract(readFileSync(join(ROOT, 'sale', 'coverage.js'), 'utf8'));
  // Compared as serialized text rather than deepEqual: the two objects come
  // from different realms (one from JSON.parse, one built inside a vm context),
  // and deepStrictEqual treats their prototypes as different even when every
  // key and value matches. Serializing is also exactly the question being
  // asked — is the file on disk what the generator would write today.
  assert.equal(JSON.stringify(fresh), JSON.stringify(shipped),
    'data/coverage/checklists.json is stale — run: node scripts/build_coverage_data.mjs');
});

test('every job type still carries its pricing knowledge', () => {
  const jobs = Object.keys(shipped);
  assert.equal(jobs.length, 9, `expected 9 job types, found ${jobs.length}`);
  for (const j of jobs) {
    assert.ok(shipped[j].impacts.length >= 10, `${j} has only ${shipped[j].impacts.length} impacts`);
    assert.ok(shipped[j].exclusions.length >= 5, `${j} has only ${shipped[j].exclusions.length} exclusions`);
  }
});

test('the lines carrying real money survived the extraction', () => {
  // The reason this data is worth sending at all. If the count collapses, the
  // extraction has started dropping fields.
  const withMoney = Object.values(shipped)
    .flatMap((s) => s.impacts)
    .filter((i) => /\d{2,}/.test(i.impact));
  assert.ok(withMoney.length >= 30,
    `only ${withMoney.length} pricing impacts carry a figure — extraction may be lossy`);

  // The most specific one in the whole product: per-point prices.
  const points = shipped.points.impacts.map((i) => i.impact).join(' ');
  assert.ok(/450/.test(points), 'the per-point price figures are gone');
});

test('a job description lands on the right checklist', () => {
  const cases = [
    ['עמדת טעינה לרכב חשמלי בבית פרטי', 'charger'],
    ['החלפת לוח דירתי 12 מקום', 'panel'],
    ['תוספת שקעים במטבח', 'points'],
    ['הדוד מקפיץ את החשמל', 'fault'],
    ['קו הזנה 60 מטר למחסן', 'infra'],
    ['בדיקת מתקן והכנה לבודק', 'inspection'],
    ['החדרת אלקטרודות הארקה', 'earthing'],
  ];
  for (const [text, want] of cases) {
    assert.equal(detectJobType(text), want, `"${text}" detected as ${detectJobType(text)}`);
  }
});

test('overlapping vocabulary resolves to the more specific job', () => {
  // A charger job also mentions לוח and מא"ז; an earthing job also mentions
  // בודק. Order in JOB_PATTERNS is what keeps these from collapsing into the
  // broad categories, so it is worth a test rather than a comment.
  assert.equal(detectJobType('עמדת טעינה, יש מקום בלוח ומא"ז פנוי'), 'charger');
  assert.equal(detectJobType('החדרת אלקטרודות והזמנת בודק'), 'earthing');
});

test('an unrelated question gets no block at all', () => {
  assert.equal(detectJobType('מה שעות הפעילות שלכם?'), null);
  assert.equal(detectJobType(''), null);
  assert.equal(renderCoverageBlock(shipped, null), '');
  assert.equal(renderCoverageBlock({}, 'panel'), '');
});

test('the block stays inside its share of the prompt', () => {
  for (const job of Object.keys(shipped)) {
    const block = renderCoverageBlock(shipped, job);
    assert.ok(block.includes('נתונים בלבד'), `${job} block lacks the injection guard`);
    // One job type only. The whole file is 70KB; sending it would double the
    // pricing prompt for knowledge about eight jobs this one is not.
    assert.ok(block.length < 7000, `${job} block is ${block.length} chars`);
  }
});
