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
- [x] 🔴 **Proven end-to-end in a real browser** (`scripts/security/xss-quote-viewer-e2e.js`):
      the exploit fires on the old code (title becomes "PWNED") and is dead on the
      shipped code, while a legitimate logo + signature still render. Committed as
      a permanent regression test so the hole cannot quietly come back.
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
- [x] ~~🔴 Rotate the web3forms key~~ — **withdrawn 15/08/2026, it was never a
      leak.** A web3forms access key is public by design: the contact forms carry
      it in a hidden input, so every visitor can already read it in the page
      source, and the free plan only accepts client-side submissions. What a
      public key costs is form spam, and the fix for that is web3forms' own
      captcha/domain settings — not rotation. Rotating it is in fact the risky
      move: the key lives in five places (two Functions plus three static forms
      that never reach a Function), so a partial rotation loses leads silently.
      A test now pins all five together. This line sat here as a 🔴 long after
      the audit that cleared it, and got re-reported as an open security hole.
- [x] 🟠 /api/lead email abuse — **guarded 22/08/2026.** Per-minute-per-IP was
      never the answer (a botnet sending one each is under it); what bounds the
      damage is how many times ONE address can be mailed and how many can go out
      at all. Both are daily KV counters checked *before* the model call, so a
      flood costs no tokens either: 2 per address per day, 60 per day total. The
      endpoint also now refuses a "conversation" without both a visitor turn and
      an assistant turn. Five tests, including that a dead KV opens the gate
      rather than taking the endpoint down.
- [x] 🟢 Content-Security-Policy — **shipped and enforcing** (see the header block
      at the top of `_headers`, which records how it was verified: eight page
      types loaded with zero violations, every real destination confirmed
      allowed, an attacker domain confirmed blocked).
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
- [x] The shipped supplier catalog reaches the USER, not only the agent
      (22/08/2026): the "הוספה מהמאגר" picker searches his own prices first and
      then /api/materials (7,364 ARCA items), with a remembered trade-discount
      percentage — retail stays the suggestion, his cost becomes the price, and
      the price book still wins. The price-book screen got the same search with
      the opposite destination: find what you buy, add it to your own list.
- [ ] Ingest full Dekel book into the system catalog (data already local in
      "הקמת תשתית/כתב כמויות" — dekel_clean_perfect.xlsx). Stav has the file;
      it is not in the repo, so this waits on him uploading it (or on the
      catalog screen's import, which takes name/price/unit columns today).
- [ ] More adversarial training rounds — waiting for Stav's time: he feeds real examples,
      we check the model's guesses, fix the map each round.
- [ ] SUMIT selling point surfaced in provider UI (badge exists; consider onboarding highlight).
- [ ] Providers: live tests with real accounts (Green Invoice/iCount/EZcount/SUMIT).
- [ ] Optional Chrome-Claude crawl: supplier material catalog (e.g. big wholesaler) to seed
      system material prices — only if Stav wants; users can also feed via the scrape tab.

- [x] "Perfect site" compliance pass (04/08): accessibility statement + privacy policy
      pages, footer legal links sitewide, discreet cookie/measurement notice bar with
      Clarity opt-out, branded 404, signup tracking (firstSeen + admin signup strip +
      admin counters).
- [ ] bebusy365.com research — blocked by session network policy; needs Stav to allow
      the domain in the environment settings or share screenshots.

## Growth / marketing
- [ ] Share push into electrician WhatsApp groups (Stav sends /ask/ link; OG card ready).
- [ ] "Loved by AIs" expansion: keep llms.txt fresh; consider FAQ page for GEO.

## Tech debt
- [x] 🟢 checkups: duplicated periodic-service core — **extracted 22/08/2026** to
      `assets/checkups-core.js` (dates, recurrence rule, calendar event, .ics).
      Both screens delegate to it and keep their own rendering and their own
      words; nine tests pin the arithmetic (month-end clamping, leap year, RFC
      5545 escaping) and one asserts neither file has grown its own copy again.

## The route, drawn (shipped 22/08/2026)

The idea that survived the removal of the auto-generated sketches, built as its
own feature: **שרטוט המסלול**, a button on the pricing screen and a section at
the top of the printed work order. The segments are the route answers he ticked,
in checklist order; the conduit and the cable are read off the priced lines, so
the drawing can never disagree with the quote; digging and cutting are dashed.
Hand-drawn on purpose (a displacement filter on the strokes, a marker face for
the words — the text is not wobbled, because a drawing you cannot read is a
decoration). Horizontal on a desk, stacked down the page on a phone.

Still open on this thread: per-segment *lengths* (today one total for the run)
and heights ("הרכבה בגובה 120") — both need a place in the characterization to
say them, which is a checklist change, not a drawing change.

## Dropped, with the part worth keeping
- [x] ~~Auto-generated job sketches~~ — **removed 12/08/2026 on Stav's call.**
      What shipped was schematic side views (wall, route, panel, socket). His
      verdict: *"כל אחד יכול לדמיין את הפרטות הזאת"* — and he is right; a picture
      that only restates what the card already says earns nothing.
      **The idea underneath is NOT dead, and is worth revisiting as its own
      feature.** What he actually wanted, in his words: a drawing of the riser
      and the exit from the flat, annotated per segment — *"קידוח 30 עם צינור 25"*,
      *"הרכבה בגובה 120"*, *"מריכון 25"*, and a bend section marked *"שרשורי"*.
      That is not decoration: it is the field work order drawn instead of
      listed, segment by segment with the real dimensions on each. Buildable
      from the same characterization answers, but a different feature from what
      was removed — the value is in the per-segment annotations, not the shape.
      He also pictured it looser: *"שרבוט יותר ציורי, שבן אדם יחשוב שהוא צייר
      משהו עם דף ועט"* — a hand-drawn feel, not CAD lines. (The 3D/Revit
      walkthrough he mentioned he dismissed himself as fantasy.)

