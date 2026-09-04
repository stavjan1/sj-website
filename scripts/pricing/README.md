# SJ price catalogue generators
Inputs live in `data/dekel/` and are gitignored (licensed Dekel data): `dekel_prices_raw.json` feeds `catalog.py`, whose `helper_catalog.json` feeds `prices2.py`, which writes `prices_sj_proposed.json`.
Outputs that the site actually serves: `site/sale/data/sj-prices.json` and `functions/api/_sj_catalog.js` are generated from `prices_sj_proposed.json` (see the header comment of `_sj_catalog.js`).
Run order, from the repo root: `python scripts/pricing/catalog.py` then `python scripts/pricing/prices2.py`.
Each script also writes a `*_summary.md` next to its JSON in `data/dekel/` for a human read-through before the outputs are committed.
