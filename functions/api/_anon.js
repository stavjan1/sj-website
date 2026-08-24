// Cloudflare Pages Function helper — counting the visitors who never sign in.
//
// The funnel only ever saw people with an account, because it reads `user:*`
// blobs and a guest does not have one. So the busiest half of a launch day —
// everyone who tapped a WhatsApp link, asked one question and left — was
// invisible in the one screen meant to show who uses the product.
//
// ── The question Stav actually asked ────────────────────────────────────────
//
//   "איך תוודא שאם מישהו נכנס אז אחרי חודש פתאום זה לא יציג אותו כאנונימי 3
//    במקום המספר שהוא כבר היה?"
//
// A number taken from a position in a list cannot survive that: anyone new
// appearing earlier in the sort pushes everybody else along. So the number is
// not a position. It is the RANK BY FIRST SIGHTING, and first sighting is
// written once and never touched again — which makes the rank of an existing
// visitor mathematically unable to change, because a new visitor's first
// sighting is always later than everyone already counted.
//
// That also removes any need for a shared counter, and with it the race two
// visitors arriving in the same second would otherwise have: no atomic
// increment, no lock, no chance of two people being handed number 6. Ties on
// the same millisecond break on the id, so the order is total and deterministic.
//
// ── What is stored, and what is deliberately not ────────────────────────────
//
// A random id the browser made up about itself, plus counters. No IP address,
// no user agent, nothing that identifies a person, and nothing that survives
// clearing the browser. It exists to answer "how many different people tried
// this, and did any of them come back" — and it cannot answer anything else.

const ANON_PREFIX = 'anon:';
const ANON_TTL_DAYS = 400;

// An id we are willing to store: the shape our own client generates, and
// nothing else. It arrives in a header from an unauthenticated caller, so it
// gets the same suspicion as any other user input — an unbounded string here
// would be an unbounded KV key.
export function cleanAnonId(raw) {
  const s = String(raw || '').trim();
  return /^[a-z0-9]{12,32}$/.test(s) ? s : '';
}

// Called on a guest's AI request. Best-effort throughout: this is bookkeeping,
// and bookkeeping must never be the reason somebody's question failed.
export async function noteAnonVisit(env, anonId) {
  const id = cleanAnonId(anonId);
  if (!id || !env || !env.SJ_DATA) return;
  const key = ANON_PREFIX + id;
  try {
    const now = Date.now();
    let rec = null;
    try { rec = JSON.parse((await env.SJ_DATA.get(key)) || 'null'); } catch { rec = null; }
    // firstSeen is written exactly once. Everything about the numbering rests
    // on that, so it is never recomputed, never refreshed, never "corrected".
    const next = rec && rec.firstSeen
      ? { ...rec, lastSeen: now, msgs: (rec.msgs || 0) + 1 }
      : { firstSeen: now, lastSeen: now, msgs: 1 };
    await env.SJ_DATA.put(key, JSON.stringify(next),
      { expirationTtl: 60 * 60 * 24 * ANON_TTL_DAYS });
  } catch { /* never fail a request over a counter */ }
}

// Read them back, numbered. The caller gets them already sorted, so the label
// and the order agree.
export async function listAnonVisitors(env, limit) {
  if (!env || !env.SJ_DATA) return { visitors: [], capped: false };
  let listed;
  try { listed = await env.SJ_DATA.list({ prefix: ANON_PREFIX, limit: limit || 200 }); }
  catch { return { visitors: [], capped: false }; }

  const rows = [];
  for (let i = 0; i < listed.keys.length; i += 10) {
    const chunk = listed.keys.slice(i, i + 10);
    const got = await Promise.all(chunk.map((k) => env.SJ_DATA.get(k.name).catch(() => null)));
    chunk.forEach((k, j) => {
      let rec = null;
      try { rec = JSON.parse(got[j] || 'null'); } catch { rec = null; }
      if (rec && rec.firstSeen) rows.push({ id: k.name.slice(ANON_PREFIX.length), ...rec });
    });
  }

  // The whole guarantee, in one line: ordered by when each was first seen, with
  // the id breaking a tie so the order is total. Anyone new sorts last, so no
  // existing visitor's number can move.
  rows.sort((a, b) => (a.firstSeen - b.firstSeen) || (a.id < b.id ? -1 : 1));
  rows.forEach((r, i) => { r.n = i + 1; r.label = 'אנונימי ' + (i + 1); });

  return { visitors: rows, capped: listed.list_complete === false };
}
