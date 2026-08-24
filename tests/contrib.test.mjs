// Bonus questions for helping price-check, and telling a judgement from a click.
//
// The rule Stav set, and the one everything else hangs off: ANSWERING earns the
// bonus, not answering a particular way. The moment "בול" pays more than
// "ממש לא", the data bends toward whatever pays and the prices bend with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trustScore, recordContribution, TRUST_FLOOR, BONUS_DAILY_CAP } from '../functions/api/_contrib.js';

const kv = (seed = {}) => {
  const store = new Map(Object.entries(seed));
  return { store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async list({ prefix, limit }) {
      const keys = [...store.keys()].filter((x) => x.startsWith(prefix)).slice(0, limit || 200);
      return { keys: keys.map((name) => ({ name })), list_complete: true };
    } };
};
const base = { answers: 0, fast: 0, goldSeen: 0, goldOk: 0, repeats: 0,
               contradictions: 0, consensusSeen: 0, consensusWith: 0 };

test('a new contributor is trusted', () => {
  // The cost of a wrong vote is one diluted rate. The cost of suspicion is a
  // helpful person told he is not welcome.
  assert.equal(trustScore(base), 1);
  assert.ok(trustScore({ ...base, answers: 2, fast: 2 }) >= TRUST_FLOOR,
    'two quick answers already cost somebody his standing');
});

test('failing the questions with known answers is the strongest signal', () => {
  // Gold: jobs Stav has already priced. There IS a right answer and it was not
  // given, repeatedly.
  const bad = trustScore({ ...base, answers: 20, goldSeen: 10, goldOk: 2 });
  assert.ok(bad < TRUST_FLOOR, `worse than guessing still counted: ${bad}`);
  const good = trustScore({ ...base, answers: 20, goldSeen: 10, goldOk: 9 });
  assert.ok(good >= TRUST_FLOOR, 'someone who gets them right was penalised');
});

test('one bad day on gold is not a verdict', () => {
  // Below three gold items there is nothing to conclude.
  assert.equal(trustScore({ ...base, answers: 4, goldSeen: 2, goldOk: 0 }), 1);
});

test('answering faster than anyone can read is not answering', () => {
  const clicker = trustScore({ ...base, answers: 20, fast: 19 });
  assert.ok(clicker < TRUST_FLOOR, `a pure clicker still counted: ${clicker}`);
  // But being quick sometimes is just being quick.
  assert.ok(trustScore({ ...base, answers: 20, fast: 4 }) >= TRUST_FLOOR);
});

test('contradicting yourself on the same job twice is noise', () => {
  const flip = trustScore({ ...base, answers: 20, repeats: 6, contradictions: 5 });
  assert.ok(flip < 1, 'self-contradiction cost nothing');
});

test('disagreeing with everyone is the weakest signal, on purpose', () => {
  // A lone dissenter who is RIGHT is the most valuable signal there is. This
  // must never be strong enough to silence him.
  const lone = trustScore({ ...base, answers: 30, consensusSeen: 20, consensusWith: 1 });
  assert.ok(lone >= TRUST_FLOOR,
    `a consistent dissenter was muted on disagreement alone: ${lone}`);
});

test('every verdict pays the same, whatever it was', async () => {
  // The rule that protects the data from the incentive.
  const day = '2026-08-23';
  const a = await recordContribution({ SJ_DATA: kv() }, 'u1', { verdict: 'spot_on', ms: 9000 }, day);
  const b = await recordContribution({ SJ_DATA: kv() }, 'u2', { verdict: 'way_off', ms: 9000 }, day);
  assert.equal(a.bonus, b.bonus, 'one verdict paid more than another');
  assert.ok(a.bonus > 0);
});

test('a contributor we do not count still gets paid, and is not told', async () => {
  // Stav: "מי שנזהה שעונה שטויות יקבל הודעת תודה, זה הכל לבינתיים". He keeps
  // what he earned. Telling him he was graded unreliable teaches him what to
  // fake next time and buys nothing.
  const env = { SJ_DATA: kv({ 'contrib:noisy': JSON.stringify({
    ...base, answers: 30, fast: 29, bonusDay: '2026-08-23', bonusToday: 0 }) }) };
  const out = await recordContribution(env, 'noisy', { verdict: 'spot_on', ms: 400 }, '2026-08-23');
  assert.equal(out.muted, true, 'an obvious clicker is still being counted');
  assert.ok(out.bonus > 0, 'the bonus was withheld, which announces the judgement');
});

test('the daily ceiling holds', async () => {
  // A cap low enough to make gaming not worth the effort is worth more than
  // any detector.
  const env = { SJ_DATA: kv() };
  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += (await recordContribution(env, 'u', { verdict: 'spot_on', ms: 9000 }, '2026-08-23')).bonus;
  }
  assert.equal(total, BONUS_DAILY_CAP, `paid ${total} past a cap of ${BONUS_DAILY_CAP}`);
});

test('the ceiling resets on a new day', async () => {
  const env = { SJ_DATA: kv() };
  for (let i = 0; i < 12; i++) await recordContribution(env, 'u', { verdict: 'spot_on', ms: 9000 }, '2026-08-23');
  const next = await recordContribution(env, 'u', { verdict: 'spot_on', ms: 9000 }, '2026-08-24');
  assert.ok(next.bonus > 0, 'yesterday’s ceiling carried into today');
});

test('the client actually measures how long he looked at it', () => {
  // The speed layer is worthless if thinkMs is always null. The strip has to
  // stamp when it appears, not when the module loads.
  const app = readFileSync(new URL('../sale/app.js', import.meta.url), 'utf8');
  assert.match(app, /_pfShownAt = Date\.now\(\);/, 'nothing records when the question was shown');
  assert.match(app, /thinkMs: _pfShownAt \? Date\.now\(\) - _pfShownAt : null/,
    'the elapsed time is never sent');
});

test('a muted contributor is told he is done, not that he is distrusted', () => {
  const app = readFileSync(new URL('../sale/app.js', import.meta.url), 'utf8');
  assert.match(app, /תודה, זה הכל לבינתיים/, 'the muted message is gone');
  // And nothing in the client may reveal the score.
  assert.ok(!/trust/.test(app.slice(app.indexOf('function showBonusEarned'),
                                    app.indexOf('function showBonusEarned') + 500)),
    'the trust score leaks to the person being scored');
});
