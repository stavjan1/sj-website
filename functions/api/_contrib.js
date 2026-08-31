// Bonus questions for people who help price-check — and the four ways of
// telling a judgement from a click.
//
// Stav's design, and his own guard-rail, which is the one that matters:
// ANSWERING earns the bonus. Not answering a particular way. The moment "בול"
// is worth more than "ממש לא", the data bends toward whatever pays, and the
// prices bend with it. Every verdict here is worth exactly the same.
//
// ── Why any of this is needed ───────────────────────────────────────────────
//
// Put a prize behind a button and some people will press it without reading.
// Their noise is not neutral: it drags every rate toward 50/50 and hides the
// drift the whole feedback loop exists to catch. So contributions are WEIGHTED,
// never counted flat, and the weight is earned.
//
// ── The four layers, strongest first ────────────────────────────────────────
//
// 1. GOLD. Some of what a contributor grades are jobs Stav has already priced
//    and knows the answer to. Missing those repeatedly is the clearest possible
//    signal, because there is a right answer and it was not given.
//
// 2. SPEED. A verdict in under three seconds is a tap, not an opinion. Nobody
//    reads a job description and forms a view about its price that fast.
//
// 3. SELF-CONSISTENCY. The same job comes back a week later. A person who
//    contradicts himself was not judging either time.
//
// 4. AGREEMENT. Where a strong consensus exists, disagreeing with it every
//    single time is a pattern rather than an opinion.
//
// None of these ever REFUSES the bonus. Stav: someone we decide is noise gets
// "תודה, זה הכל לבינתיים :)" — he keeps what he earned and simply stops being
// counted. Telling somebody he has been graded as unreliable buys nothing and
// teaches him exactly what to fake next time.

const KEY = (id) => `contrib:${id}`;
const KEEP_DAYS = 400;

// Bonus questions per verdict, and the ceiling. Deliberately low: a cap that
// makes gaming not worth the effort is worth more than any detector.
export const BONUS_PER_ANSWER = 2;
export const BONUS_DAILY_CAP = 6;

// Below this a contributor's verdicts stop counting toward the rates. They are
// still stored — a wrong weighting we might revisit is not a reason to destroy
// data — just not counted.
export const TRUST_FLOOR = 0.35;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// The whole scoring rule, kept pure so it can be tested without KV.
//
// Starts at 1 and is only ever spent down. A new contributor is trusted; that
// is the right default when the cost of a wrong vote is one diluted rate and
// the cost of suspicion is a helpful person told he is not welcome.
export function trustScore(rec) {
  const goldSeen = rec.goldSeen || 0;
  const goldOk = rec.goldOk || 0;
  const answers = rec.answers || 0;
  const fast = rec.fast || 0;
  const repeats = rec.repeats || 0;
  const contradictions = rec.contradictions || 0;
  const consensusSeen = rec.consensusSeen || 0;
  const consensusWith = rec.consensusWith || 0;

  let score = 1;

  // 1 — gold. The strongest signal, and the only one with a knowable answer.
  // Needs a few before it says anything: one miss is a bad day.
  if (goldSeen >= 3) {
    const rate = goldOk / goldSeen;
    if (rate < 0.34) score *= 0.15;            // worse than guessing
    else if (rate < 0.6) score *= 0.55;
  }

  // 2 — speed. Occasional quick answers are fine; a habit is not.
  if (answers >= 5) {
    const fastRate = fast / answers;
    if (fastRate > 0.8) score *= 0.25;
    else if (fastRate > 0.5) score *= 0.7;
  }

  // 3 — self-consistency, on jobs he has now seen twice.
  if (repeats >= 2) {
    const agree = 1 - (contradictions / repeats);
    if (agree < 0.5) score *= 0.4;
  }

  // 4 — agreement with a settled crowd. Weakest on purpose: a lone dissenter
  // who is right is exactly the signal worth having, and this must never punish
  // him hard enough to silence it.
  if (consensusSeen >= 6) {
    const agree = consensusWith / consensusSeen;
    if (agree < 0.25) score *= 0.75;
  }

  return clamp01(score);
}

