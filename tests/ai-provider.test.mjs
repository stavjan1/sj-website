// Guards for the AI provider layer.
//
// Both of the faults these cover were live in production on 2026-08-21 and both
// were invisible from the outside: the endpoint kept answering, it just answered
// with a Google error string instead of a quote. Nothing in the suite could have
// caught that, so these exist now.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { toGemini, supportsThinkingOff, PROVIDERS, modelScore } from '../functions/api/_ai.js';
import { MODEL_CLASS } from '../functions/api/_tiers.js';

const RETIRED = [/gemini-1\.5/, /gemini-2\.0/, /gemini-2\.5-flash\b/];

test('the shipped default model is not one Google has retired', () => {
  // gemini-2.5-flash started returning 404 "no longer available to new users"
  // and took the pricing chat down. gemini-2.0-flash did the same in June.
  // A retired model must never sit in the shipped defaults again.
  for (const cls of ['basic', 'advanced']) {
    const model = MODEL_CLASS[cls].model;
    for (const rx of RETIRED) {
      assert.ok(!rx.test(model), `${cls} is pinned to a retired model: ${model}`);
    }
  }
});

test('the provider fallback model is not retired either', () => {
  // The blind spot that let a dead model sit in production with a green suite.
  // The test above only ever looked at MODEL_CLASS, while
  // PROVIDERS.gemini.defaultModel — used whenever a caller names no model at
  // all — was still gemini-2.5-flash, the exact name Google had stopped
  // serving.
  for (const rx of RETIRED) {
    assert.ok(!rx.test(PROVIDERS.gemini.defaultModel),
      `the no-model-named fallback is retired: ${PROVIDERS.gemini.defaultModel}`);
  }
});

test('a refused model is replaced by the best Flash, not by Pro', () => {
  // Promoting a broken free-tier Flash call to Pro would spend the advanced
  // pool that paying work depends on: a quiet way to turn a model outage into
  // a billing one.
  const want = 'gemini-3.6-flash';
  const offered = ['gemini-3.7-flash', 'gemini-2.5-pro', 'gemini-3.5-flash-lite',
                   'gemini-3-flash-preview', 'gemini-2.5-flash'];
  const best = offered.slice().sort((a, b) => modelScore(b, want) - modelScore(a, want))[0];
  assert.equal(best, 'gemini-3.7-flash');

  // Preview ids lose to stable ones: the choice is cached for hours, and a
  // preview can change or vanish underneath it.
  assert.ok(modelScore('gemini-3.5-flash', 'x') > modelScore('gemini-3-flash-preview', 'x'));
  // Lite wins only when Lite is what was asked for.
  assert.ok(modelScore('gemini-3.5-flash', want) > modelScore('gemini-3.5-flash-lite', want));
  assert.ok(modelScore('gemini-3.5-flash-lite', 'gemini-3.5-flash-lite')
          > modelScore('gemini-3.5-flash-lite', 'gemini-3.5-flash'));
});

