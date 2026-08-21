// Guards for the supplier materials database.
//
// These are not "does the JSON parse" tests. The database exists so a pricing
// agent can quote a real number, and the ways it can quietly stop doing that
// are specific: a re-harvest that drops a whole product family, a zero price
// that makes an item look free, a unit that says "מטר" for something sold per
// piece, or a normalizer change in Python that stops matching the normalizer in
// JavaScript so every Hebrew search returns nothing. Each of those has a test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  hydrate, norm, searchMaterials, categoryStats, renderMaterialsBlock,
  renderTaxonomyBlock,
} from '../functions/api/_materials.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'data', 'materials', 'index.json');
const FULL_PATH = join(ROOT, 'data', 'materials', 'erco.json');

const raw = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const db = hydrate(raw);

// --------------------------------------------------------------------------
// Shape and integrity
// --------------------------------------------------------------------------

test('the index declares its price basis', () => {
  assert.ok(raw.meta, 'index.json has no meta block');
  // Every consumer downstream states "before VAT, retail" to the user on the
  // strength of this field. If the harvest ever changes basis, it must not do
  // so silently.
  assert.equal(raw.meta.price_basis, 'retail_ex_vat');
  assert.equal(raw.meta.vat_rate, 0.18);
  assert.equal(raw.meta.supplier.id, 'erco');
});

test('the catalog is big enough to be the catalog', () => {
  // A partial harvest (network died halfway, category renamed upstream) still
  // produces a valid file. Only a floor catches that.
  assert.ok(db.items.length > 5000,
    `only ${db.items.length} items — the harvest looks truncated`);
  assert.ok(db.cats.length > 300,
    `only ${db.cats.length} categories — category data looks lost`);
});

test('every row is usable as a price', () => {
  for (const it of db.items) {
    assert.ok(it.sku && typeof it.sku === 'string', `empty sku near ${it.name}`);
    assert.ok(it.name && it.name.length > 1, `empty name for sku ${it.sku}`);
    assert.ok(Number.isFinite(it.price), `non-numeric price for ${it.sku}`);
    // Zero is ERCO's placeholder for an unpriced family. It must never survive
    // into the database — an agent that reads 0 quotes the item as free.
    assert.ok(it.price > 0, `zero/negative price for ${it.sku} (${it.name})`);
    assert.ok(it.price < 100000, `implausible price ${it.price} for ${it.sku}`);
    assert.ok(it.unit === 'מטר' || it.unit === 'יחידה', `bad unit "${it.unit}" for ${it.sku}`);
  }
});

test('SKUs are unique', () => {
  const seen = new Set();
  const dupes = [];
  for (const it of db.items) {
    if (seen.has(it.sku)) dupes.push(it.sku);
    seen.add(it.sku);
  }
  assert.equal(dupes.length, 0, `duplicate SKUs: ${dupes.slice(0, 5).join(', ')}`);
});

test('the runtime index stays small enough to parse per cold start', () => {
  // The Worker parses this whole file on a cold isolate. Past ~3MB that starts
  // showing up as first-request latency on every chat turn.
  const mb = statSync(INDEX_PATH).size / 1e6;
  assert.ok(mb < 3, `index.json is ${mb.toFixed(1)}MB — too heavy for the Worker`);
});

test('ex-VAT and inc-VAT prices agree in the full dataset', () => {
  if (!existsSync(FULL_PATH)) return; // full file is optional for CI
  const full = JSON.parse(readFileSync(FULL_PATH, 'utf8'));
  let checked = 0;
  for (const it of full.items) {
    const expected = it.price * 1.18;
    assert.ok(Math.abs(expected - it.price_vat) < 0.03,
      `VAT mismatch on ${it.sku}: ${it.price} ex + 18% = ${expected.toFixed(2)} but stored ${it.price_vat}`);
    if (++checked > 2000) break;
  }
  assert.ok(checked > 0);
});

// --------------------------------------------------------------------------
// Normalisation parity
// --------------------------------------------------------------------------

// The Python builder and this JS module each normalize text before matching.
// If they ever disagree, search silently returns nothing for Hebrew queries —
// the failure looks like "the bot doesn't know prices", not like a bug. These
// cases are the ones the two implementations could plausibly diverge on.
test('norm() collapses the ways the trade writes the same thing', () => {
  assert.equal(norm('מא"ז'), norm('מאז'));
  assert.equal(norm('מא”ז'), norm('מאז'));
  assert.equal(norm('ממ"ר'), norm('ממר'));
  assert.equal(norm('3X1.5'), '3x1.5');
  assert.equal(norm('3×1.5'), '3x1.5');
  assert.equal(norm('3*1.5'), '3x1.5');
  assert.equal(norm('5x6 mm²'), '5x6 mm2');
  assert.equal(norm('  כבל   N2XY  '), 'כבל n2xy');
});

