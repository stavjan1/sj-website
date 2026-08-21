// Does the pricing bot have what it needs to answer, before we ask it anything?
//
// Grading a model's Hebrew prose is slow, costs quota, and confounds two very
// different failures: "the model reasoned badly" and "the model was never told".
// Only the second one is fixable from here, and it is deterministic — so it gets
// its own harness.
//
// For each case in docs/PRICING-EVAL-CASES.md this assembles the REAL system
// prompt that case would produce (the same five client blocks the app
// concatenates, plus the server's pricing map and the per-item materials
// lookup), then checks whether the facts the rubric demands are actually in it.
//
// A pass here does not mean the answer will be good. A FAIL here means the
// answer cannot be good, whatever the model does.
//
//   node scripts/eval/prompt_coverage.mjs            # all cases
//   node scripts/eval/prompt_coverage.mjs 1 4 19     # selected cases
//   node scripts/eval/prompt_coverage.mjs --verbose  # show every probe

import { readFileSync } from 'node:fs';
import {
  hydrate, searchMaterials, searchMaterialsMulti, extractItemQueries,
  categoryStats, renderMaterialsBlock, consumableQueries, renderQuoteChecklist,
} from '../../functions/api/_materials.js';
import { DEFAULT_PRICING_MAP } from '../../functions/api/_pricing_map.js';
import { detectJobType, renderCoverageBlock } from '../../functions/api/_coverage.js';
import { renderPanelSizerBlock } from '../../functions/api/_panel_sizer.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const db = hydrate(JSON.parse(read('data/materials/index.json')));
const COVERAGE = JSON.parse(read('data/coverage/checklists.json'));
const PANEL_JOB = /לוח חשמל|לוח דירתי|החלפת לוח|ארון חשמל|מודול|מקומות בלוח|מא"ז|מאז|ממסר פחת|מגען|שעון שבת|תלת פאזי|תלת-פאזי/;

// --------------------------------------------------------------------------
// The client-side blocks
// --------------------------------------------------------------------------
// sale/app.js is a 680KB browser script with no module boundary, so rather than
// booting it we lift out the two blocks that are literal text plus the labor
// book, which is data. That is the whole of what a pricing turn carries today:
// the system catalog is empty in production (verified against /api/catalog), so
// getPriceCatalogPromptBlock renders to nothing.
const APP = read('sale/app.js');

