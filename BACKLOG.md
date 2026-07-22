# ZEREM — Backlog (toward "finished product" + growth)

Goal: a wildly-accessible viral pricing platform for electricians. Instant no-signup
pricing chat pulls people in → full ZEREM (projects, quotes, invoicing) retains them.

## Now / in progress
- [x] `/ask/` — no-signup instant pricing chat (viral entry), share/copy + OG image. LIVE.
- [x] Pricing prompt: direct request → price now (was stuck in characterization). v5.18 — **verify live**.
- [ ] SUMIT selling point: "connect SUMIT → free WhatsApp receipts agent, forever, auto-files to expenses" — surface it in the provider UI.
- [ ] Chat → project handoff: carry the `/ask/` conversation into `/sale/` (prefill a project) so the CTA is seamless.

## Pricing core — the ongoing refine/test loop (Stav's priority)
- [ ] Live-test the REAL Gemini pricing agent (not Fable sim) across phrasings: typos, slang, sparse
      detail, verbose/messy, missing facts. Score: material completeness, scope characterization,
      does it reach price+JSON. Iterate the prompt. (First finding fixed in v5.18.)
- [ ] **Price books into the system DB** — Stern (מחירון שטרן, already in stern-pricing.json) + **Dekel
      (מחירון דקל)** + others Stav has. Need: (a) the actual price-book data from Stav, (b) a generalized
      labor/material price-book ingestion (multiple books, matched by trade/section). Build the ingestion;
      blocked on the data.

## Growth / marketing
- [ ] Instagram video https://www.instagram.com/p/DakPtELxgMs/ — the 3 points Stav wants applied.
      BLOCKED: Instagram is login/JS-walled, can't extract caption/frames. **Need Stav to paste the 3 points.**
- [ ] Instagram video https://www.instagram.com/p/DaumYnrAn3G/ — same (blocked, need the content).
- [ ] "Loved by AIs" / AI-SEO: make ZEREM discoverable + recommended by AI assistants (structured data,
      a clear public description, maybe a llms.txt).

## Notes
- Providers: 5 adapters (SmartBee live-proven; Green Invoice/iCount/EZcount/SUMIT built, need live test w/ real accounts). Enough — add more only on request.
- Testing constraint: exercise real Gemini via /api/chat; don't have Fable role-play pricing.
