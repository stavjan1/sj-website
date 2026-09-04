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
  renderTaxonomyBlock, searchMaterialsMulti, extractItemQueries, consumableQueries,
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

test('the unit rules were scored, not just trusted', () => {
  // 5,216 rows get their unit from a category rule and nothing downstream can
  // tell whether those rules are any good — the output looks identical either
  // way. The builder scores them against the 731 units read off real product
  // pages and stamps the result here; it refuses to write the file below 90%.
  assert.ok(raw.meta.unit_accuracy === null || raw.meta.unit_accuracy >= 0.9,
    `unit rules scored ${raw.meta.unit_accuracy} against page-verified truth`);
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

// --------------------------------------------------------------------------
// What must NOT be in the catalog
// --------------------------------------------------------------------------

// ERCO also sells kitchen appliances, phone chargers, space heaters and a
// whole tool department. None of it is a quotable material, and all of it won
// searches it had no business winning ("מפסק מוגן מים IP65" → two heaters).
// The build cuts it; these canaries make sure a re-harvest cannot let it back.
const MUST_NOT_SHIP = /SHARK|NINJA|Iphone|מייבש ידיים|מאוורר רצפה|מאוורר ריצפה|תנור אינפרא (?!לקיר)|רב מודד|Makita|סרט תואם דיימו|מולטימטר|קומקום חשמלי|מטען נייד/i;
const MUST_SHIP = [/N2XY/, /מא"ז/, /^ממסר פחת/, /מאוורר תקרה/, /^שנאי/, /^גלאי עשן/, /^פעמון/,
  // ...and the Gewiss/VEGA smart switches ERCO files under a weekend-sale promo bucket.
  /^מפסק חכם/, /^מפסק לדוד .*WIFI/];

test('consumer goods and tools are not in the catalog', () => {
  const leaked = db.items.filter((it) => MUST_NOT_SHIP.test(it.name));
  assert.equal(leaked.length, 0,
    `not materials, still shipped: ${leaked.slice(0, 5).map((i) => i.name).join(' | ')}`);
});

test('the cut did not take the electrical goods filed next to the junk', () => {
  // Transformers, detectors and bells share ERCO's "home electricity" anchor
  // with the kettles; ceiling fans share a bucket with the box fans; the UV
  // N2XY ranges are filed under power-tool accessories.
  const missing = MUST_SHIP.filter((rx) => !db.items.some((it) => rx.test(it.name)));
  assert.equal(missing.length, 0, `cut too deep, lost: ${missing.join(' ')}`);
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
  'מגען',
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
  // ERCO files contactors as "מגען"; half the trade says "קונטקטור". Before
  // the synonym map the loan-word returned nothing. (This used to be checked
  // on מולטימטר / "רב מודד" — meters are tools, and tools no longer ship in the
  // catalog, so the check moved to a part that does.)
  const hits = searchMaterials(db, 'קונטקטור', 6);
  assert.ok(hits.length >= 3, `only ${hits.length} hits for קונטקטור`);
  assert.ok(/מגען/.test(hits[0].name), `top hit is unrelated: ${hits[0].name}`);

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

test('a rating matches with or without its unit letter', () => {
  // Found live: "ממסר פחת 4x40" did not whole-match "ממסר פחת 4X40A", fell back
  // to substring scoring, and ranked pre-assembled service boxes — whose names
  // contain a bare "4X40" — above the RCD itself.
  const hits = searchMaterials(db, 'ממסר פחת 4x40 30mA', 5);
  assert.ok(hits.length > 0, 'no hits at all');
  assert.ok(/^ממסר פחת/.test(hits[0].name),
    `top hit is not an RCD: ${hits.map((h) => h.name).join(' | ')}`);

  // Both directions of the same equivalence.
  for (const q of ['מא"ז 16A', 'מא"ז 1x16']) {
    const r = searchMaterials(db, q, 5);
    assert.ok(r.length > 0, `no hits for ${q}`);
    assert.ok(r.some((h) => /מא"ז|אוטומט|מפ"ז/.test(h.name)),
      `${q} returned non-breakers: ${r.map((h) => h.name).join(' | ')}`);
  }
});

// --------------------------------------------------------------------------
// Retrieval on a real pricing handoff — where this search actually earns its pay
// --------------------------------------------------------------------------

// The pricing turn does not send "כבל 5x6". It sends the approved scope plus a
// product list, ~500 characters. Searched as one blob, the coverage weight
// (covered/concepts)² collapsed — an item matching the two words that mattered
// scored (2/60)² and lost to anything sharing six incidental words. Measured
// output was charging stations and cable lugs, with none of the actual BOM.
const HANDOFF = `אשר את התמחור לפרויקט: התקנת עמדת טעינה לרכב חשמלי 11kW תלת פאזי בבית משותף.
אפיון מאושר: המרחק מלוח הדירה לחניה כ-25 מטר, מעבר דרך פיר תקשורת קיים ואז תעלה בחניון,
קידוח אחד דרך קיר בטון, יש מקום פנוי בלוח, חיבור תלת פאזי 3x25.
רשימת מוצרים: עמדת טעינה 11kW, כבל N2XY 5x4, ממסר פחת Type A-EV 4x40 30mA, מא"ז 3x20,
מפסק פקט, צינור מריכף 16, צינור גמיש לבן PG 21 לפניות, קופסת חיבורים, נעלי כבל.`;

test('a job description is cut into the items it is made of', () => {
  const qs = extractItemQueries(HANDOFF);
  assert.ok(qs.length >= 8, `only ${qs.length} item queries from a 9-item list`);
  const joined = qs.join(' | ');
  assert.ok(/PG 21/.test(joined), `PG 21 not extracted: ${joined}`);
  assert.ok(/מריכף 16/.test(joined), `מריכף 16 not extracted: ${joined}`);
  // The prose above the list must not survive as a "product".
  assert.ok(!qs.some((q) => q.length > 60));
});

test('every line of a real BOM gets found', () => {
  const hits = searchMaterialsMulti(db, extractItemQueries(HANDOFF), 3, 45);
  const must = [
    ['PG 21',      /PG\s?21|EL-022/],
    ['מריכף 16',   /מריכף 16/],
    ['כבל 5x4',    /5X4|5x4/],
    ['ממסר פחת',   /^ממסר פחת/],
    ['מפסק פקט',   /פקט/],
    ['מא"ז 3x20',  /3X20|3x20/],
  ];
  const missing = must.filter(([, rx]) => !hits.some((h) => rx.test(h.name))).map(([n]) => n);
  assert.equal(missing.length, 0,
    `BOM lines the search could not find, all of which ARE in the catalog: ${missing.join(', ')}`);
});

test('the block sizes itself to the job, not to the catalog', () => {
  // This is the whole answer to "don't flood the model": a 3-item job must not
  // cost what a 20-item job costs.
  const small = searchMaterialsMulti(db, extractItemQueries('רשימת מוצרים: כבל N2XY 5x6, מא"ז 3x25'), 3, 45);
  const big = searchMaterialsMulti(db, extractItemQueries(HANDOFF), 3, 45);
  assert.ok(small.length < big.length / 2,
    `a 2-item job returned ${small.length} rows against ${big.length} for a 9-item job`);
});

test('מרירון and מריכף are not treated as the same conduit', () => {
  // Stav's correction: a charger run uses מרירון. They look alike and ERCO
  // carries them as two separate categories at different sizes and prices, so a
  // synonym between them silently swaps the conduit in every charger quote.
  const mr = searchMaterials(db, 'צינור מרירון', 5);
  assert.ok(mr.length > 0, 'no מרירון found at all');
  assert.ok(mr.every((h) => /מרירון/.test(h.name)),
    `מרירון query returned other conduit: ${mr.map((h) => h.name).join(' | ')}`);

  const mk = searchMaterials(db, 'צינור מריכף 16', 5);
  assert.ok(mk.some((h) => /מריכף 16/.test(h.name)), 'מריכף 16 no longer findable');
});

test('a charger job is reminded about מרירון, not מריכף', () => {
  const qs = consumableQueries('התקנת עמדת טעינה לרכב חשמלי בבית פרטי');
  assert.ok(qs.some((q) => /מרירון/.test(q)), `charger consumables: ${qs.join(' | ')}`);
  assert.ok(!qs.some((q) => /מריכף/.test(q)), 'מריכף should not be a charger default');
});

// The real handoff: the approved characterisation CARD, then the product list.
// The card is 14 question bullets and the list is 9 items, and the card used to
// win — see the test below for why.
const REAL_HANDOFF = `האפיון הושלם ואושר. תמחר את העבודה במלואה, עבודה + חומרים.

כרטיס אפיון מאושר
• מה בדיוק עושים? התקנת עמדת טעינה חדשה
• סוג הנכס? בית פרטי דו-משפחתי
• גודל החיבור הראשי הקיים? 3x25 אמפר
• מרחק הלוח מהחניה? כ-25 מטר
• סוג הקיר בנקודות המעבר? בטון מזוין
• מי סוגר אחרי העבודה: טיח, צבע, ניקיון? סגירה גסה בלבד

רשימת המוצרים שגובשה:
• כבל N2XY 5x6 ממ"ר — כ-30 מטר כולל רזרבה
• צינור מרירון 25 להגנה בתוואי החיצוני
• צינור גמיש לבן PG 21 לפניות ליד הלוח והעמדה
• ממסר פחת Type A-EV 4x40 30mA
• מפסק פקט מוגן מים IP65 ליד העמדה`;

test('the characterisation card does not get mistaken for the product list', () => {
  // The handoff opens "תמחר את העבודה במלואה, עבודה + חומרים". A bare "חומרים"
  // marker matched THAT, so everything after it — including the card's question
  // bullets — was searched as products. The questions ate the budget and four
  // of the six real items were never looked up at all.
  const qs = extractItemQueries(REAL_HANDOFF);
  assert.ok(qs.length <= 12, `${qs.length} queries — the card is leaking in`);
  const joined = qs.join(' | ');
  assert.ok(!/סוג הנכס|מי סוגר|סוג הקיר/.test(joined),
    `card questions became product queries: ${joined}`);
});

test('every line of a real handoff BOM gets priced', () => {
  const hits = searchMaterialsMulti(db, extractItemQueries(REAL_HANDOFF), 3, 45);
  const must = [
    ['כבל 5x6',   /5X6|5x6/],
    ['מרירון',    /מרירון/],
    ['PG 21',     /PG\s?21|EL-022/],
    ['ממסר פחת',  /^ממסר פחת/],
    ['פקט',       /פקט/],
  ];
  const missing = must.filter(([, rx]) => !hits.some((h) => rx.test(h.name))).map(([n]) => n);
  assert.equal(missing.length, 0, `handoff items never looked up: ${missing.join(', ')}`);
});

test('the word that names the product beats the words that describe it', () => {
  // "מפסק פקט מוגן מים IP65" returned a water-resistant HEATER: three
  // description words outvoted the one word naming the part, and IP65 is a
  // digit token a heater and a switch genuinely share. Rarity fixes it —
  // "פקט" is in ~30 products, "מוגן" and "מים" in hundreds.
  const hits = searchMaterials(db, 'מפסק פקט מוגן מים IP65 ליד העמדה', 6);
  assert.ok(hits.some((h) => /פקט/.test(h.name)),
    `no פקט in: ${hits.map((h) => h.name).join(' | ')}`);
  assert.ok(!/תנור|חימום/.test(hits[0].name),
    `top hit is a heater: ${hits[0].name}`);
});

test('a misspelling still finds the product', () => {
  // Hebrew typos are mostly homophone swaps (ח/כ, ט/ת, א/ע/ה) plus dropped
  // letters. Both classes are repaired against the catalog's own vocabulary.
  for (const [typo, rx] of [['מגאן', /מגען/], ['אלקטרודה', /אלקטרודה/]]) {
    const hits = searchMaterials(db, typo, 3);
    assert.ok(hits.length > 0, `no hits for ${typo}`);
    assert.ok(hits.some((h) => rx.test(h.name)), `${typo} → ${hits.map((h) => h.name).join(' | ')}`);
  }
});

test('the quoted and unquoted spellings are the same query', () => {
  // Stav must not be forced to type the gershayim.
  const a = searchMaterials(db, 'מא"ז 16A', 5).map((h) => h.sku).join();
  const b = searchMaterials(db, 'מאז 16A', 5).map((h) => h.sku).join();
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test('the block warns that a per-metre price is not a per-metre purchase', () => {
  // Field correction from Stav: corrugated conduit is priced per metre but sold
  // by the coil. Multiplying metres by the per-metre price understates the buy.
  const hits = searchMaterials(db, 'צינור שרשורי 25', 5);
  const block = renderMaterialsBlock(db, hits, []);
  assert.ok(block.includes('אינו אומר שאפשר לקנות מטר'), 'pack-size caveat missing');
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

test('a miscategorised cable is still priced as cable', () => {
  // ERCO files its UV-rated N2XY ranges under power-TOOL accessories, and the
  // category rule faithfully reproduced that: "כבל N2XY 5x6 FR UV" came out at
  // 32 ₪ per piece. The shape of the name has to be able to overrule the shelf
  // it was put on.
  const uv = db.items.filter((it) => /^כבל N2XY .*UV/.test(it.name));
  assert.ok(uv.length >= 10, `only ${uv.length} UV cable rows — range may have moved`);
  const perPiece = uv.filter((it) => it.unit !== 'מטר');
  assert.equal(perPiece.length, 0,
    `UV cable priced per piece: ${perPiece.slice(0, 4).map((i) => i.name).join(' | ')}`);
});

test('a finished lead is not priced by the metre', () => {
  // The mirror image, and the reason the rule above cannot be "anything called
  // כבל is per metre": an extension lead states its own length and is sold as
  // one object. A drum that states ITS length is still bulk cable.
  const leads = db.items.filter((it) => /^כבל מאריך|^כבל קומקום|^כבל טעינה/.test(it.name));
  assert.ok(leads.length >= 5, `only ${leads.length} finished leads found`);
  const perMetre = leads.filter((it) => it.unit === 'מטר');
  assert.equal(perMetre.length, 0,
    `finished lead priced per metre: ${perMetre.slice(0, 4).map((i) => i.name).join(' | ')}`);
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
