// Questions with more than one true answer.
//
// The card was built on the assumption that every question has one answer, and
// nineteen of them do not. "יש תשתיות סמויות בקירות?" is underfloor heating AND
// water pipes AND a unit in the ceiling; a charger cable run is routinely four
// of its six route options in sequence. Every unpicked option was money that
// never reached the quote, and the electrician had no way to say so.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();
const COVERAGE_SRC = readFileSync(join(ROOT, 'site', 'sale', 'coverage.js'), 'utf8');
// Cut the checklists object specifically: the file also declares the standard
// defaults after it, so "from the first = to the last ;" now spans both.
const cut = (name) => {
  const start = COVERAGE_SRC.indexOf('{', COVERAGE_SRC.indexOf('const ' + name));
  return JSON.parse(COVERAGE_SRC.slice(start, COVERAGE_SRC.indexOf('\n};', start) + 2));
};
const CHECKLISTS = cut('COVERAGE_CHECKLISTS');

const multiFields = () => Object.entries(CHECKLISTS).flatMap(([job, v]) =>
  (v.fields || []).filter((f) => f.multi).map((f) => [job, f]));

// setSpecChip reaches for project state and the DOM, so the pure part is
// exercised directly: the same toggle rules, driven off the real checklist.
function toggler() {
  const src = APP.slice(APP.indexOf('const SPEC_MULTI_SEP'),
                        APP.indexOf('function setSpecChip('));
  const ctx = createContext({});
  runInContext(src + ';globalThis.V = specValues; globalThis.S = specSoloChips;', ctx);
  const { V, S } = ctx;
  // The body of setSpecChip's multi branch, kept in step by the test below.
  return (field, currentValue, chip) => {
    const current = V(currentValue);
    const solo = S(field);
    let next;
    if (current.includes(chip)) next = current.filter((c) => c !== chip);
    else if (solo.includes(chip)) next = [chip];
    else next = current.filter((c) => !solo.includes(c)).concat(chip);
    next.sort((a, b) => field.chips.indexOf(a) - field.chips.indexOf(b));
    return next.join(' | ');
  };
}

test('no chip anywhere contains the separator', () => {
  // The whole design rests on this. Answers are stored joined rather than as an
  // array so the coverage counter, the assumption printer, the handoff text and
  // the server's prompt block all keep reading an answer as a string — and a
  // chip containing the separator would split one answer into two fictional
  // ones, silently, inside a customer's quote.
  const all = Object.values(CHECKLISTS).flatMap((v) => (v.fields || []).flatMap((f) => f.chips || []));
  assert.ok(all.length > 400, `only ${all.length} chips found — the file shape changed`);
  for (const c of all) assert.ok(!c.includes('|'), `chip contains the separator: ${c}`);
});

test('the questions that take several answers are marked as such', () => {
  const marked = multiFields().map(([job, f]) => `${job}.${f.id}`);
  // The ones where a single answer is provably wrong.
  for (const must of [
    'points.point_kind',              // sockets AND lighting AND an AC point
    'charger.route_type',             // conduit, then riser, then trench, then coring
    'infra.route_method',
    'points.hidden_infrastructure',   // heating AND water pipes AND ceiling services
    'inspection.measurements_scope',  // three of its four chips begin with "+"
  ]) {
    assert.ok(marked.includes(must), `${must} still forces one answer`);
  }
});

test('every solo index points at a real chip', () => {
  // They are indices, so reordering a chip list would silently repoint them at
  // the wrong option — and the wrong option here means "everything else you
  // ticked just disappeared".
  for (const [job, f] of multiFields()) {
    for (const i of (f.solo || [])) {
      assert.ok(f.chips[i], `${job}.${f.id}: solo index ${i} points at nothing`);
    }
  }
});

test('a solo chip really is one that cannot coexist', () => {
  // Read the text, not the index: these must be the "none / all clear / don't
  // know" options. A wrongly marked one wipes real answers on every tap.
  // No \b: JavaScript's word boundary is ASCII-only, so it never fires after a
  // Hebrew letter and "^לא\b" silently matches nothing at all.
  const looksSolo = /^לא[ ·]|^אין |לא יודע|לא ידוע|הכל בפנים|פנוי לחלוטין|גישה חופשית|חניה נוחה|ריק|בעצמו|בלי מדידות|יש חשמל ומים|מעלית זמינה/;
  for (const [job, f] of multiFields()) {
    for (const i of (f.solo || [])) {
      assert.match(f.chips[i], looksSolo, `${job}.${f.id}: "${f.chips[i]}" is marked solo but reads combinable`);
    }
  }
});