// --------------------------------------------------------------------------
// Search — the test that actually protects the product
// --------------------------------------------------------------------------

// Real phrasings an Israeli electrician types. If any of these stops returning
// a hit, the bot has silently gone back to guessing prices.
const TRADE_QUERIES = [
  'כבל N2XY 5x6',
  'כבל 3x2.5',
  'מא"ז 16A',
  'ממסר פחת',
  'שקע כוח',
  'צינור שרשורי',
  'תעלה',
  'ארון חשמל',
  'גוף תאורה LED',
  'הארקה',
  'אלקטרודה',
  'מפסק מאור',
  'קופסת חיבורים',
  'שרוול',
  'נעל כבל',
  'מולטימטר',
  'מהדק',
  'פס צבירה',
];

test('every common trade query finds something', () => {
  const empty = [];
  for (const q of TRADE_QUERIES) {
    const hits = searchMaterials(db, q, 10);
    if (!hits.length) empty.push(q);
  }
  assert.equal(empty.length, 0, `no results for: ${empty.join(' | ')}`);
});

test('a cross-section query lands on that cross-section', () => {
  const hits = searchMaterials(db, 'כבל N2XY 5x6', 10);
  const text = hits.map((h) => norm(h.name + ' ' + h.attrs)).join(' ');
  assert.ok(text.includes('5x6'), 'top results for "5x6" contain no 5x6 item');
});

test('an exact SKU wins outright', () => {
  const sample = db.items[Math.floor(db.items.length / 2)];
  const hits = searchMaterials(db, sample.sku, 5);
  assert.equal(hits[0].sku, sample.sku, 'exact SKU did not rank first');
});

test('one huge product family cannot swallow the whole result budget', () => {
  // Cable families run to 50+ variants. Without the per-category cap, a query
  // that mentions "כבל" returns 60 rows of one family and nothing else.
  const hits = searchMaterials(db, 'כבל', 40);
  const cats = new Set(hits.map((h) => h.cat));
  assert.ok(cats.size >= 2, 'all results came from a single category');
});

// Each of the four cases below is a real failure this search had, found by
// reading eval_search.mjs output rather than by any assertion. They are here so
// a future scoring tweak has to keep passing them.

