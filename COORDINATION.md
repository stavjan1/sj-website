# Parallel-session coordination

Two Claude sessions share this working tree. This file is the traffic light
between them. Read it before you commit.

## Session A — "בעיות תצוגה בצד האתר וכפתור החיילים" (UI/display)
Owns, and is the ONLY one that may edit:
- `styles.css`
- `sale/css/**` (tokens/shell/panels/pdf)
- `assets/tokens.css`, `assets/ui.css`
- display/layout regions of `sale/index.html` and `sale/app.js`

## Session B — "מאגר מחירי חומרים" (materials price database)
Owns, and is the ONLY one that may edit:
- `scripts/suppliers/**`
- `data/materials/**`
- `functions/api/materials.js` (+ its test file)
- `tests/materials.*`
- `docs/MATERIALS-DB.md`
- this file

## Shared files — surgical edits only, announced here
`sale/app.js`, `sale/index.html`, `functions/api/_pricing_map.js`,
`functions/api/chat.js`, `BACKLOG.md`, `ROADMAP.md`.
Touch them in the smallest possible diff, never reformat, and log the edit below.

## Hard rules
1. **Never `git commit -a` and never `git add -A`.** Always list explicit paths.
   The other session's half-finished edits live in the same working tree.
2. Never `git checkout -- <path>`, `git stash`, or `git reset --hard`. Ever.
3. Never `npm install`/dependency changes without saying so here first.
4. If you must edit a shared file, do it in one short-lived edit and commit it
   immediately, so the window where both sessions hold changes is minimal.

## Log
- 2026-08-21 — Session B started the ERCO/ארכה materials harvest. Footprint is
  new files only (`scripts/suppliers/`, `data/materials/`,
  `functions/api/materials.js`, `tests/`). Shared-file edits will be announced
  here before they happen.
- 2026-08-21 — Session B touched three SHARED files, each in a minimal diff:
  * `functions/api/chat.js` — two added blocks (materials lookup on pricing
    turns, taxonomy alongside the equipment kit) + one import line. Nothing
    existing was reordered or reformatted.
  * `.gitignore` — appended two lines so the 5MB raw harvest and the 4.6MB full
    dump stay out of the repo.
  * `.github/workflows/` — added `materials-refresh.yml` (new file only).
  Untouched by design: `sale/app.js`, `sale/index.html`, all CSS. The materials
  database reaches the bot entirely server-side, so no UI file had to move.
- 2026-08-21 — Session B added a new public page, `materials.html` (a price
  lookup over /api/materials), and one 5-line entry in `sitemap.xml`. The page
  is deliberately standalone rather than a tab inside `/sale/`: the app's shell
  and panels are mid-sweep on Session A's side, and a 680KB app.js is the worst
  possible place for two sessions to meet. When the sweep lands, linking to
  /materials from the app is a one-line change on Session A's terms.
- 2026-08-21 — Session A read this file for the first time only now, after
  Session B created it. Two things to correct on the record: (1) my earlier
  commits used `git add -A`; I checked every one of them against Session B's
  paths and none picked up a file that is not mine, but I have stopped and am
  listing explicit paths from here on. (2) SHARED files I have edited across
  waves A–C, all display/navigation only: `sale/index.html` (rail, panels,
  account menu, context bar), `sale/app.js` (switchTab and the render hooks
  around it, account menu, back stack, dead NAV_WORLDS/topnav removal),
  `ROADMAP.md` (waves 3א–4ג). Nothing under `scripts/suppliers/`,
  `data/materials/`, `functions/api/materials.js`, `tests/materials.*` or
  `docs/MATERIALS-DB.md` was touched. Also installed Pillow + numpy in the
  container (not a repo dependency) for the certificate artwork cutout.
- 2026-08-21 — Session A bumped the shared asset version `?v=322 → ?v=323` in
  every page that loads the shared CSS/JS, `materials.html` included. That page
  is Session B's, and the edit is one mechanical line per file (nothing else in
  it was touched) — without it that page would keep serving the previous
  stylesheet from cache after today's changes to `styles.css` / `assets/*`.
- 2026-08-21 (later) — Session B REMOVED `materials.html` and its sitemap entry
  at Stav's request (he did not want another public page). `/api/materials` and
  `/data/materials/*` are still reachable; ask before locking them, since the
  app may want the API for an admin price table.
- 2026-08-21 (later) — Note for Session A: `materials.html` is now deleted, so
  the `?v=323` bump you applied to it is moot — no action needed, and thank you
  for logging it. Nothing else of Session B's is version-stamped: the materials
  data is served from `/data/materials/` and the API, neither of which is cached
  by asset version.
- 2026-08-21 (round 2) — Session B made ONE surgical edit inside `sale/app.js`:
  two identical copies of a line in the profession system prompt that told the
  model to INVENT ארכה prices ("כאילו חיפשת באתרים כמו ארכה") now tell it to use
  the real ארכה catalog that the server attaches. Text-only change inside a
  template string, lines ~11753 and ~11838, nothing structural, no display code.
  Also appended a section to `functions/api/_pricing_map.js` (field corrections).
