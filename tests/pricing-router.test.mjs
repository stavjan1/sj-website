// The pricing map is routed by topic now, which means the map can be RIGHT and
// the answer still wrong — because the block holding the number never reached
// the model. Nothing on screen shows that; the reply just quietly gets worse.
//
// So these tests assert the property that matters: for a real question, the
// blocks that answer it survive the trim. A lexicon edit that starves one of
// them fails here instead of in front of a customer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICING_MAP as MAP, trimPricingMap, isTrivialTurn, __router } from '../functions/api/_pricing_map.js';

// question -> the headings whose content the answer genuinely needs.
const CASES = [
  ['כמה עולה להחליף לוח דירתי של 24 מקום', ['## החלפת לוח דירתי', '### לוחות, סולם שלם', '### לוח גדול']],
  ['כמה לוקחים על להזיז נקודה במטבח', ['### הצעה אמיתית שהוגשה ללקוח', '### חציבה, המספר שנאמר']],
  ['מה המחיר להתקנת 20 ספוטים בגבס', ['### תאורה, מחירון לפי סוג הגוף', '### התקנת גופי תאורה']],
  ['עמדת טעינה לרכב חשמלי כמה זה יוצא', ['## עמדת טעינה לרכב', '### עמדת טעינה · עסקה מלאה', '### עמדת טעינה תלת-פאזית']],
  ['כמה עולה הגדלת חיבור מ3x25 ל3x40', ['## אגרות חברת החשמל', '### הגדלת חיבור · מגורים']],
  ['איתור תקלה בבית פרטי כמה לקחת', ['### תקלה: מתמחרים את האיתור', '### סתירה שצריך לדעת עליה']],
  ['מחיר לאביזר, שקע רגיל', ['### אביזרים: המחיר לאביזר', '### אביזרים ורכיבים']],
  ['כמה עולה בדיקת מתקן של חשמלאי בודק', ['### בדיקת מתקן: מיפוי מעגלים', '### חשמלאי בודק']],
  ['הארקה, אין לי מקור, מה עושים', ['### איתור מקור הארקה', '### הארקה: צנרת המים']],
  ['קו הזנה 3x240 נחושת על סולם כבלים, 40 מטר', ['### קו הזנה כבד על סולם כבלים']],
  ['החלפת בקר בתעשייה במפעל', ['### החלפת בקר בתעשייה']],
];

test('a real question keeps the blocks that answer it', () => {
  const missing = [];
  for (const [q, needs] of CASES) {
    const out = trimPricingMap(MAP, q);
    for (const need of needs) if (!out.includes(need)) missing.push(`"${q}" lost ${need}`);
  }
  assert.deepEqual(missing, [], 'the router withheld a block the answer needed');
});

test('the universal blocks reach every routed turn', () => {
  const missing = [];
  for (const [q] of CASES) {
    const out = trimPricingMap(MAP, q);
    for (const u of __router.ALWAYS_KEEP) {
      if (!out.includes(u)) missing.push(`"${q}" lost ${u}`);
    }
  }
  assert.deepEqual(missing, [], 'a block in ALWAYS_KEEP did not reach a routed turn');
});

test('a turn the router does not understand gets the whole map', () => {
  // The only safe default. If we could not tell what the question was about, we
  // have no basis whatsoever for deciding what the answer may not see.
  // Note "מה דעתך על ההצעה הזאת" is NOT in this list: "הצעה" is a real project
  // trigger, so that turn routes rather than falling through. It reaches the
  // right blocks anyway, because chat.js routes on the last four user turns and
  // the offer being discussed is in one of them.
  for (const q of ['כמה זה עולה', 'תן לי מחיר', 'תסביר לי בבקשה']) {
    assert.equal(trimPricingMap(MAP, q), MAP, `"${q}" should have received the whole map`);
  }
});

test('a kept subsection keeps its parent section heading', () => {
  // A "## " heading is the provenance of everything under it — which group, when,
  // and in one case that these numbers OVERRIDE the conflicting ones above. A
  // child without its parent is a number with no standing.
  const out = trimPricingMap(MAP, 'כמה עולה חציבה למטר');
  assert.ok(out.includes('### חציבה: המחיר למטר'), 'precondition: the chiselling block is kept');
  assert.ok(out.includes('## תיקוני שטח מסתיו'),
    'kept a subsection but dropped the parent that says these numbers override the ones above');
});

test('an unlabelled block is kept rather than lost', () => {
  // The failure direction has to be "too much context", never "the number you
  // needed was withheld". A block matching no topic at all goes on every turn.
  // The heading has to be genuinely neutral. The first version of this test used
  // "בלוק חדש" and failed — because "בלוק" is a chiselling stem (a concrete
  // block), so the supposedly-unlabelled block was labelled after all. The test
  // was wrong, not the router.
  const orphan = '\n### פסקה ללא סיווג\nמשהו שאין בו אף מילת מפתח מוכרת.\n';
  const out = trimPricingMap(MAP + orphan, 'הארקה');
  assert.ok(out.includes('פסקה ללא סיווג'),
    'a block the lexicon cannot label must still be sent — otherwise adding to the map silently loses it');
});

test('routing actually saves something', () => {
  // Without this the tests above are all satisfiable by returning the whole map.
  const narrow = trimPricingMap(MAP, 'החלפת בקר בתעשייה במפעל');
  assert.ok(narrow.length < MAP.length * 0.6,
    `a single narrow topic should drop most of the map, kept ${Math.round(100 * narrow.length / MAP.length)}%`);
});

test('a greeting still gets no map at all, and a real question still does', () => {
  assert.equal(isTrivialTurn('תודה רבה'), true);
  assert.equal(isTrivialTurn('שלום'), true);
  assert.equal(isTrivialTurn('כמה זה עולה'), false, 'this is a real question and must not be treated as a greeting');
  assert.equal(isTrivialTurn('לוח 24 מקום'), false);
});

test('every topic in the lexicon can actually be activated', () => {
  // A topic whose stems never fire is dead weight that reads as coverage.
  const dead = [];
  for (const [topic, words] of Object.entries(__router.TOPIC_WORDS)) {
    if (!words.length) { dead.push(topic); continue; }
    const hit = __router.topicsIn(words[0]);
    if (!hit.has(topic)) dead.push(topic);
  }
  assert.deepEqual(dead, [], 'these topics cannot be activated by their own trigger words');
});
