// Guards for the AI provider layer.
//
// Both of the faults these cover were live in production on 2026-08-21 and both
// were invisible from the outside: the endpoint kept answering, it just answered
// with a Google error string instead of a quote. Nothing in the suite could have
// caught that, so these exist now.

import test from 'node:test';
import assert from 'node:assert/strict';

import { toGemini, supportsThinkingOff } from '../functions/api/_ai.js';
import { MODEL_CLASS } from '../functions/api/_tiers.js';

test('the shipped default model is not one Google has retired', () => {
  // gemini-2.5-flash started returning 404 "no longer available to new users"
  // and took the pricing chat down. gemini-2.0-flash did the same in June.
  // A retired model must never sit in the shipped defaults again.
  const retired = [/gemini-1\.5/, /gemini-2\.0/, /gemini-2\.5-flash\b/];
  for (const cls of ['basic', 'advanced']) {
    const model = MODEL_CLASS[cls].model;
    for (const rx of retired) {
      assert.ok(!rx.test(model), `${cls} is pinned to a retired model: ${model}`);
    }
  }
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

  const plain = toGemini([{ role: 'user', content: 'x' }],
    { max_tokens: 1200, model: 'gemini-3.6-flash' });
  assert.equal(plain.generationConfig.maxOutputTokens, 1200,
    'headroom leaked into calls that never asked to disable thinking');
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
