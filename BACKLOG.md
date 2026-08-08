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

## Security review round 2 (08/08) — full audit, server + client
Triggered by Stav asking about Strix (autonomous pentest agent). Strix could not
run here (no LLM key in the environment, live site unreachable through the proxy),
so the equivalent was done against the source, which we own — 3 parallel deep
audits: public share viewer, client XSS sinks, remaining API endpoints.
Fixed & pushed:
- [x] 🔴 **Stored XSS in /q/ (the public quote link)** — `safeImg()` was anchored
      only at the start, so `data:image/gif;base64,<valid>" onload="..." x="`
      passed through verbatim into `src="..."`. Verified exploitable end-to-end:
      any signed-in user → arbitrary JS on sj-eng.co.il in the customer's (or
      Stav's) browser, with access to localStorage (Google token, all business
      data). Fixed: full-string base64 match + escaped at the sink.
- [x] 🔴 **Stored XSS via AI material list** — model output (name/details/price)
      went raw into innerHTML and is persisted to the cloud; reachable by prompt
      injection through a scraped supplier catalog name. Escaped + clamped.
- [x] 🟠 `escapeHtml` didn't escape quotes while being used inside quoted
      attributes in 6 places (latent breakout). Now escapes quotes.
- [x] 🟠 blindSpots list + Google Drive folder names (third-party data) escaped.
- [x] 🟠 **Token audience never checked** for opaque access tokens — a token
      minted for ANY other Google OAuth app was accepted, including at the admin
      gates. Now verified via tokeninfo with an `aud` check.
- [x] 🟠 catalog.js carried its own weaker copy of the auth check → imports the
      shared hardened one (also fixes: FedCM-signed admin couldn't publish).
- [x] 🟠 /api/assistant let anyone pick the paid advanced model on our key.
- [x] 🟠 /api/quote-share: no server-side validation and no plan enforcement.
- [x] 🟡 /api/pdf monthly quota bypass via a constant client-supplied quoteId.
- [x] 🟡 /api/stats: free-text profession minted unbounded KV buckets (would
      eventually break the admin dashboard); rate limit moved before auth call.
- [x] 🟢 **CSP now ENFORCING** — verified by Claude in a real Chromium, not by eye:
      all 8 page types load with zero violations; every destination the client
      actually calls (web3forms contact forms, Drive, direct Gemini, tokeninfo,
      GIS, Clarity) confirmed allowed; an attacker domain confirmed BLOCKED; a
      blob: Worker confirmed allowed for the PDF exporter. The page-load test
      alone said "clean" while `api.web3forms.com` was still missing from
      connect-src — the runtime test is what caught it. Repeatable:
      `scripts/security/` (see its README). Run after adding any 3rd-party call.
- [ ] 🟢 /api/stats dedup key `stats:seen:<quoteId>` is a global namespace, so a
      crafted id can suppress someone else's sample. Anonymous aggregate data
      only, display still off — low impact, worth namespacing when stats go live.
- [ ] 🟢 Run Strix against the LIVE site from a machine with network access (it
      catches deploy/config issues a code audit cannot). Needs Docker + an LLM key.

## Security review round 1 (08/08) — code audit of the server layer
Fixed & pushed this cycle:
- [x] SSRF-via-redirect in /api/scrape: fetch followed redirects past the SSRF
      allowlist → now manual-follow, re-validating each hop.
- [x] web3forms key was hardcoded in a PUBLIC repo (lead.js, share-catalog.js) →
      reads env WEB3FORMS_KEY with fallback.
- [x] /api/quote-share public GET leaked the owner's Google email → stripped.
- [x] Security headers added (nosniff, X-Frame-Options, Referrer-Policy, HSTS,
      Permissions-Policy).
Stav's actions / decisions:
- [ ] 🔴 **Rotate the web3forms key** and set it as WEB3FORMS_KEY env var in
      Cloudflare (the old one is public in git history — rotation kills it).
- [ ] 🟠 /api/lead email abuse: once RESEND_API_KEY is on, the endpoint can send
      SJ-branded mail to an attacker-chosen address (rate-limited 3/min). Before
      enabling Resend — decide on a guard (confirm-link / tighter limit).
- [ ] 🟢 Content-Security-Policy: add after testing against inline scripts + GIS +
      html2pdf CDN + Gemini (deferred — would break the app if added blind).
- [ ] 🟢 Optional: run Strix (external black-box pentest) against the LIVE site
      from a session with open network — complements the code audit above.
Reviewed and found solid: Google token verification (audience-checked), admin
gating (server-side ADMIN_EMAIL on every admin endpoint), per-user KV keying
(no IDOR — keys derive from the verified email), invoicing credentials
(per-user, never returned to client), rate limiting on public AI endpoints.

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
- [ ] More adversarial training rounds — waiting for Stav's time: he feeds real examples,
      we check the model's guesses, fix the map each round.
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

## Tech debt
- [ ] 🟢 checkups: extract the duplicated periodic-service core (dates/ICS/calendar/
      import) shared by /checkups/app.js and sale/app.js into one file (found in the
      pre-deploy review 08/08; both copies fixed identically for now).