test('trade slang reaches the catalog word for the same thing', () => {
  // ERCO files multimeters as "רב מודד" / "מודד". Before the synonym map, the
  // word every electrician actually says returned two hits out of a whole
  // measurement department.
  const hits = searchMaterials(db, 'מולטימטר', 6);
  assert.ok(hits.length >= 3, `only ${hits.length} hits for מולטימטר`);
  assert.ok(/מולטימטר|מודד/.test(hits[0].name), `top hit is unrelated: ${hits[0].name}`);

  // 'מא"ז' is filed as "חצי אוטומט" and 'מאמ"ת'.
  const mz = searchMaterials(db, 'מא"ז 3x25', 6);
  assert.ok(mz.length > 0, 'no hits for מא"ז 3x25');
  assert.ok(mz.some((h) => /אוטומט|מאמ|מא"ז|פקט|מנתק/.test(h.name)),
    `results are not breakers: ${mz.map((h) => h.name).join(' | ')}`);
});

test('the construct form of a noun still finds the plain form', () => {
  // "אלקטרודת הארקה" vs the shelf label "אלקטרודה להארקה" — one letter apart,
  // and it is the last letter, so neither token nor substring matching sees it.
  const hits = searchMaterials(db, 'אלקטרודת הארקה', 8);
  assert.ok(hits.some((h) => h.name.includes('אלקטרודה')),
    `no electrode in: ${hits.map((h) => h.name).join(' | ')}`);
  const trays = searchMaterials(db, 'תעלת רשת 100', 6);
  assert.ok(trays.some((h) => /תעל/.test(h.name)),
    `no tray in: ${trays.map((h) => h.name).join(' | ')}`);
});

test('being named the thing beats being filed near it', () => {
  // Every accessory in "אלקטרודות ואביזרי הארקה" used to outrank the electrode
  // itself, because the category text counted as much as the name and the
  // cheapest row won the tiebreak.
  const hits = searchMaterials(db, 'אלקטרודה', 10);
  const rank = hits.findIndex((h) => h.name.startsWith('אלקטרודה'));
  assert.ok(rank >= 0 && rank < 3,
    `an item actually named אלקטרודה ranked ${rank}: ${hits.map((h) => h.name).join(' | ')}`);
});

test('a digit in the query does not match a longer number', () => {
  // "12 מקום" ranked a part numbered 1212 above every 12-way panel.
  const hits = searchMaterials(db, 'לוח 12 מקום', 20);
  for (const h of hits) {
    assert.ok(!/1212/.test(h.name), `substring digit match leaked back in: ${h.name}`);
  }
});

// --------------------------------------------------------------------------
// Units — the field most likely to be quietly wrong
// --------------------------------------------------------------------------

test('discrete parts are not priced by the metre', () => {
  // Lugs, sleeves, electrodes and brackets all live under cable/conduit
  // categories. Matching the category PATH put them all on a per-metre price,
  // which turned a 198 ₪ earthing rod into "198 ₪ per metre".
  const perMetreOffenders = db.items.filter((it) =>
    it.unit === 'מטר' && /^(נעל כבל|אלקטרודה|סופית|מופה|מהדק|זרוע|נשם|מפצלת)/.test(it.name));
  assert.equal(perMetreOffenders.length, 0,
    `sold per metre but shouldn't be: ${perMetreOffenders.slice(0, 5).map((i) => i.name).join(' | ')}`);
});

test('cable really is priced by the metre', () => {
  const cables = db.items.filter((it) => /^כבל \d/.test(it.name) && /מוליך נחושת/.test(it.cat));
  assert.ok(cables.length > 20, `only ${cables.length} power cables found`);
  const wrong = cables.filter((it) => it.unit !== 'מטר');
  assert.equal(wrong.length, 0,
    `cable priced per unit: ${wrong.slice(0, 5).map((i) => i.name).join(' | ')}`);
});

test('a nonsense query returns nothing rather than noise', () => {
  assert.equal(searchMaterials(db, 'זזזזזז קוואנטי', 10).length, 0);
  assert.equal(searchMaterials(db, '', 10).length, 0);
  // Filler words alone must not match — otherwise every chat turn drags in 60
  // random rows and the real signal drowns.
  assert.equal(searchMaterials(db, 'כמה זה עולה בבקשה', 10).length, 0);
});

// --------------------------------------------------------------------------
// The block the model actually reads
// --------------------------------------------------------------------------

test('the prompt block states the basis it must not get wrong', () => {
  const hits = searchMaterials(db, 'כבל N2XY 5x6', 8);
  const block = renderMaterialsBlock(db, hits, categoryStats(db, 'כבל'));
  assert.ok(block.includes('לפני מע"מ'), 'block never says prices are pre-VAT');
  assert.ok(block.includes('הנחת סוחר'), 'block never warns retail ≠ contractor cost');
  assert.ok(/נתונים בלבד/.test(block), 'block lacks the prompt-injection guard line');
  for (const h of hits) assert.ok(block.includes(h.sku), `hit ${h.sku} missing from block`);
});

test('the taxonomy block stays inside its token budget', () => {
  const block = renderTaxonomyBlock(db, 120);
  const lines = block.split('\n').filter((l) => l.startsWith('•'));
  assert.equal(lines.length, 120, 'the cap is not being applied');
  assert.ok(block.includes('לפני מע"מ'), 'taxonomy block never states the price basis');
  // It rides along with the equipment kit, which is already ~12KB. Past this
  // the characterization prompt starts crowding out the user's own description.
  assert.ok(block.length < 14000, `taxonomy block is ${block.length} chars — too fat`);
});

test('the taxonomy leads with the categories that matter', () => {
  const block = renderTaxonomyBlock(db, 20);
  // Ordering is by item count, so the trade's bread and butter should be at the
  // top rather than a corner of the catalog.
  assert.ok(/כבל|תאורה|מפסק|לוח|מובילים/.test(block),
    'top categories look wrong — ordering may have broken');
});

test('an empty hit list renders no block at all', () => {
  // A block with a header and no rows teaches the model that the catalog is
  // empty, which is worse than not sending one.
  assert.equal(renderMaterialsBlock(db, [], []), '');
});