test('a healed model name survives the whitelist that rejected it', () => {
  // The substitute comes from Google's own list, so by definition it is not in
  // the hardcoded PROVIDERS list. Running it back through pickModel would
  // reject it and hand over the very default that just 404ed — a loop of one.
  const src = readFileSync(new URL('../functions/api/_ai.js', import.meta.url), 'utf8');
  assert.ok(/const model = opts\._resolvedModel \|\| pickModel\(/.test(src),
    'callOnce still filters the healed name through the whitelist');
  // And the healer must only ever run on 404 — a 429 means the pool is spent,
  // and swapping models on quota just spends a second pool.
  assert.ok(/name === 'gemini' && upstream\.status === 404/.test(src),
    'the model healer fires on statuses that are not about the model');
});

test('thinkingBudget:0 is only sent to models that accept it', () => {
  // /ask/ and /api/scrape both send 0 unconditionally. On Gemini 3.x that is a
  // 400 INVALID_ARGUMENT on every request — the public bot would be hard down.
  const msgs = [{ role: 'user', content: 'שלום' }];

  const three = toGemini(msgs, { thinkingBudget: 0, max_tokens: 1200, model: 'gemini-3.6-flash' });
  assert.equal(three.generationConfig.thinkingConfig, undefined,
    'sent thinkingBudget:0 to a model that rejects it');

  const twoFive = toGemini(msgs, { thinkingBudget: 0, max_tokens: 1200, model: 'gemini-2.5-flash' });
  assert.equal(twoFive.generationConfig.thinkingConfig.thinkingBudget, 0,
    '2.5-flash can disable thinking and should still be told to');
});

test('a model that cannot stop thinking gets extra room to answer', () => {
  // Thinking tokens come out of maxOutputTokens. Asking for thinking off and
  // then not getting it, with the same budget, is how a quote truncates
  // mid-sentence — which is exactly what the first live answers did.
  const padded = toGemini([{ role: 'user', content: 'x' }],
    { thinkingBudget: 0, max_tokens: 1200, model: 'gemini-3.6-flash' });
  assert.ok(padded.generationConfig.maxOutputTokens > 1200,
    'no headroom added for unavoidable thinking');

  // A model that can switch thinking off gets exactly what was asked for.
  const plain = toGemini([{ role: 'user', content: 'x' }],
    { max_tokens: 1200, model: 'gemini-2.5-flash' });
  assert.equal(plain.generationConfig.maxOutputTokens, 1200,
    'headroom leaked into a model that does not need it');
});

test('a caller who says nothing about thinking still gets room to answer', () => {
  // This is the common case and it was the one starving: the app sends
  // max_tokens and no thinkingBudget, thinking takes its share of that same
  // budget, and a real pricing answer stopped mid-word at item 5 of the bill of
  // quantities. Headroom applies whenever thinking cannot be switched off, not
  // only when the caller explicitly asked for it off.
  const b = toGemini([{ role: 'user', content: 'x' }],
    { max_tokens: 3000, model: 'gemini-3.6-flash' });
  assert.ok(b.generationConfig.maxOutputTokens > 3000,
    'no headroom for a caller who never mentioned thinking');
  assert.equal(b.generationConfig.thinkingConfig, undefined);

  // A model that CAN disable thinking does not need padding.
  const old = toGemini([{ role: 'user', content: 'x' }],
    { max_tokens: 3000, model: 'gemini-2.5-flash' });
  assert.equal(old.generationConfig.maxOutputTokens, 3000);
});

test('a positive thinking budget is passed through untouched', () => {
  const b = toGemini([{ role: 'user', content: 'x' }],
    { thinkingBudget: 512, max_tokens: 900, model: 'gemini-3.6-flash' });
  assert.equal(b.generationConfig.thinkingConfig.thinkingBudget, 512);
  assert.equal(b.generationConfig.maxOutputTokens, 900);
});

test('an untested model is assumed unable to disable thinking', () => {
  // The safe default: guessing wrong in this direction costs a slightly larger
  // budget, guessing wrong the other way returns 400 on every request.
  assert.equal(supportsThinkingOff('gemini-4.0-flash'), false);
  assert.equal(supportsThinkingOff(''), false);
  assert.equal(supportsThinkingOff(undefined), false);
  assert.equal(supportsThinkingOff('gemini-2.5-flash'), true);
});

test('the system message still becomes systemInstruction', () => {
  // The materials block, the pricing map and the labor book all ride as system
  // messages. If they stopped being merged the bot would quietly go back to
  // guessing, with no error anywhere.
  const b = toGemini([
    { role: 'system', content: 'מחירון א' },
    { role: 'system', content: 'מחירון ב' },
    { role: 'user', content: 'כמה עולה כבל?' },
  ], { model: 'gemini-3.6-flash' });
  const sys = b.systemInstruction.parts[0].text;
  assert.ok(sys.includes('מחירון א') && sys.includes('מחירון ב'), 'system blocks dropped');
  assert.equal(b.contents.length, 1);
  assert.equal(b.contents[0].role, 'user');
});

test('a per-minute limit and a spent daily quota are told apart', () => {
  // Both are 429, and the right reaction to each is the opposite of the other:
  // a minute limit is a queue that clears in seconds, a daily quota is over
  // until midnight. The ledger recorded both as "quota" and the panel said
  // "המכסה היומית נגמרה" for both — so it recommended buying capacity to solve
  // a problem that a nine-second wait solves for free.
  const src = readFileSync(new URL('../functions/api/_ai.js', import.meta.url), 'utf8');
  assert.match(src, /function quotaInfo\(/, 'the 429 body is never read');
  assert.match(src, /PerMinute\|per_minute/, 'a per-minute limit is not recognised');
  assert.match(src, /PerDay\|per_day/, 'a daily quota is not recognised');

  // The wait is bounded: past a point, a weaker answer now beats a better one
  // the customer already walked away from.
  assert.match(src, /MAX_QUOTA_WAIT_MS/, 'an unbounded wait could hold a request open');

  // quotaScope must be DECLARED. This file is an ES module and therefore strict
  // mode, where assigning an undeclared name throws — on every single 429, in
  // the exact path that exists to survive one.
  assert.match(src, /let quotaScope = null;/, 'quotaScope is assigned without being declared');

  // And the 429 is counted once, not once per handler that sees it.
  const counted = (src.match(/scope: quotaScope/g) || []).length;
  assert.ok(counted >= 3, 'the scope never reaches the records that count the failure');
  const branch = src.slice(src.indexOf("upstream.status === 429) {"), src.indexOf('a second personal key'));
  assert.ok(!/recordAiUse\(env, label, 'quota', modelUsed, \{ status: 429, scope/.test(branch),
    'the quota branch records a failure the paths below will record again');
});

test('the spare key is reached for before anyone is made to wait', () => {
  // Stav's launch question: three people arrive together from a WhatsApp group.
  // The free tier allows ten requests a minute PER PROJECT, and the backup key
  // is a different project — so it is free capacity available immediately.
  // Waiting eight seconds on a rate-limited key while an idle second key sits
  // there is the wrong way round, and the first version did exactly that.
  const src = readFileSync(new URL('../functions/api/_ai.js', import.meta.url), 'utf8');
  const backupAt = src.indexOf('env.GEMINI_API_KEY_2 && env.GEMINI_API_KEY_2 !== key');
  const waitAt = src.indexOf('quotaScope === \'minute\'');
  assert.ok(backupAt > -1 && waitAt > -1, 'the backup-key or wait path is gone');
  assert.ok(backupAt < waitAt,
    'the request waits on a busy key before trying the idle spare one');

  // And the wait must not fire on a daily quota, which no amount of waiting
  // clears.
  const block = src.slice(waitAt - 400, waitAt + 200);
  assert.ok(!/scope === 'day'/.test(block), 'a spent daily quota would be waited on');
});

test('a provider known to be finished for the day is not asked again', () => {
  // Measured on the public page with the quota dry: nine and a half seconds
  // before the first word, every one of them spent asking two servers a
  // question they had already refused. The daily quota resets at UTC midnight
  // and Google names the limit it enforced, so it can simply be written down.
  const src = readFileSync(new URL('../functions/api/_ai.js', import.meta.url), 'utf8');
  assert.match(src, /async function geminiIsDry\(/, 'nothing remembers a spent daily quota');
  assert.match(src, /await geminiIsDry\(env\)/, 'the memory is never consulted');

  // ONLY a limit Google itself called a per-day one. Marking Gemini dead for
  // the day over one busy minute would cost far more than the wait it saved.
  assert.match(src, /if \(q\.scope === 'day'\) await markGeminiDry\(env\)/,
    'the dry flag is set from something other than an explicit per-day limit');

  // And it must never empty the chain: a deployment with only Gemini should get
  // a real error from Gemini, not "no AI is configured".
  assert.match(src, /order\.length > 1 && order\.includes\('gemini'\)/,
    'skipping Gemini could leave no provider at all');
  assert.match(src, /if \(without\.length\) order = without;/, 'the fallback could be emptied');
});
