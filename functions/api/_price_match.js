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
function totalMatch(item, needed, heads) {
  if (!needed.length) return false;          // nothing asked → nothing proven
  const justName = norm(item.name);
  const nameToks = new Set(justName.split(' '));

  // 1 — the head noun has to BE the item's head noun, not a word appearing
  // somewhere inside it. Hebrew puts it first, so position is the test:
  //   "פס השוואה 4x40x200 כ-7 ברגים"       contains "ברגים" and is a busbar;
  //   "מסגרת לבנה 60x60 להפיכת פנל שקוע"    contains "פנל"  and is a frame;
  //   "אינטרלוק עהט פס דין IP66"            contains "פס"   and costs 616 ₪.
  // Two words wide, because a catalogue name is usually the thing plus one
  // qualifier ("פקט בקופסא", "צינור מרירון"), and either of the user's first
  // two words may be the one that leads — the trade and the catalogue disagree
  // about that ("מפסק פקט" vs "פקט בקופסא").
  if (heads.length) {
    const opening = justName.split(' ').slice(0, 2);
    if (!heads.some((h) => opening.some((w) => w === h || w.endsWith(h)))) return false;
  }

  // 2 — and then EVERY word has to be there, heads included.
  //
  // This was relaxed once, to let "מפסק פקט 40A" find a product ARCA files as
  // "פקט בקופסא". Coverage went from 36% to 50% and precision fell out the
  // bottom: "מפסק פקט 40A" took a 298 ₪ moulded-case breaker whose only claim
  // was "מפסק", and "מונה חשמל חד פאזי" took a THREE-phase meter. Five wrong
  // prices bought six right ones. Put back, and it stays back — a missed price
  // costs nothing and a wrong one costs a customer.
  //
  // Ratings go against the NAME, because matching one anywhere in the record
  // let "נעל כבל 16" take a 10 ממ"ר lug on a size sitting in an attribute.
  // Words are whole tokens, never substrings: "פקט" is inside "אימפקט", and
  // the catalogue holds ninety-seven impact drivers.
  return needed.every((w) => (
    /\d/.test(w) ? justName.includes(w) : (nameToks.has(w) || item.toks.has(w))
  ));
}

// The price, or nothing. Never a guess wearing a catalogue's clothes.
export function confidentMatch(db, requestedName, depth = 6) {
  const needed = identityTokens(requestedName);
  if (!needed.length) return null;
  // Walk DOWN the ranking rather than judging only the winner: the exact item
  // is often the second or third hit, sitting behind a bigger, better-scoring
  // cousin. Rejecting the top hit and stopping would throw away a real match.
  // The head noun: what the thing IS, before any of its measurements.
  // Either of the first two words the user typed may be the head: the trade and
  // the catalogue do not agree on which one leads. Stav writes "מפסק פקט 40A";
  // ARCA files it as "פקט בקופסא 3X40A".
  const heads = needed.filter((w) => !/\d/.test(w)).slice(0, 2);
  for (const it of searchMaterials(db, requestedName, depth)) {
    if (totalMatch(it, needed, heads)) {
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
