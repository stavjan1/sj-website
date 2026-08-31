// Extract the coverage checklists out of the browser bundle into plain JSON the
// server can read.
//
// sale/coverage.js is a 189KB browser script holding COVERAGE_CHECKLISTS — nine
// job types, each with the fields that must be known before anyone is allowed to
// price, the exclusions that become "מה לא כלול", and the red flags. It is the
// product's most carefully authored asset, Stav signed every line, and until now
// it drove the question UI and nothing else: the pricing model never saw a word
// of it.
//
// Thirty-nine of the pricingImpact lines carry real money — "שקע 450 ₪, מאור
// 450-485 ₪, כח למכשיר קבוע 800 ₪", "ניסור אספלט 150-400 ₪ למטר", "CT בארון
// מרוחק, כ-1,000-2,000 ₪ שנעלמים מהצעה שלא שאלה". That is exactly the knowledge
// a pricing agent should be conditioned on.
//
// The authored source stays sale/coverage.js. This only mirrors it, and
// tests/coverage-data.test.mjs fails if the mirror drifts.
//
//   node scripts/build_coverage_data.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('sale/coverage.js', ROOT);
const OUT_DIR = new URL('data/coverage/', ROOT);
const OUT = new URL('checklists.json', OUT_DIR);

export function extract(source) {
  // The file declares `const COVERAGE_CHECKLISTS`, and a top-level `const` in a
  // vm script never lands on the context object — so ask for it explicitly.
  const ctx = createContext({ window: {}, document: { addEventListener() {} } });
  runInContext(`${source}\n;globalThis.__CC = COVERAGE_CHECKLISTS;`, ctx, { timeout: 10000 });
  const cc = ctx.__CC;
  if (!cc || typeof cc !== 'object') throw new Error('COVERAGE_CHECKLISTS not found');

  const out = {};
  for (const [job, spec] of Object.entries(cc)) {
    out[job] = {
      label: spec.label || job,
      // Only the parts a pricing agent can act on. `question`, `why`, `chips`
      // and `assumption` drive the interview UI and would double the size here
      // for no pricing benefit.
      impacts: (spec.fields || [])
        .filter((f) => f && f.pricingImpact)
        .map((f) => ({ id: f.id, impact: f.pricingImpact, critical: !!f.critical })),
      // Conditional follow-ups: an answer that forks the job rather than just
      // describing it. The server needs these so the pricing agent knows the
      // fork was put to the customer and which way it went.
      followUps: (spec.fields || [])
        .filter((f) => f && f.followUp)
        .map((f) => ({ id: f.id, ...f.followUp })),
      exclusions: (spec.exclusions || []).map(String),
      redFlags: (spec.redFlags || []).map((r) => (typeof r === 'string' ? r : (r && (r.text || r.label || r.flag)) || '')).filter(Boolean),
    };
  }
  return out;
}

function main() {
  const data = extract(readFileSync(SRC, 'utf8'));
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 1));

  const jobs = Object.keys(data);
  const impacts = jobs.reduce((n, j) => n + data[j].impacts.length, 0);
  const withMoney = jobs.reduce(
    (n, j) => n + data[j].impacts.filter((i) => /\d{2,}/.test(i.impact)).length, 0);
  console.log(`${jobs.length} job types → ${impacts} pricing impacts (${withMoney} carrying real figures)`);
  for (const j of jobs) {
    const d = data[j];
    console.log(`  ${j.padEnd(12)} impacts ${String(d.impacts.length).padStart(2)}  exclusions ${String(d.exclusions.length).padStart(2)}  redFlags ${String(d.redFlags.length).padStart(2)}`);
  }
  console.log(`wrote ${OUT.pathname.split('/').slice(-3).join('/')}`);
}

// Run only when invoked directly. Importing this module — which the test does,
// to compare a fresh extract against the shipped file — must not rewrite the
// very file being checked, or the check compares the output to itself and can
// never fail.
const invoked = process.argv[1] || '';
if (invoked.endsWith('build_coverage_data.mjs')) main();