function literalBlock(fnName) {
  const at = APP.indexOf(`function ${fnName}(`);
  if (at === -1) return '';
  // Take the backtick-delimited template literals inside the function body.
  const body = APP.slice(at, at + 12000);
  const parts = body.match(/`[^`]*`/g) || [];
  return parts.join('\n');
}

function sternBlock() {
  const rows = JSON.parse(read('sale/stern-pricing.json').replace(/^﻿/, ''));
  const items = Array.isArray(rows) ? rows : rows.items;
  return items
    .filter((it) => it && it.description && Number(it.price) > 0)
    .map((it) => `• ${it.description}${it.unit ? ` (${it.unit})` : ''} — ${it.price} ₪`)
    .join('\n');
}

const STATIC_CLIENT = [
  literalBlock('getProfessionSystemInstruction'),
  sternBlock(),
  literalBlock('getMarketAnchorsPromptBlock'),
  literalBlock('getPricingInstinctPromptBlock'),
].join('\n\n');

// --------------------------------------------------------------------------
// The cases
// --------------------------------------------------------------------------

function parseCases(md) {
  const out = [];
  const chunks = md.split(/^### מקרה /m).slice(1);
  for (const c of chunks) {
    const num = parseInt(c, 10);
    const title = (c.split('\n')[0] || '').replace(/^\d+\s*—\s*/, '').trim();
    const msg = (c.match(/\*\*ההודעה:\*\*\s*\n((?:>.*\n?)+)/) || [, ''])[1]
      .replace(/^>\s?/gm, '').trim();
    const must = (c.match(/\*\*מה תשובה טובה חייבת לכלול:\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n---|$)/) || [, ''])[1];
    const requirements = must.split('\n').filter((l) => l.trim().startsWith('-'))
      .map((l) => l.replace(/^-\s*/, '').replace(/\*\*/g, '').trim());
    if (msg) out.push({ num, title, msg, requirements });
  }
  return out;
}

// --------------------------------------------------------------------------
// Probes — the specific facts a correct answer needs, and where they live
// --------------------------------------------------------------------------
// Each probe is a requirement pattern plus a test for whether the assembled
// prompt actually supplies it. Deliberately narrow: a probe that matches loosely
// would report coverage that is not there, which is the one result that would
// make this harness worse than useless.
const PROBES = [
  { id: 'בודק', when: /בודק/,
    has: (p) => /בודק/.test(p) && /600|1,?500/.test(p) },
  { id: 'פחת ייעודי A-EV/B', when: /פחת.*(A-EV|טיפוס B|ייעודי)|A-EV|טיפוס B/i,
    has: (p) => /A-EV|טיפוס B|פחת ייעודי/i.test(p) },
  { id: 'מפסק פקט', when: /פקט/, has: (p) => /פקט/.test(p) },
  { id: 'PG 21 / מרירון', when: /PG|מרירון|מריכף/i,
    has: (p) => /PG\s?21|EL-022/i.test(p) || /מריכף 16|מרירון 16/.test(p) },
  { id: 'לפני מע"מ', when: /מע"מ|מעמ/, has: (p) => /לפני מע"מ/.test(p) },
  { id: 'פיר חח"י אסור', when: /פיר|חח"י/, has: (p) => /פיר של חברת החשמל|בתוך הפיר של חח"י|אסור.{0,40}פיר/.test(p) },
  { id: 'חד=3 גידים / תלת=5', when: /גיד|3x|5x|פאזי/i,
    has: (p) => /חד-פאזי = כבל 3 גידים|תלת-פאזי = כבל 5 גידים/.test(p) },
  { id: '150 ₪ למקום מאובזר', when: /מודול|מקום מאובזר|לוח/,
    has: (p) => /150 ₪ לכל מקום מאובזר|מקום מאובזר/.test(p) },
  { id: 'גבס אדום', when: /גבס אדום|ארון עץ|עץ/,
    has: (p) => /גבס אדום/.test(p) },
  { id: 'אלקטרודות + שוחה 1500', when: /אלקטרוד|שוחה|הארקה/,
    has: (p) => /2 אלקטרודות \+ שוחה|אלקטרודות/.test(p) },
  { id: 'אגרות חח"י', when: /הגדלת חיבור|חח"י|3X25|1X40/i,
    has: (p) => /אגרות חברת החשמל|1X40→3X25|3,651/.test(p) },
  { id: 'תאורה — שתי מדרגות', when: /גוף תאורה|גופי תאורה|ספוט/,
    has: (p) => /ראש בראש/.test(p) },
  { id: 'חציבה — הקשר פרטי מול מכרז', when: /חציב/,
    has: (p) => /בלוק: ~700|1,000 ₪ למטר/.test(p) },
  { id: 'אריזה שלמה (גליל)', when: /שרשור|מריכף|צינור/,
    has: (p) => /אינו אומר שאפשר לקנות מטר|גליל\/חבילה/.test(p) },
];

// --------------------------------------------------------------------------

function buildPrompt(caseText) {
  const queries = extractItemQueries(caseText);
  const hits = queries.length >= 3
    ? searchMaterialsMulti(db, queries, 3, 45)
    : searchMaterials(db, caseText, 45);
  const named = new Set(hits.map((h) => h.sku));
  const forgotten = searchMaterialsMulti(db, consumableQueries(caseText), 1, 12)
    .filter((h) => !named.has(h.sku));
  const materials = renderMaterialsBlock(db, hits, categoryStats(db, caseText), forgotten);
  return [STATIC_CLIENT, DEFAULT_PRICING_MAP, materials].join('\n\n');
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);

const cases = parseCases(read('docs/PRICING-EVAL-CASES.md'))
  .filter((c) => !only.length || only.includes(c.num));

let totalChecked = 0, totalMissing = 0;
const gaps = new Map();

for (const c of cases) {
  const prompt = buildPrompt(c.msg);
  const reqText = c.requirements.join(' \n ');
  const fired = PROBES.filter((p) => p.when.test(reqText));
  const missing = fired.filter((p) => !p.has(prompt));
  totalChecked += fired.length;
  totalMissing += missing.length;
  for (const m of missing) gaps.set(m.id, (gaps.get(m.id) || 0) + 1);

  const mark = missing.length === 0 ? '✔' : '✖';
  console.log(`${mark} מקרה ${String(c.num).padStart(2)} — ${c.title.slice(0, 44).padEnd(44)} ${fired.length - missing.length}/${fired.length} · prompt ${Math.round(prompt.length / 1000)}KB`);
  if (missing.length) console.log(`     חסר: ${missing.map((m) => m.id).join(' · ')}`);
  if (verbose) console.log(`     probes: ${fired.map((p) => p.id).join(' · ')}`);
}

console.log(`\n${cases.length} cases · ${totalChecked - totalMissing}/${totalChecked} required facts present`);
if (gaps.size) {
  console.log('\nGaps, most frequent first:');
  [...gaps.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([id, n]) => console.log(`   ${String(n).padStart(2)}×  ${id}`));
}
