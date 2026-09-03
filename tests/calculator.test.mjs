// The voltage-drop calculator on calculator.html. It used to compute
// I·ρ·L/A for a circuit it called single-phase, with L "the conductor length"
// — half the real drop, because the current comes back on the neutral. The
// formula now lives in one pure function on the page; this runs it in node:vm
// straight from the page source, so a rewrite of the markup cannot quietly
// drop the factor of two again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'calculator.html'), 'utf8').replace(/\r\n/g, '\n');

function load() {
    const start = PAGE.indexOf('// sj:voltage-drop-begin');
    const end = PAGE.indexOf('// sj:voltage-drop-end');
    assert.ok(start > -1 && end > start, 'the voltage-drop block moved or lost its markers');
    const ctx = vm.createContext({ Math });
    vm.runInContext(PAGE.slice(start, end), ctx);
    return ctx;
}

const near = (got, want, msg) => assert.ok(Math.abs(got - want) < 1e-6, `${msg}: got ${got}, wanted ${want}`);

test('single-phase counts the conductor twice: out on the line, back on the neutral', () => {
    const { sjVoltageDrop } = load();
    // Copper ρ = 0.0175 Ω·mm²/m, 16 A, 25 m one way, 2.5 mm² → 2·16·0.0175·25/2.5 = 5.6 V.
    near(sjVoltageDrop(16, 25, 2.5, 0.0175, 'single'), 5.6, 'single-phase');
    // The old page answered 2.8 V for the same run. That number must not come back.
    assert.notEqual(Math.round(sjVoltageDrop(16, 25, 2.5, 0.0175, 'single') * 100) / 100, 2.8);
});

test('three-phase carries √3, not 2', () => {
    const { sjVoltageDrop } = load();
    near(sjVoltageDrop(16, 25, 2.5, 0.0175, 'three'), Math.sqrt(3) * 16 * 0.0175 * 25 / 2.5, 'three-phase');
    // Balanced three-phase drops less than the same current single-phase.
    assert.ok(sjVoltageDrop(10, 40, 6, 0.017, 'three') < sjVoltageDrop(10, 40, 6, 0.017, 'single'));
});

test('the drop scales the way physics says it does', () => {
    const { sjVoltageDrop } = load();
    const base = sjVoltageDrop(10, 30, 4, 0.017, 'single');
    near(sjVoltageDrop(20, 30, 4, 0.017, 'single'), base * 2, 'double the current');
    near(sjVoltageDrop(10, 60, 4, 0.017, 'single'), base * 2, 'double the length');
    near(sjVoltageDrop(10, 30, 8, 0.017, 'single'), base / 2, 'double the section');
    near(sjVoltageDrop(10, 30, 4, 0.028, 'single'), base * 0.028 / 0.017, 'aluminium');
    assert.equal(sjVoltageDrop(0, 30, 4, 0.017, 'single'), 0, 'no current, no drop');
});

test('the percentage is taken against the right nominal voltage', () => {
    const { sjNominalVolts } = load();
    assert.equal(sjNominalVolts('single'), 230);
    assert.equal(sjNominalVolts('three'), 400);
});

test('the page offers the phase choice and names the length as one-way', () => {
    assert.match(PAGE, /<select class="select" id="calc-phase">/, 'no phase selector');
    assert.match(PAGE, /value="single"[^>]*>חד-פאזי/, 'single-phase option');
    assert.match(PAGE, /value="three"[^>]*>תלת-פאזי/, 'three-phase option');
    assert.match(PAGE, /<label for="calc-length">אורך המוליך \(כיוון אחד\)/, 'L must be labelled as the one-way length');
    assert.match(PAGE, /getElementById\('calc-phase'\)\.value/, 'the handler never reads the phase');
});
