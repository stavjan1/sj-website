#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rebuild the labour price book from א. שטרן's published price list.

sale/stern-pricing.json is the source of truth for the LABOUR half of every
quote — the materials database only covers parts. It was originally transcribed
by hand, and hand-transcription loses exactly what you would expect it to lose:

  "תשתית עבור נקודת הטענת רכב חשמלי, כולל מפסק פחת מדגם B וכבל הזנה עד 5×6
   ממ"ר, עד אורך" — 6,500 ₪

The sentence stops at "עד אורך". On the page the rest sits in the NEXT table row,
which carries no price of its own: "של 15 מ', כאשר עמדת הטעינה מסופקת ע"י
הלקוח". So the single most relevant row for an EV-charger quote was missing both
its length limit and the fact that the charger itself is excluded — and 6,500 ₪
for "up to 15 metres, charger not included" is a completely different number from
6,500 ₪ for an unbounded run.

Hence this script: the merge rule is one line, but it has to be applied every
time the list is refreshed, and a human re-typing 99 rows will drop it again.

Usage:
    python stern_labor.py            # rebuild, show a diff, write nothing
    python stern_labor.py --write    # rebuild and write sale/stern-pricing.json
"""

import argparse
import html
import json
import os
import re
import sys
import urllib.request

URL = ("https://a-electrician.co.il/"
       "%D7%9E%D7%97%D7%99%D7%A8%D7%95%D7%9F-%D7%97%D7%A9%D7%9E%D7%9C%D7%90%D7%99-"
       "%D7%9E%D7%95%D7%A1%D7%9E%D7%9A-%D7%90-%D7%A9%D7%98%D7%A8%D7%9F-"
       "%D7%A2%D7%91%D7%95%D7%93%D7%95%D7%AA-%D7%97%D7%A9/")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "sale", "stern-pricing.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read().decode("utf-8", "replace")


def clean(cell):
    text = html.unescape(re.sub(r"<[^>]+>", " ", cell)).replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip()


def price_of(text):
    if "₪" not in text:
        return None
    m = re.search(r"([\d,]+(?:\.\d+)?)", text)
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def parse(page):
    rows = [[clean(c) for c in CELL_RE.findall(r)] for r in ROW_RE.findall(page)]
    items = []
    for cells in rows:
        if len(cells) < 2:
            continue
        desc = cells[0]
        if not desc or desc in ("פירוט עבודה",) or desc.startswith("מחירון"):
            continue

        unit = ""
        price = None
        for c in cells[1:]:
            p = price_of(c)
            if p is not None:
                price = p
            elif c and "מחיר" not in c:
                unit = c

        if price is None:
            # A row with text and no price is either a "price on request" line
            # (it carries the "החל מ…" marker) or the tail of the sentence above.
            # The distinction is what the previous row looks like: a description
            # that ends mid-clause is waiting for this text.
            if unit:
                items.append({"description": desc, "unit": unit, "price": 0})
            elif items:
                items[-1]["description"] = (items[-1]["description"].rstrip() + " " + desc).strip()
            continue

        items.append({"description": desc, "unit": unit, "price": price})
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write sale/stern-pricing.json")
    args = ap.parse_args()

    items = parse(fetch(URL))
    if len(items) < 80:
        sys.exit("Only %d rows parsed — the page layout probably changed; refusing "
                 "to overwrite the labour book." % len(items))

    with open(OUT, "r", encoding="utf-8-sig") as f:
        current = json.load(f)
    current = current if isinstance(current, list) else current.get("items", [])

    old = {i["description"].strip(): i for i in current}
    new = {i["description"].strip(): i for i in items}

    added = [k for k in new if k not in old]
    removed = [k for k in old if k not in new]
    changed = [(k, old[k]["price"], new[k]["price"])
               for k in new if k in old and abs(old[k]["price"] - new[k]["price"]) > 0.01]

    print("parsed %d rows (was %d)" % (len(items), len(current)))
    print("\nadded (%d):" % len(added))
    for k in added:
        print("   + %s = %s" % (k[:100], new[k]["price"]))
    print("\nremoved (%d):" % len(removed))
    for k in removed:
        print("   - %s = %s" % (k[:100], old[k]["price"]))
    print("\nprice changes (%d):" % len(changed))
    for k, a, b in changed:
        print("   ~ %s: %s -> %s" % (k[:80], a, b))

    if args.write:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print("\nwrote %s" % OUT)
    else:
        print("\n(dry run — pass --write to save)")


if __name__ == "__main__":
    main()
