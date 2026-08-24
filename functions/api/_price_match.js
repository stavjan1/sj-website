// Putting a catalogue price on an item the model named — but only when we are
// sure it is the same item.
//
// Stav's design: stop trying to guess, before the model has decided anything,
// which products a job will need. Let the model name them, then price them
// here. It is the right shape, and it removes the failure recorded in the
// evaluation notes on 22.8: the model wrote "כבל 5x6" and priced it from memory
// at 28 ₪/מ' while the catalogue held it at 17.54, because retrieval had run
// before there was anything to retrieve FOR.
//
// ── The trap, measured before writing a line of this ────────────────────────
//
// searchMaterials always returns something. It has no way to say "not found",
// and its top hit is confidently wrong often enough to matter:
//
//     "מפסק פקט 40A"       → מפסק פקט 3X25 מוגן פיצוץ + מגע עזר   1,705 ₪
//     "גוף תאורה שקוע בגבס" → גוף תאורה היקפית 4000lm AC/DC        1,355 ₪
//
// Two of nine, each wrong by more than ten times. Substituting the top hit
// blindly would put 1,705 ₪ for a pakat into a customer's quote, and Stav would
// find out standing in front of him.
//
// So the rule here is not "closest match". It is TOTAL match: every meaningful
// word of the requested name has to be present in the item. "40A" missing means
// this is not the pakat that was asked for, however well the rest scores. When
// nothing passes, the model's own estimate stands and is marked as an estimate
// — which is the distinction the whole product is built around.

import { loadMaterials, searchMaterials, norm } from './_materials.js';

// Words that carry no identity: they narrow nothing and would fail a match for
// no reason. Kept deliberately short — being too generous here re-opens the
// 1,705 ₪ hole.
const FILLER = new Set([
  'של', 'עם', 'על', 'את', 'או', 'גם', 'רק', 'לפי', 'עד', 'ל', 'ב', 'ה',
  'מטר', 'מטרים', 'יחידה', 'יחידות', 'יח', 'מ', 'ומעלה', 'כולל', 'בערך',
  'חדש', 'חדשה', 'רגיל', 'רגילה', 'סטנדרטי', 'סטנדרטית', 'איכותי',
]);

// The words that have to be there. A token with a digit is a rating or a size
// and is never optional — it IS the difference between the item and its
// neighbour on the shelf.
export function identityTokens(name) {
  return norm(name).split(' ')
    .filter((w) => w && !FILLER.has(w))
    .filter((w) => /\d/.test(w) || w.length >= 3);
}

// Does this item satisfy every one of them?
//
// Two rules, both learned from the first measurement rather than guessed:
//
//  1. A NUMBER MUST APPEAR IN THE NAME. Matching it anywhere in the record let
//     "נעל כבל 16" take a 10 ממ"ר lug and "דיבל 8" take a 6 מ"מ plug, because
//     the size that satisfied the check was sitting in an attribute or a part
//     number rather than in what the product is called. A rating is the whole
//     difference between two items on the same shelf; it has to be in the name.
//
//  2. THE HEAD NOUN MUST BE THE ITEM'S HEAD NOUN. Hebrew puts it first, and
//     without this "פנל לד 60x60" matched a FRAME for converting a recessed
//     panel, and "ברגים 4x40" matched a 4x40x200 busbar that merely mentions
//     screws. Both contained every word asked for. Neither was the product.
function totalMatch(item, needed, head) {
  if (!needed.length) return false;          // nothing asked → nothing proven
  const nameOnly = item.hay;                 // name + attrs, normalised
  const justName = norm(item.name);

  // The head noun has to be the item's head noun, not merely a word appearing
  // somewhere inside it. Hebrew puts the noun first, so position IS the test:
  // "פס השוואה 4x40x200 כ-7 ברגים" contains "ברגים" and is a busbar;
  // "מסגרת לבנה 60x60 להפיכת פנל שקוע" contains "פנל" and is a frame;
  // "מתאם סיסטם 1 מודול להתקנה על פס דין" contains "פס" and is an adapter.
  // All three passed a presence check and none of them is the product asked
  // for. Requiring the head in the opening words rejects all three.
  if (head) {
    const opening = justName.split(' ').slice(0, 3).join(' ');
    if (!opening.includes(head)) return false;
  }
  return needed.every((w) => (/\d/.test(w) ? justName.includes(w)
                                           : (item.toks.has(w) || nameOnly.includes(w))));
}

// The price, or nothing. Never a guess wearing a catalogue's clothes.
export function confidentMatch(db, requestedName, depth = 6) {
  const needed = identityTokens(requestedName);
  if (!needed.length) return null;
  // Walk DOWN the ranking rather than judging only the winner: the exact item
  // is often the second or third hit, sitting behind a bigger, better-scoring
  // cousin. Rejecting the top hit and stopping would throw away a real match.
  // The head noun: what the thing IS, before any of its measurements.
  const head = needed.find((w) => !/\d/.test(w)) || '';
  for (const it of searchMaterials(db, requestedName, depth)) {
    if (totalMatch(it, needed, head)) {
      return { sku: it.sku, name: it.name, price: it.price, unit: it.unit, cat: it.cat };
    }
  }
  return null;
}

// The whole bill of quantities at once: each line either gets a catalogue price
// and a part number, or is left exactly as the model wrote it and flagged as an
// estimate.
export async function priceBom(request, lines) {
  const db = await loadMaterials(request);
  if (!db.items.length) return lines.map((l) => ({ ...l, matched: false }));
  return lines.map((l) => {
    const hit = confidentMatch(db, l.name || '');
    return hit
      ? { ...l, matched: true, price: hit.price, unit: hit.unit, sku: hit.sku, catalogName: hit.name }
      : { ...l, matched: false };
  });
}
