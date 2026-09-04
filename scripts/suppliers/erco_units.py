#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Read the exact unit of sale (מטר / יחידה / ...) off ERCO product pages.

Why this exists: ERCO's GraphQL exposes no unit-of-measure attribute, and its
own price line reads "המחיר הנקוב ... והוא למטר או ליחידה" — the ambiguity is in
the source data. The unit IS rendered per row in the variant table, in the
add-to-cart label cell, so we can read it — but only by fetching HTML, which is
~500KB per page. Fetching all 4,200 products that way would be both slow and
rude, so this runs ONLY over the families where metre-vs-unit changes the quote
(cables, conduit, trunking, ladders, strips) and leaves everything else to the
category-based inference in build_materials_db.py.

Output: site/data/materials/raw/erco_units.json — {sku: unit}. Resumable; re-running
only fetches pages it has not already read.
"""

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW_DIR = os.path.join(REPO, "site", "data", "materials", "raw")
PRODUCTS_PATH = os.path.join(RAW_DIR, "erco_products.jsonl")
UNITS_PATH = os.path.join(RAW_DIR, "erco_units.json")
DONE_PATH = os.path.join(RAW_DIR, "erco_units_done.json")

# Families worth the HTTP cost — anything sold by length, plus the trunking and
# tray systems where "price" could plausibly mean either.
TARGET_PATH_FRAGMENTS = (
    "cables-wires", "kblim", "multimedia-cables", "mvbilim", "cable-tray",
    "trunking", "conduit", "grounding", "arqvt", "busbar",
)

UNIT_WHITELIST = ("מטר", "יחידה", "אריזה", "גליל", "זוג", "ק\"ג", "סט", "חבילה")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

PAUSE = 0.8  # slower than the GraphQL sweep — these are full page renders

ROW_RE = re.compile(
    r'<div class="divTableRow row-config".*?</form>', re.S)
SKU_RE = re.compile(r'conf-sku">.*?(?:</span>)?\s*([^<\s][^<]*?)\s*</div>', re.S)
LABEL_RE = re.compile(r'addto-lable">\s*<span class="label">\s*(.*?)\s*</span>', re.S)
# Simple (non-configurable) products state the unit next to the price instead.
SIMPLE_UNIT_RE = re.compile(r'class="price-unit[^"]*">\s*([^<]{1,20})\s*<', re.S)


def fetch(url, retries=3):
    """Return page HTML, or None.

    A 404 here is not a transient failure: the catalog API lists products whose
    storefront page is disabled, so some url_keys have no page at all and never
    will. Retrying those three times with backoff burned ~10 seconds each and
    turned a 10-minute pass into an hour."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "he-IL,he;q=0.9,en;q=0.6",
            })
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410):
                return None
            wait = (2 ** attempt) + random.random()
            sys.stdout.write("  ! %s (HTTP %s) retry in %.1fs\n" % (url[-40:], e.code, wait))
            sys.stdout.flush()
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError) as e:
            wait = (2 ** attempt) + random.random()
            sys.stdout.write("  ! %s (%s) retry in %.1fs\n" % (url[-40:], str(e)[:60], wait))
            sys.stdout.flush()
            time.sleep(wait)
    return None


def clean_unit(raw):
    u = re.sub(r"\s+", " ", (raw or "")).strip().strip(":").strip()
    if not u or len(u) > 12:
        return None
    for ok in UNIT_WHITELIST:
        if ok in u:
            return ok
    return None


def parse_page(html):
    """Return {sku: unit} for every variant row that states a unit."""
    out = {}
    for block in ROW_RE.findall(html or ""):
        sku_m = SKU_RE.search(block)
        lbl_m = LABEL_RE.search(block)
        if not sku_m:
            continue
        sku = sku_m.group(1).strip()
        unit = clean_unit(lbl_m.group(1) if lbl_m else "")
        if sku and unit:
            out[sku] = unit
    return out


def targets():
    """Families whose category path matches the whitelist, as (sku, url)."""
    if not os.path.exists(PRODUCTS_PATH):
        sys.exit("Run erco_harvest.py first — no %s" % PRODUCTS_PATH)
    seen = {}
    with open(PRODUCTS_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                p = json.loads(line)
            except json.JSONDecodeError:
                continue
            paths = " ".join((c.get("url_path") or "") for c in (p.get("categories") or [])).lower()
            if not any(frag in paths for frag in TARGET_PATH_FRAGMENTS):
                continue
            if not p.get("url_key"):
                continue
            seen[p["sku"]] = "https://www.erco.co.il/%s.html" % p["url_key"]
    return seen


def load(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def save(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="stop after N pages")
    args = ap.parse_args()

    tgt = targets()
    units = load(UNITS_PATH, {})
    done = set(load(DONE_PATH, []))
    todo = [(s, u) for s, u in sorted(tgt.items()) if s not in done]
    if args.limit:
        todo = todo[:args.limit]

    print("families in scope: %d  |  already read: %d  |  fetching: %d"
          % (len(tgt), len(done), len(todo)))

    for i, (sku, url) in enumerate(todo, 1):
        html = fetch(url)
        if html is None:
            done.add(sku)   # dead page — never ask for it again
            continue
        found = parse_page(html)
        if not found:
            # A simple product page — one unit for the whole page.
            m = SIMPLE_UNIT_RE.search(html)
            u = clean_unit(m.group(1) if m else "")
            if u:
                found = {sku: u}
        units.update(found)
        done.add(sku)
        if i % 10 == 0 or i == len(todo):
            save(UNITS_PATH, units)
            save(DONE_PATH, sorted(done))
            print("  %d/%d pages | %d SKUs with a stated unit" % (i, len(todo), len(units)))
        time.sleep(PAUSE)

    save(UNITS_PATH, units)
    save(DONE_PATH, sorted(done))
    print("done: %d SKUs carry a page-verified unit" % len(units))


if __name__ == "__main__":
    main()