## V3.0 rebuild — queued follow-ups (16.8.2026)
- Full de-FontAwesome sweep inside sale/app.js rendered templates (V3 shell is already SVG-only; FA CDN kept for panel innerHTML icons meanwhile).
- Financy (open-banking) connector for the finance dashboard — waiting on Stav's one-time registration at financy.open-finance.ai; server will take keys as env vars.
- WhatsApp bot variant of the Telegram defect-report bot (Meta API is paid — deferred).
- Refresh PRODUCT_OVERVIEW.md to describe the V3 shell (one rail, more-drawer, finance panel, funnel card).
- Visual QA pass on sale/css/panels.css (written against markup, not yet eyeballed screen-by-screen).
- "תזכיר לי" natural-language calendar reminders from project cards (spec §5ג) — the maint-dialog + calendar plumbing exists; the free-text entry point still to build.
- Onboarding "מה עכשיו?" next-step hint cards after each stage (spec §5ב) — partial today (plan/price action bars), formalize per stage.

## סדר בצ'אטים / בעבודות (בקשה של סתיו, 21.8.2026)

הבקשה: כפתור בסגנון "צ'אטים שלא מויינו", כדי לעשות סדר.

הרקע: מאז שמסך הבית הוא צ'אט אחד גדול, כל משפט שמתחילים בו נפתח כעבודה
חדשה (`createNewProject`, סטטוס "טיוטה", שלב `planning`). חלק מהן הופכות
להצעת מחיר, וחלק נשארות שיחה שנזנחה אחרי שתי הודעות. שתיהן יושבות באותה
רשימה, אחת ליד השנייה, וזה מה שמרגיש לא מסודר. הצ'אט המהיר ב-/ask/ לא
שומר היסטוריה בכלל (סשן 24 שעות), אז הבעיה כולה חיה ברשימת העבודות.

איך לעשות את זה נכון (ההמלצה):
1. **בלי תיבת דואר שנייה למיין.** "לא מויין" הוא עוד מטלה יומית: הרשימה
   כבר יודעת על כל עבודה באיזה שלב היא ומתי נגעו בה לאחרונה. המערכת
   צריכה למיין לבד, לא לבקש מסתיו למיין.
2. **המיון האמיתי הוא "יצא מזה משהו או לא".** עבודה שנשארה ב`planning`,
   בלי חומרים ובלי מחיר, שלא נגעו בה כמה ימים = טיוטה שנשארה באוויר.
   אלה יורדות לאזור מקופל בתחתית רשימת העבודות ("טיוטות, N") עם שתי
   פעולות בלבד: להמשיך או למחוק. הרשימה הראשית נשארת עבודות אמיתיות.
3. **קטגוריות נשארות ידניות ואופציונליות.** הן שימושיות למי שרוצה אותן,
   אבל אסור שהן יהפכו לתנאי כדי שהרשימה תיראה נקייה.
4. **מחיקה מרובה**: לסמן כמה טיוטות ולמחוק בבת אחת, כי הזנב הזה מצטבר.

מה לבדוק לפני שמיישמים: כמה ימים בלי נגיעה זה "נזנח" (הצעה: 7), ואם
לקרוא לזה "טיוטות" או "התחלות". שווה גם לשקול שהסוכן ייתן שם לעבודה
כבר מהמשפט הראשון, כדי שהרשימה לא תתמלא ב"פרויקט חדש".

**בוצע (21-22.8.2026):** סתיו אישר 7 ימים. מדף "טיוטות" מקופל בתחתית רשימת
העבודות, עם המשך/מחיקה ומחיקה מרובה, והסוכן נותן שם לעבודה מהמשפט הראשון
(`autoName`). לא נבנתה תיבת דואר שנייה למיין, בכוונה.

## ברירות מחדל סטנדרטיות באפיון (22.8.2026)

כל 111 שאלות הצ'יפים והמספרים בתשעת השאלונים נפתחות על התשובה שנכונה לרוב
העבודות (`COVERAGE_DEFAULTS`), כך שפרויקט חדש ניתן לתמחור מיד. ברירת מחדל לא
דורסת תשובה של המשתמש, של הסוכן או דילוג; היא מסומנת "סטנדרט" עד שמאשרים;
ושדה חובה שנשאר עליה נכתב בהצעה כהנחה. **מה שנשאר פתוח:** לעבור על הרשימה
עם סתיו ולאשר שהברירות באמת הנפוצות אצלו (זה הדבר היחיד כאן שדורש חשמלאי,
לא מתכנת) — `COVERAGE_DEFAULTS` בסוף `sale/coverage.js`, שורה אחת לכל שדה.
