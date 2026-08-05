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

## Next (on demand)
- [x] Periodic-service tracker productized into ZEREM — 4th tab "שירות תקופתי" in the
      projects world (shares /api/checkups data with the standalone /checkups/ page).
- [x] Periodic-service v2 (Stav-approved 04/08): email field + mailto draft button,
      "reminders to send" strip (28-day window, one-click WhatsApp/email), and
      client→quote handoff button that opens a prefilled project.
- [ ] Periodic-service v3: bulk "add ALL to calendar"; surface due checkups on the
      projects dashboard too.
- [ ] Ingest full Dekel book into the system catalog (data already local in
      "הקמת תשתית/כתב כמויות" — dekel_clean_perfect.xlsx). Highest-value remaining data work.
- [ ] More adversarial training rounds (periodic — keep grilling the bot, fix the map each time).
- [ ] SUMIT selling point surfaced in provider UI (badge exists; consider onboarding highlight).
- [ ] Providers: live tests with real accounts (Green Invoice/iCount/EZcount/SUMIT).
- [ ] Optional Chrome-Claude crawl: supplier material catalog (e.g. big wholesaler) to seed
      system material prices — only if Stav wants; users can also feed via the scrape tab.

- [x] "Perfect site" compliance pass (04/08): accessibility statement + privacy policy
      pages, footer legal links sitewide, discreet cookie/measurement notice bar with
      Clarity opt-out, branded 404, signup tracking (firstSeen + email-on-new-signup +
      admin counters).
- [ ] bebusy365.com research — blocked by session network policy; needs Stav to allow
      the domain in the environment settings or share screenshots.

## Growth / marketing
- [ ] Share push into electrician WhatsApp groups (Stav sends /ask/ link; OG card ready).
- [ ] "Loved by AIs" expansion: keep llms.txt fresh; consider FAQ page for GEO.