export async function loadContributor(env, id) {
  if (!env || !env.SJ_DATA || !id) return null;
  try { return JSON.parse((await env.SJ_DATA.get(KEY(id))) || 'null'); } catch { return null; }
}

const blank = () => ({
  answers: 0, fast: 0, goldSeen: 0, goldOk: 0,
  repeats: 0, contradictions: 0, consensusSeen: 0, consensusWith: 0,
  bonusToday: 0, bonusDay: '', firstSeen: Date.now(),
});

// One contribution. Returns what the contributor should be told, and nothing
// about how he was judged.
export async function recordContribution(env, id, ev, todayIso) {
  if (!env || !env.SJ_DATA || !id) return { bonus: 0, muted: false };
  const rec = (await loadContributor(env, id)) || blank();

  if (rec.bonusDay !== todayIso) { rec.bonusDay = todayIso; rec.bonusToday = 0; }

  rec.answers += 1;
  if (ev.ms != null && ev.ms < 3000) rec.fast += 1;
  if (ev.gold) { rec.goldSeen += 1; if (ev.goldCorrect) rec.goldOk += 1; }
  if (ev.repeat) { rec.repeats += 1; if (ev.contradicted) rec.contradictions += 1; }
  if (ev.consensus) { rec.consensusSeen += 1; if (ev.withConsensus) rec.consensusWith += 1; }

  const trust = trustScore(rec);
  const muted = trust < TRUST_FLOOR;

  // The bonus is paid for ANSWERING, whatever the answer was and whatever we
  // think of it. Somebody told "no thanks" mid-session would work out why in
  // about a minute, and the next thing he learns is how to look reliable.
  const room = Math.max(0, BONUS_DAILY_CAP - rec.bonusToday);
  const bonus = Math.min(BONUS_PER_ANSWER, room);
  rec.bonusToday += bonus;
  rec.trust = trust;
  rec.lastSeen = Date.now();

  try {
    await env.SJ_DATA.put(KEY(id), JSON.stringify(rec),
      { expirationTtl: 60 * 60 * 24 * KEEP_DAYS });
  } catch { /* never fail a contribution over bookkeeping */ }

  return { bonus, bonusToday: rec.bonusToday, cap: BONUS_DAILY_CAP, muted, trust };
}

// Everyone who has ever contributed, for the admin screen. Ranked by how much
// their verdicts are worth, because that is the question being asked.
export async function listContributors(env, limit = 200) {
  if (!env || !env.SJ_DATA) return [];
  let listed;
  try { listed = await env.SJ_DATA.list({ prefix: 'contrib:', limit }); } catch { return []; }
  const rows = [];
  for (let i = 0; i < listed.keys.length; i += 10) {
    const chunk = listed.keys.slice(i, i + 10);
    const got = await Promise.all(chunk.map((k) => env.SJ_DATA.get(k.name).catch(() => null)));
    chunk.forEach((k, j) => {
      let rec = null;
      try { rec = JSON.parse(got[j] || 'null'); } catch { rec = null; }
      if (!rec) return;
      const trust = trustScore(rec);
      rows.push({
        id: k.name.slice('contrib:'.length),
        answers: rec.answers || 0,
        gold: rec.goldSeen ? Math.round(100 * (rec.goldOk || 0) / rec.goldSeen) : null,
        fastPct: rec.answers ? Math.round(100 * (rec.fast || 0) / rec.answers) : 0,
        contradictions: rec.contradictions || 0,
        trust: Number(trust.toFixed(2)),
        counted: trust >= TRUST_FLOOR,
        firstSeen: rec.firstSeen || null,
        lastSeen: rec.lastSeen || null,
      });
    });
  }
  rows.sort((a, b) => (b.answers - a.answers));
  return rows;
}
