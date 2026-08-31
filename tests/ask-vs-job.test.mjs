// A question is not a job, everywhere it matters.
//
// When a conversation stopped needing a project to exist, one record started
// carrying both — `kind: 'ask'` for a thread, anything else for tracked work.
// The cheap part was the model. The expensive part is that every surface which
// counts, lists or bills projects has to learn the difference, and the ones
// that do not fail silently: a question shows up as a job, a funnel looks
// busier than the work is, and a free plan fills its project cap with
// questions.
//
// Two of those were caught the day the field was added and one was not — the
// money board went on treating every thread as money in flight. These pin all
// of them so the next surface that forgets is a failing test rather than a
// number Stav cannot explain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readApp } from './_app-source.mjs';

const APP = readApp().replace(/\r\n/g, '\n');

const bodyOf = (name) => {
    const i = APP.indexOf(`function ${name}(`);
    assert.notEqual(i, -1, `${name} should exist`);
    return APP.slice(i, APP.indexOf('\n}\n', i));
};

test('a missing kind reads as a job, so nothing written before the field breaks', () => {
    // Every project that existed before 28/08 has no `kind`. If isJob defaulted
    // the other way, every one of them would vanish from the work list at once.
    assert.match(APP, /function isAsk\(p\)\s*\{\s*return !!p && p\.kind === 'ask';/);
    assert.match(APP, /function isJob\(p\)\s*\{\s*return !!p && p\.kind !== 'ask';/);
});

test('the work list shows work', () => {
    assert.match(bodyOf('filterProjectsList'), /projectsList\.filter\(isJob\)/);
});

test('the dashboard counts jobs, not questions', () => {
    const body = bodyOf('updateMetricsDashboard');
    assert.match(body, /projectsList\.filter\(isJob\)/,
        'a question must not inflate "כמה עבודות פתוחות"');
});

test('the money board is money in flight, not every thread', () => {
    // This is the one that was missed. Without the filter, asking three pricing
    // questions puts three cards in the first column of the pipeline and three
    // amounts of ₪0 into a funnel Stav reads to decide what to chase.
    const body = bodyOf('renderStatistics');
    assert.match(body, /filter\(isJob\)/, 'the board filters to jobs');
});

test('the plan gate counts jobs, so questions cannot lock a free user out', () => {
    const body = bodyOf('createNewProject');
    assert.match(body, /countJobs\(\)\s*>=\s*projCap/,
        'the cap is measured in jobs');
    assert.match(body, /if \(!isAsk\)/, 'and a question never reaches the gate');
});

test('nothing lands in a column that does not exist', () => {
    // My own worry, checked rather than assumed: a status the pipeline does not
    // recognise falls through to the first column instead of dropping the
    // project off the board.
    const stage = bodyOf('projectPipelineStage');
    assert.match(stage, /return getProjectStage\(p\) === 'planning' \? 'planning' : 'quote';/,
        'an unrecognised status still resolves to a column');
    assert.match(bodyOf('renderStatistics'), /\|\| cols\.planning/,
        'and the board has a fallback bucket besides');
});
