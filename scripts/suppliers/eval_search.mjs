// Qualitative eyeball of what the pricing agent will actually receive.
// Not a pass/fail guard (tests/materials.test.mjs is) — this is the thing you
// read when you want to know whether the top hits are the RIGHT items, which no
// assertion can tell you.
//
//   node scripts/suppliers/eval_search.mjs            # the standard query set
//   node scripts/suppliers/eval_search.mjs "כבל 5x6"  # one ad-hoc query
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hydrate, searchMaterials } from '../../functions/api/_materials.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = hydrate(JSON.parse(readFileSync(join(ROOT, 'data/materials/index.json'), 'utf8')));

const QUERIES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'כבל N2XY 5x6 לעמדת טעינה',
  'החלפת לוח דירתי 12 מקום עם פחת',
  'מא"ז 3x25 אמפר',
  'ממסר פחת 4x40 30mA',
  'צינור שרשורי 25 מ"מ',
  'קופסת חיבורים CI 4 מודול',
  'אלקטרודת הארקה + שוחה',
  'שקע כוח תלת פאזי 16A',
  'גוף תאורה LED שקוע 20W',
  'תעלת רשת 100 מ"מ',
  'מהדק שורה 4 ממ"ר',
  'נעל כבל 16 ממ"ר',
  'מולטימטר',
  'פס צבירה לוח חשמל',
];

console.log(`db: ${db.items.length} items, ${db.cats.length} categories\n`);
for (const q of QUERIES) {
  const hits = searchMaterials(db, q, 6);
  console.log(`── ${q}  →  ${hits.length} hits`);
  for (const h of hits) {
    console.log(`   ${String(h.price).padStart(8)} ₪/${h.unit.padEnd(5)} ${h.name.slice(0, 58).padEnd(58)} ${h.cat.slice(0, 40)}`);
  }
  if (!hits.length) console.log('   (nothing — this query would send no catalog block)');
  console.log();
}
