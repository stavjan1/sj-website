// Guards for the fees line in the pricing calculator.
//
// The inspector is the cost this product forgot hardest. It was in the pricing
// map, the model was told it must be its own line, and it still could not reach
// a total — because the JSON contract the agent returns had slots for materials,
// labour, scope, blind spots and tools, and nothing for a fee. A number with
// nowhere to go is the same as a number nobody knew.
//
// sale/app.js is a browser script with no module boundary, so these read the
// source and assert on the arithmetic and the contract rather than importing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();

test('the agent is told the fees slot exists', () => {
  // If the contract does not name it, the model never emits it and every test
  // below passes while measuring nothing.
  assert.ok(/"fees"\s*:\s*\[/.test(APP), 'the JSON contract has no fees array');
  assert.ok(/כלול scope \(תגיות אפיון\), materials, fees,/.test(APP),
    'the stage-2 instruction does not ask for fees');
  assert.ok(/חשמלאי בודק/.test(APP), 'the fees example does not name the inspector');
});

test('fees are parsed out of the reply and clamped', () => {
  assert.ok(/Array\.isArray\(parsed\.fees\)/.test(APP), 'fees are never read from the reply');
  // Same trust boundary as materials: model output that gets persisted.
  const block = APP.slice(APP.indexOf('Array.isArray(parsed.fees)'), APP.indexOf('Array.isArray(parsed.fees)') + 600);
  assert.ok(/String\(/.test(block) && /Number\(/.test(block),
    'fees are stored without type clamping');
});

test('fees reach the total, and carry no markup or risk premium', () => {
  const calc = APP.slice(APP.indexOf('function pricingCalc('), APP.indexOf('function renderPricingEngine('));
  assert.ok(/feesTotal/.test(calc), 'pricingCalc does not compute fees');

  // The arithmetic that matters: fees are added AFTER the risk multiplier, so
  // they are never marked up and never inflated. You are not reselling the
  // inspector, and his price does not rise because there was no deposit.
  assert.ok(/\* riskMult \+ feesTotal/.test(calc),
    'fees are inside the markup/risk multiplication instead of on top of it');
  assert.ok(!/matPrice \+ laborA \+ feesTotal\) \* riskMult/.test(calc));

  // Both labour methods must include it, or the quoted range moves depending on
  // which method happens to win.
  const adds = calc.match(/\+ feesTotal/g) || [];
  assert.ok(adds.length >= 2, `fees added to only ${adds.length} of the two totals`);
});

test('the fee total is visible, not just counted', () => {
  // A total that silently grew by 600 ₪ is worse than one that never grew:
  // the electrician cannot explain a number he cannot see.
  assert.ok(/id="pe-fees"/.test(APP), 'no fees figure is rendered');
  assert.ok(/set\('pe-fees'/.test(APP), 'the fees figure is never refreshed');
  assert.ok(/בלי תוספת רווח/.test(APP),
    'the UI does not say fees carry no markup, which is the whole point of the line');
});

test('applying to a quote turns each fee into its own visible line', () => {
  // "תשלום בודק = שורה נפרדת" is Stav's rule, and a fee folded into one headline
  // number breaks it just as thoroughly as a fee that was never counted. The
  // total keeps the fee (the customer really does pay it) and the fee also
  // becomes a work item, so it can be seen and defended.
  // The whole function, not a fixed window. A 1,800-character slice broke the
  // moment the function grew a confirmation step — the property was still true,
  // the ruler had just run out.
  const start = APP.indexOf('function pricingApplyToQuote(');
  const apply = APP.slice(start, APP.indexOf(String.fromCharCode(10) + '}', start));
  assert.ok(/addWorkItemRow\(/.test(apply), 'fees never become quote line items');
  assert.ok(/existing\.has\(f\.name\)/.test(apply),
    'applying twice would duplicate the fee rows');
  assert.ok(/ללא תוספת רווח/.test(apply),
    'the fee line does not tell the customer it carries no margin');
});
