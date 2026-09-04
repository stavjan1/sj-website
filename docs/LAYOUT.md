# Repository layout — what is served and what is not

**`site/` is the web root.** It is the Cloudflare Pages "Build output directory",
so every file inside it is public the moment it is deployed, and **nothing
outside `site/` is ever served** — no stubs, no `_redirects` 404 lines, no
robots rules needed to hide anything.

- `site/` — pages, scripts, styles, `assets/`, `sale/`, `thing/`, `zerem/`, `ask/`, `q/`,
  `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`, `llms.txt`, and the runtime data
  the Functions fetch from the site's own origin (`data/materials/`, `data/coverage/`).
  Public URLs are unchanged: `site/sale/app.js` is `/sale/app.js`.
- `functions/` — Pages Functions. They **stay at the repository root**: Pages resolves
  `functions/` relative to the project root, not the build output directory.
- `tests/`, `scripts/`, `docs/`, `partials/`, `data/iec_*`, `data/clarity/`,
  `data/field-research/`, `*.md` — private working files. Never put them under `site/`.

`tests/site.test.mjs` fails if a private file lands under `site/` or a page lands outside it.
