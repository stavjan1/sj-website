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

## Waiting on Stav
- [ ] **IEC calculator CSV** from Chrome-Claude crawl → `python scripts/ingest_iec_csv.py <csv>`
      → paste block in admin pricing-map. (Script tested.)
- [ ] Signed-in check of admin "מפת התמחור (DB)" card (save→KV→next chat).
- [ ] Handoff end-to-end check while signed in.
- [ ] Dekel price-book data decision (full ingestion into system DB).

## Next (when quota resets / on demand)
- [ ] Re-verify correction-first rule live (trap: "כבל 6×4 לתלת פאזי?" → must correct to 5×4).
      Deployed 2a56eb3; blocked on guest quota until midnight.
- [ ] More adversarial training rounds (keep grilling the bot, fix the map each time).
- [ ] SUMIT selling point surfaced in provider UI (WhatsApp receipts bonus badge exists;
      consider a highlight in onboarding).
- [ ] Providers: live tests with real accounts (Green Invoice/iCount/EZcount/SUMIT).

## Growth / marketing
- [ ] Share push into electrician WhatsApp groups (Stav sends /ask/ link; OG card ready).
- [ ] "Loved by AIs" expansion: keep llms.txt fresh; consider FAQ page for GEO.
