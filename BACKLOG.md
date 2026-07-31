# ZEREM — Backlog (toward "finished product" + growth)

Goal: a wildly-accessible viral pricing platform for electricians. Instant no-signup
pricing chat pulls people in → full ZEREM (projects, quotes, invoicing) retains them.

## Done this cycle (night 23-24/07)
- [x] `/ask/` — no-signup pricing chat LIVE: dedicated OG card, session continuity (24h),
      price chip, live thinking indicator, theme modes (night/dim/day), guest-quota note,
      case-tolerant /ASK redirect, mobile-solid.
- [x] **Two-phase pricing UX**: Gemini picks 2-4 smart clarifying questions per job →
      tappable CHIPS (+free text) → ONE final price (±10%). Live-verified.
- [x] **Length slider**: site-owned tiered formula (base + tiered ₪/m, clamped, anchored to
      the quoted price); AI only fills numbers. Live-verified.
- [x] **Pricing knowledge map** (functions/api/_pricing_map.js): injected server-side into every
      chat; KV `pricing:map` overrides via admin card "מפת התמחור (DB)" — no deploy.
      Contains: WhatsApp field anchors (both groups), panel-replacement formula, EV scenarios,
      hard cable rules (3×/5×; 6+ cores = control only; EV=3ph default), tiered ₪/m.
- [x] Adversarial training round 1: 5 traps → 2 fails → correct-mistakes-first rule shipped.
- [x] Chat→project handoff (/ask/ → banner in /sale/ → prefilled project).
- [x] Truncation bug class killed everywhere (thinkingBudget); /api/assistant rate-limited.
- [x] Launch-gate: GO (secrets ✅, hardening ✅, de-slop ✅, GEO ✅ incl. llms.txt).

## Verified complete (Stav-tested 25/07: "עובד מדהים")
- [x] IEC calculator DB: 786-combo crawl → data/iec_full.json + digest in DEFAULT_PRICING_MAP.
      Live-verified: exact fee quoted (3X25→3X80 = 8,459₪), separated from labor.
- [x] Correction-first rule live-verified (6×4 trap → "כבל פיקוד, צריך 5×4" before questions).
- [x] All 5 training traps pass. Admin pricing-map card, handoff, chips+slider — Stav-approved.

## Built this cycle (31/07) — /ask/ as the platform's compact face  🟡 awaiting Stav's live check
- [x] **Equipment & tools list bubbles**: "🧰 רשימת ציוד וכלים" button after every price →
      two designed checklist cards (ציוד וחומרים + ארגז כלים) with tappable shopping-list rows,
      per-item notes ("5 מהדקי שוקולד בפנים"), qty badges, copy + WhatsApp share.
      Shared component assets/listcards.js, themed per host.
- [x] **Account connection on /ask/** (Stav: "גם וגם — פלטפורמה מצומצמת"): Google sign-in in the
      header, plan-aware daily quota (server counts per-account), and a same-origin bridge that
      reuses the full app's token — signed into ZEREM = signed into /ask/.
- [x] **Quick ⇄ full toggle both ways**: segmented switch in /ask/, "⚡ מצב מהיר" pill in the app
      topnav, no-signup chat link on the lock screen. v5.28, SW shell v59, cache headers set.
- [x] App chat renders [[רשימות]] with the same shared cards (instead of stripping).
- [ ] Next on this thread: let the app's planning agent EMIT [[רשימות]] too (button in project
      chat) — kept out of this round so the pricing agent's JSON protocol stays untouched.

## Future vision (recorded verbatim, 31/07)
- [ ] **Field simulation button**: a button that generates a simulation of how the job looks in
      the field — how the route runs, like a תוכנית חד קווית; next to each segment: which conduit
      it is and which cable passes inside it; junction boxes annotated with contents,
      e.g. "5 מהדקי שוקולד בפנים".

## Next (on demand)
- [ ] Ingest full Dekel book into the system catalog (data already local in
      "הקמת תשתית/כתב כמויות" — dekel_clean_perfect.xlsx). Highest-value remaining data work.
- [ ] More adversarial training rounds — waiting for Stav's time: he feeds real examples,
      we check the model's guesses, fix the map each round.
- [ ] SUMIT selling point surfaced in provider UI (badge exists; consider onboarding highlight).
- [ ] Providers: live tests with real accounts (Green Invoice/iCount/EZcount/SUMIT).
- [ ] Optional Chrome-Claude crawl: supplier material catalog (e.g. big wholesaler) to seed
      system material prices — only if Stav wants; users can also feed via the scrape tab.

## Growth / marketing
- [ ] Share push into electrician WhatsApp groups (Stav sends /ask/ link; OG card ready).
- [ ] "Loved by AIs" expansion: keep llms.txt fresh; consider FAQ page for GEO.
