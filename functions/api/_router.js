// Sending only the part of the knowledge that this question can use.
//
// Stav's idea, and it is the right one: "לחלק את כל המאגרים להרבה קבוצות
// קטנות ולפי השאלה המודל ידע להחזיר איזה קבוצות למשוך."
//
// He offered two shapes. One is a round trip — ask the model which sections it
// wants, then ask again with them. That doubles the latency and, worse, spends
// tokens to decide how to spend tokens. The other is to work it out here,
// before the call. That is what this does: the question is matched against the
// section headings and bodies with the same Hebrew normaliser the catalogue
// search already uses, and only the sections that share real vocabulary with
// the question travel.
//
// No extra model call, no extra second, nothing to go wrong at request time —
// and being ordinary code, it can be tested, which a prompt cannot.
//
// The whole design rests on one asymmetry: a section wrongly SENT costs tokens,
// a section wrongly WITHHELD costs a wrong price. So the defaults lean heavily
// towards sending — always-on sections ride on every request regardless of
// score, the bar for the rest is low, and a question that matches nothing gets
// everything rather than nothing.

import { norm } from './_materials.js';

// Words too common across a knowledge block to tell sections apart. The
// catalogue search has its own list for queries; this one is about the blocks.
const NOISE = new Set([
  'של', 'עם', 'על', 'את', 'זה', 'מה', 'כמה', 'יש', 'לא', 'או', 'גם', 'רק',
  'לפני', 'אחרי', 'כולל', 'ללא', 'בלי', 'לכל', 'לפי', 'עד', 'בין', 'אם',
  'מחיר', 'מחירים', 'עבודה', 'ש', 'הוא', 'היא', 'הם', 'זו', 'אל', 'כך',
  'תמיד', 'לעולם', 'צריך', 'אפשר', 'למשל', 'כמו', 'יותר', 'פחות', 'הזה',
]);

function tokens(text) {
  return new Set(
    norm(text).split(' ').filter((w) => w.length >= 2 && !NOISE.has(w)));
}

// Split a markdown knowledge block into its `## ` sections, keeping whatever
// preamble sits above the first heading attached to the front.
export function splitSections(block) {
  const text = String(block || '');
  const parts = text.split(/\n(?=## )/);
  return parts.map((body) => {
    const head = (body.split('\n', 1)[0] || '').replace(/^#+\s*/, '').trim();
    return { head, body };
  });
}

// How much of the question this section actually speaks to.
//
// Rarity-weighted on purpose: a word that appears in every section says nothing
// about which section to pick, and without this the longest section wins every
// question simply by containing more words.
function scoreSections(sections, queryTokens) {
  const spread = new Map();
  const secTokens = sections.map((s) => {
    const t = tokens(s.body);
    for (const w of t) spread.set(w, (spread.get(w) || 0) + 1);
    return t;
  });
  const n = sections.length || 1;
  return sections.map((s, i) => {
    let score = 0;
    for (const q of queryTokens) {
      if (!secTokens[i].has(q)) continue;
      // A term in one section out of ten is worth far more than one in nine.
      score += Math.log(1 + n / (spread.get(q) || 1));
      // The heading is the section's own summary of itself.
      if (tokens(s.head).has(q)) score += 1.5;
    }
    return { ...s, score };
  });
}

// Pick the sections worth sending.
//
//   alwaysOn  — regexes for headings that ride on every request, whatever the
//               question. Universal rules and Stav's own corrections live here:
//               being wrong about those is not a token problem.
//   minScore  — deliberately low. See the asymmetry at the top of this file.
//   maxChars  — a ceiling, applied after ranking, so one enormous section
//               cannot eat the budget on its own.
export function routeKnowledge(block, question, opts = {}) {
  const { alwaysOn = [], minScore = 1.0, maxChars = Infinity, minSections = 1 } = opts;
  const sections = splitSections(block);
  if (sections.length <= 1) return String(block || '');

  const q = tokens(question);
  if (!q.size) return String(block || '');       // nothing to route on → send it all

  const isAlways = (s) => alwaysOn.some((rx) => rx.test(s.head));
  const scored = scoreSections(sections, q);

  const always = scored.filter(isAlways);
  const rest = scored.filter((s) => !isAlways(s))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // A question that matched nothing gets everything. Guessing wrong in the
  // other direction means answering a real question from a fraction of what we
  // know, which is the one outcome worse than a large prompt.
  if (!rest.length && always.length < minSections) return String(block || '');

  const kept = [];
  let used = 0;
  for (const s of [...always, ...rest]) {
    if (used + s.body.length > maxChars && kept.length) break;
    kept.push(s);
    used += s.body.length;
  }
  // Back into the original order, so the block still reads like a document.
  const order = new Map(sections.map((s, i) => [s.body, i]));
  kept.sort((a, b) => order.get(a.body) - order.get(b.body));
  return kept.map((s) => s.body).join('\n');
}