test('two answers to one question both survive', () => {
  const toggle = toggler();
  const f = CHECKLISTS.charger.fields.find((x) => x.id === 'route_type');
  let v = '';
  v = toggle(f, v, f.chips[1]);
  v = toggle(f, v, f.chips[4]);
  assert.equal(v, `${f.chips[1]} | ${f.chips[4]}`);
  // Tapping again removes just that one.
  v = toggle(f, v, f.chips[1]);
  assert.equal(v, f.chips[4]);
});

test('the answer reads in checklist order, not tap order', () => {
  // Otherwise the same job characterised twice produces two different sentences
  // in the quote, and they read as two different answers.
  const toggle = toggler();
  const f = CHECKLISTS.charger.fields.find((x) => x.id === 'route_type');
  const pick = (...idx) => idx.reduce((v, i) => toggle(f, v, f.chips[i]), '');
  assert.equal(pick(0, 3), pick(3, 0));
  assert.equal(pick(4, 1, 2), `${f.chips[1]} | ${f.chips[2]} | ${f.chips[4]}`);
});

test('"none of the above" clears the rest, and the rest clears it', () => {
  // Without this the card cheerfully records "no hidden infrastructure AND
  // underfloor heating", which is not an answer.
  const toggle = toggler();
  const f = CHECKLISTS.points.fields.find((x) => x.id === 'hidden_infrastructure');
  const none = f.chips[f.solo[0]];
  let v = toggle(f, '', f.chips[1]);
  v = toggle(f, v, f.chips[2]);
  assert.ok(v.includes(' | '), 'two real answers did not combine');
  v = toggle(f, v, none);
  assert.equal(v, none, '"none" did not clear the real answers');
  v = toggle(f, v, f.chips[1]);
  assert.equal(v, f.chips[1], 'a real answer did not clear "none"');
});

test('the card does not run away after the first tap', () => {
  // The one that would have made all of the above pointless: renderSpecCard
  // advances to the next unanswered question the moment an answer lands, so on
  // a multi-answer field the second chip is literally unreachable.
  const render = APP.slice(APP.indexOf('function renderSpecCard'));
  const body = render.slice(0, render.indexOf('\nfunction '));
  assert.match(body, /holdMulti/, 'the card still advances off a multi-answer question');
  assert.match(body, /openField && openField\.multi && answers\[specOpenField\]/,
    'the hold is not conditioned on the open field being a multi one');
  assert.match(body, /!editingOpen && !holdMulti/, 'the hold is not applied to the advance');
  // And something has to close it deliberately.
  assert.match(APP, /function doneSpecField\(/, 'nothing can move past a multi-answer question');
  assert.match(body, /doneSpecField\(\)/, 'the continue button is never rendered');
});

test('a fork still fires when its trigger is one of several answers', () => {
  // maybeAskFollowUp compared the whole stored value against the trigger list,
  // which for a joined answer can only ever match when exactly one chip is
  // selected — so the 3×25 charger fork would go quiet the moment a second
  // answer was added to the same field.
  const fn = APP.slice(APP.indexOf('function maybeAskFollowUp'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /specValues\(value\)\.some/, 'a fork is still matched against the whole joined answer');
});

test('the multi rule in the app matches the one this file tests', () => {
  // The toggle above is a copy, and a copy that drifts tests nothing.
  const fn = APP.slice(APP.indexOf('function setSpecChip('), APP.indexOf('function doneSpecField('));
  for (const line of [
    'current.includes(chip)',
    'solo.includes(chip)',
    'current.filter((c) => !solo.includes(c)).concat(chip)',
    'field.chips.indexOf(a) - field.chips.indexOf(b)',
  ]) {
    assert.ok(fn.includes(line), `setSpecChip no longer does: ${line}`);
  }
});
