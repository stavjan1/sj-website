// Guards for the price-feedback loop.
//
// The design decision worth protecting is that agreement is recorded as
// carefully as disagreement. A verdict only means something against a
// denominator: three complaints out of five quotes is an emergency, three out
// of three hundred is noise. If "בול" ever becomes a no-op, every rate this
// endpoint computes silently becomes a lie.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { VERDICTS } from '../functions/api/feedback.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'functions', 'api', 'feedback.js'), 'utf8');

test('the four verdicts map to the four things that can be wrong', () => {
  assert.deepEqual(Object.keys(VERDICTS).sort(),
    ['bit_high', 'bit_low', 'spot_on', 'way_off']);
  for (const [k, v] of Object.entries(VERDICTS)) {
    assert.ok(v.he && v.he.length > 2, `${k} has no Hebrew label`);
    assert.equal(typeof v.weight, 'number');
  }
});

test('only a flat "wrong" raises an alarm', () => {
  // A phone notification for every "slightly high" trains you to ignore the
  // notification, which costs you the one that mattered.
  assert.equal(VERDICTS.way_off.alert, true);
  assert.equal(VERDICTS.bit_high.alert, false);
  assert.equal(VERDICTS.bit_low.alert, false);
  assert.equal(VERDICTS.spot_on.alert, false);
});

test('the near-misses point in opposite directions', () => {
  // The whole value of the two middle options: their average IS the calibration
  // signal. If both had the same sign they would cancel into nothing.
  assert.ok(VERDICTS.bit_high.weight < 0, 'quoting high must read as negative bias');
  assert.ok(VERDICTS.bit_low.weight > 0, 'quoting low must read as positive bias');
  assert.equal(VERDICTS.spot_on.weight, 0);
  assert.ok(Math.abs(VERDICTS.way_off.weight) > Math.abs(VERDICTS.bit_high.weight),
    'a flat miss should move the average more than a near miss');
});

test('agreement is stored, not discarded', () => {
  // "בול" doing nothing was the original proposal, and it would have made every
  // rate uninterpretable. Storage happens before any verdict-specific branch.
  const submit = SRC.slice(SRC.indexOf('async function submit'), SRC.indexOf('async function alertAdmin'));
  const putAt = submit.indexOf('SJ_DATA.put');
  const alertAt = submit.indexOf('VERDICTS[verdict].alert');
  assert.ok(putAt > 0, 'nothing is persisted');
  assert.ok(putAt < alertAt, 'storage is gated behind the alert branch');
  assert.ok(!/verdict\s*===\s*'way_off'[\s\S]{0,80}put/.test(submit),
    'storage is conditional on the verdict');
});

test('the report gives rates, not raw counts', () => {
  const report = SRC.slice(SRC.indexOf('async function report'));
  assert.ok(/wrongRate/.test(report), 'no rate is computed');
  assert.ok(/b\.bias \/ b\.total/.test(report), 'bias is not normalised by volume');
  assert.ok(/adminGate/.test(report), 'the report is not admin-gated');
});

test('telemetry can never break the thing it is measuring', () => {
  // A feedback widget that can fail the app it is attached to is worse than no
  // widget. Both the write and the alert swallow their own errors.
  const submit = SRC.slice(SRC.indexOf('async function submit'), SRC.indexOf('async function report'));
  assert.ok(/catch \{ \/\* never fail the caller over telemetry \*\/ \}/.test(submit));
  assert.ok(/catch \{ \/\* an alert that fails must not fail the submission \*\/ \}/.test(submit));
});

test('a note is clamped before it is ever shown back', () => {
  // It is free text that lands in an admin screen.
  assert.ok(/String\(body\.note \|\| ''\)\.slice\(0, 500\)/.test(SRC));
});
