#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Harvest the full ERCO / ארכה (www.erco.co.il) catalog through its public
Magento GraphQL endpoint.

Why GraphQL and not HTML scraping: the site is Magento 2 and leaves /graphql
open for catalog reads. That gives us the exact structured data the product
pages render — including the "בחירת דגם" variant tables (every cross-section of
a cable, with its own SKU and its own price per metre) — instead of trying to
recover a table out of 500KB of markup. It is also far gentler on their
servers: ~110 requests for the whole catalog rather than ~4,300 page loads.

Output (append-only JSONL, one product per line) is the RAW layer.
Normalisation into the materials DB is a separate step (build_materials_db.py),
so a schema change never means re-hitting the supplier.

Usage:
    python erco_harvest.py                 # resume / run
    python erco_harvest.py --fresh         # ignore state, start over
    python erco_harvest.py --limit-cats 2  # smoke test
"""

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = "https://www.erco.co.il/graphql"
ROOT_CATEGORY_ID = 526  # "קטלוג ראשי" — the b2c store root

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW_DIR = os.path.join(REPO, "site", "data", "materials", "raw")

PRODUCTS_PATH = os.path.join(RAW_DIR, "erco_products.jsonl")
CATEGORIES_PATH = os.path.join(RAW_DIR, "erco_categories.json")
STATE_PATH = os.path.join(RAW_DIR, "erco_state.json")

PAGE_SIZE = 50          # variants make responses fat; 50 keeps them ~1-3 MB
REQUEST_PAUSE = 0.35    # be a polite guest
MAX_RETRIES = 5

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


# --------------------------------------------------------------------------
# GraphQL plumbing
# --------------------------------------------------------------------------

def gql(query, variables=None, timeout=90):
    """POST a query, with retry + exponential backoff on transient failures."""
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(
                ENDPOINT,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": UA,
                    "Accept-Language": "he-IL,he;q=0.9,en;q=0.6",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read().decode("utf-8", "replace")
            data = json.loads(body)
            # Magento reports partial failures as `errors` alongside usable
            # `data` (their `description` resolver throws on some products).
            # A response that still carries data is good enough — we log and go.
            if "errors" in data and not data.get("data"):
                raise RuntimeError(json.dumps(data["errors"], ensure_ascii=False)[:400])
            return data
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
                json.JSONDecodeError, RuntimeError) as e:
            last_err = e
            wait = (2 ** attempt) + random.random()
            log("  ! request failed (%s), retry in %.1fs" % (str(e)[:120], wait))
            time.sleep(wait)
    raise RuntimeError("giving up after %d retries: %s" % (MAX_RETRIES, last_err))


def log(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


# --------------------------------------------------------------------------
# Category tree
# --------------------------------------------------------------------------

CATEGORY_QUERY = """
query Cats($parent: String!) {
  categoryList(filters: {parent_id: {eq: $parent}}) {
    uid id name level url_path product_count children_count
  }
}
"""


def fetch_category_tree(root_id=ROOT_CATEGORY_ID, max_depth=3):
    """Walk the tree breadth-first. `children_count` on this store is unreliable
    (it reports 0 for level-2 categories that demonstrably have children), so we
    probe every node instead of trusting it.

    Depth is capped at 3 (site levels 2-4) on purpose: that is where the catalog
    actually bottoms out, and probing level-5 costs ~380 requests to discover
    almost nothing. The authoritative taxonomy is rebuilt from the products
    themselves anyway — every product carries its own full category list — so
    this walk only has to be good enough to enumerate the level-2 anchors."""
    tree = []
    frontier = [(str(root_id), None)]
    depth = 0
    while frontier and depth < max_depth:
        next_frontier = []
        for parent_id, parent_path in frontier:
            data = gql(CATEGORY_QUERY, {"parent": parent_id})
            kids = (data.get("data") or {}).get("categoryList") or []
            for k in kids:
                k["parent_id"] = int(parent_id)
                k["path_names"] = (parent_path or []) + [k["name"]]
                tree.append(k)
                next_frontier.append((str(k["id"]), k["path_names"]))
            time.sleep(REQUEST_PAUSE)
        frontier = next_frontier
        depth += 1
        log("  depth %d: %d categories so far" % (depth, len(tree)))
    return tree


# --------------------------------------------------------------------------
# Products
# --------------------------------------------------------------------------

# `description`/`short_description` are deliberately absent: this store's
# resolver throws an Internal Server Error on them (the schema declares String
# but the backend hands back a ComplexTextValue). Asking for them poisons the
# whole page response. Product name + category path + variant attributes carry
# the meaning we actually need; long copy is enriched separately if ever needed.
PRODUCTS_QUERY = """
query Products($uid: String!, $page: Int!, $size: Int!) {
  products(filter: {category_uid: {eq: $uid}}, pageSize: $size, currentPage: $page) {
    total_count
    page_info { current_page page_size total_pages }
    items {
      __typename
      uid
      sku
      name
      url_key
      price_range {
        minimum_price { regular_price { value currency } final_price { value } discount { percent_off } }
        maximum_price { final_price { value } }
      }
      categories { uid name url_path level }
      ... on ConfigurableProduct {
        configurable_options { label attribute_code values { label value_index } }
        variants {
          attributes { code label value_index }
          product {
            sku
            name
            price_range { minimum_price { regular_price { value } final_price { value } } }
          }
        }
      }
    }
  }
}
"""


def load_state():
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"done_pages": [], "seen_skus": []}


def save_state(state):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_PATH)


def harvest(limit_cats=None, fresh=False):
    os.makedirs(RAW_DIR, exist_ok=True)

    if fresh:
        for p in (PRODUCTS_PATH, STATE_PATH):
            if os.path.exists(p):
                os.remove(p)

    log("Fetching category tree...")
    if os.path.exists(CATEGORIES_PATH) and not fresh:
        with open(CATEGORIES_PATH, "r", encoding="utf-8") as f:
            tree = json.load(f)
        log("  reused cached tree: %d categories" % len(tree))
    else:
        tree = fetch_category_tree()
        with open(CATEGORIES_PATH, "w", encoding="utf-8") as f:
            json.dump(tree, f, ensure_ascii=False, indent=1)
        log("  %d categories written" % len(tree))

    # Level-2 categories are anchors: Magento serves every descendant's product
    # through them, so sweeping the 18 top categories covers the whole catalog
    # with a fraction of the requests. Deeper categories are still recorded in
    # the tree (each product also carries its own full category list).
    top = [c for c in tree if c["level"] == 2 and (c.get("product_count") or 0) > 0]
    top.sort(key=lambda c: -(c.get("product_count") or 0))
    if limit_cats:
        top = top[:limit_cats]
    log("Sweeping %d top-level categories (%d product slots)"
        % (len(top), sum(c.get("product_count") or 0 for c in top)))

    state = load_state()
    done = set(tuple(x) for x in state["done_pages"])
    seen = set(state["seen_skus"])

    out = open(PRODUCTS_PATH, "a", encoding="utf-8")
    try:
        for cat in top:
            uid = cat["uid"]
            page = 1
            total_pages = 1
            while page <= total_pages:
                key = (uid, page)
                if key in done:
                    # Still need total_pages; a cheap head request gets it.
                    if page == 1:
                        data = gql(PRODUCTS_QUERY, {"uid": uid, "page": 1, "size": 1})
                        pr = (data.get("data") or {}).get("products") or {}
                        tc = pr.get("total_count") or 0
                        total_pages = max(1, -(-tc // PAGE_SIZE))
                        time.sleep(REQUEST_PAUSE)
                    page += 1
                    continue

                data = gql(PRODUCTS_QUERY, {"uid": uid, "page": page, "size": PAGE_SIZE})
                if data.get("errors"):
                    log("  ~ partial errors on %s p%d: %s"
                        % (cat["name"], page, json.dumps(data["errors"], ensure_ascii=False)[:160]))
                pr = (data.get("data") or {}).get("products") or {}
                info = pr.get("page_info") or {}
                total_pages = info.get("total_pages") or 1
                items = pr.get("items") or []

                new = 0
                for it in items:
                    if not it or not it.get("sku"):
                        continue
                    if it["sku"] in seen:
                        continue
                    seen.add(it["sku"])
                    it["_source_category"] = {"uid": uid, "name": cat["name"],
                                              "url_path": cat.get("url_path")}
                    out.write(json.dumps(it, ensure_ascii=False) + "\n")
                    new += 1
                out.flush()

                done.add(key)
                state["done_pages"] = [list(x) for x in done]
                state["seen_skus"] = list(seen)
                save_state(state)

                log("  %-28s p%2d/%-2d  +%3d new  (total unique %d)"
                    % (cat["name"][:28], page, total_pages, new, len(seen)))
                page += 1
                time.sleep(REQUEST_PAUSE)
    finally:
        out.close()

    log("\nDone. %d unique products in %s" % (len(seen), PRODUCTS_PATH))
    return len(seen)


# --------------------------------------------------------------------------
# Backfill
# --------------------------------------------------------------------------

# The category sweep reaches everything that hangs off the 18 level-2 anchors —
# 4,008 of the store's 4,237 products. The remainder are shelved somewhere else
# (a landing-page category, or no category at all) and would silently never be
# priced. This pass walks the catalog with no category narrowing at all and
# picks up whatever the sweep missed.
#
# `url_key` is a real ProductInterface field but not a filterable attribute on
# this store, so Magento accepts the filter and then applies nothing — which is
# exactly the unfiltered listing we want. If a future upgrade starts honouring
# it, the total_count assertion below turns that into a loud failure instead of
# a quiet under-harvest.
BACKFILL_FILTER = '{url_key: {eq: "*"}}'


def backfill():
    os.makedirs(RAW_DIR, exist_ok=True)
    state = load_state()
    seen = set(state["seen_skus"])
    before = len(seen)

    query = PRODUCTS_QUERY.replace(
        "filter: {category_uid: {eq: $uid}}", "filter: " + BACKFILL_FILTER
    ).replace("query Products($uid: String!, $page: Int!, $size: Int!)",
              "query Products($page: Int!, $size: Int!)")

    probe = gql(query, {"page": 1, "size": 1})
    total = ((probe.get("data") or {}).get("products") or {}).get("total_count") or 0
    if total < before:
        log("! backfill listing returned %d products but we already have %d — "
            "the filter is being honoured now; skipping backfill." % (total, before))
        return 0
    pages = max(1, -(-total // PAGE_SIZE))
    log("Backfill: store reports %d products, we hold %d. Walking %d pages."
        % (total, before, pages))

    out = open(PRODUCTS_PATH, "a", encoding="utf-8")
    try:
        for page in range(1, pages + 1):
            data = gql(query, {"page": page, "size": PAGE_SIZE})
            items = (((data.get("data") or {}).get("products") or {}).get("items")) or []
            new = 0
            for it in items:
                if not it or not it.get("sku") or it["sku"] in seen:
                    continue
                seen.add(it["sku"])
                it["_source_category"] = {"uid": None, "name": "(backfill)", "url_path": None}
                out.write(json.dumps(it, ensure_ascii=False) + "\n")
                new += 1
            out.flush()
            if new:
                state["seen_skus"] = list(seen)
                save_state(state)
                log("  backfill p%d/%d  +%d new  (total unique %d)"
                    % (page, pages, new, len(seen)))
            time.sleep(REQUEST_PAUSE)
    finally:
        out.close()
    log("Backfill added %d products (now %d)." % (len(seen) - before, len(seen)))
    return len(seen) - before


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="ignore saved state")
    ap.add_argument("--limit-cats", type=int, default=None, help="only N categories (smoke test)")
    ap.add_argument("--backfill", action="store_true",
                    help="only run the uncategorized-product backfill pass")
    args = ap.parse_args()
    if args.backfill:
        backfill()
        sys.exit(0)
    harvest(limit_cats=args.limit_cats, fresh=args.fresh)
    backfill()
    sys.exit(0)
