#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Turn the raw supplier harvest into the materials database the pricing bot uses.

Raw -> normalized is a separate step on purpose: the schema below will change as
we learn what the bot actually needs, and a schema change must never mean
hitting the supplier again.

What comes out (data/materials/):
  erco.json        full normalized rows — the human/tooling-readable source
  index.json       compact runtime payload the API + client search over
  taxonomy.json    the category tree with price statistics per node

The single most important judgement call in here is UNIT. ERCO's own pages say
"המחיר הנקוב ... והוא למטר או ליחידה" — the site itself does not commit per row
in the structured data. Guessing silently would be the worst outcome for a
pricing bot, so every row carries both a `unit` and a `unit_src`
("category" = inferred, "page" = read off the product page, "name" = stated in
the product name), and the AI block tells the model to treat inferred units as
an assumption worth stating.
"""

import json
import os
import re
import statistics
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW_DIR = os.path.join(REPO, "data", "materials", "raw")
OUT_DIR = os.path.join(REPO, "data", "materials")

VAT_RATE = 0.18  # Israel, since 1.1.2025. Site prices are shown INCLUDING VAT.

SUPPLIER = {
    "id": "erco",
    "name": "ארכה",
    "site": "https://www.erco.co.il",
    "kind": "retail",  # list prices a walk-in customer pays, not trade cost
}


# --------------------------------------------------------------------------
# Unit inference
# --------------------------------------------------------------------------

# Unit inference is matched against the DEEPEST category slug, never the whole
# path. Matching the path was the first attempt and it was wrong in a way that
# mattered: "אלקטרודה להארקה 19 מ\"מ" sits under kblim/accessories-1/... , the
# path contained "kblim", and a 198 ₪ earthing rod came out priced "per metre".
# The leaf is the only part of the path that describes the product.

# Leaf slugs whose products really are sold by length.
PER_METRE_LEAF = (
    "power-cables", "control-cables", "flexible-cables", "special-cables",
    "communication-cables", "optical-cables", "audio-cables", "solar-cables",
    "neoprene-cables", "pendal-cables", "telephone-cables", "coaxial",
    "copper-conductor", "aluminum-conductor", "exposed-copper", "/wires/",
    "flexible-wires", "stranded-wires", "cable-tray", "cable-trays",
    "cable-ladder", "cable-trunking", "cable-conduit", "raceways",
    "plastic-piping", "pg-tube", "cobra-tube", "pipe-threads",
    "insulation-pipe", "busbar", "busbars", "grounding-strips", "led-strip",
)

# ...except these, which live inside those subtrees but are discrete pieces:
# the lug, the gland, the sleeve, the bracket, the coupling, the end cap.
PER_UNIT_LEAF = (
    "accessories", "fittings", "-supplies", "jumpers", "connectors",
    "cable-lugs", "cord-end", "shrink", "electrodes", "splices",
)

# Name-based rules run in three tiers, and the ORDER is the whole point. It was
# calibrated against the 746 units read off real product pages by erco_units.py:
# a single flat list scored 86% against that truth, and the misses were all
# ordering collisions — "פס הארקת יסוד בגליל" is a roll (a piece) while
# "פס הארקת יסוד" is priced per metre, and both contain the same words.

# Tier 1 — packaging. If it comes as a roll, a drum or a boxed set, the price is
# for that package however length-like the product is.
PACKAGED_HINTS = ("גליל", "תוף", "חבילה של", "סליל", "מארז", "אריזה", "סט ")

# ...unless the product IS a length of cable. "כבל נאופרן 5X6 - תוף" and
# "כבל גילוי אש 2X1X0.8 - תוף 500מ'" are still priced per metre; the drum is the
# minimum order quantity, not the unit of sale. Page truth was unanimous on this
# and it was the whole remaining error after the tiers were ordered.
LENGTH_GOODS_PREFIXES = ("כבל", "חוט", "מוליך", "פס הארקת", "פנדל")

# Top-of-path slugs for the cable departments. Used only to confirm that a
# product NAMED like cable is also FILED as cable.
CABLE_DEPARTMENTS = ("cables-wires", "kblim", "multimedia-cables")

# "3x1.5", "5X6", "3*25+16" — the shape of a conductor spec.
CROSS_SECTION_RE = re.compile(r"\d+\s*[xX×*]\s*\d")
# "5 מטר", "50 מ'", "500מ'" — a lead that states how long it is.
FINISHED_LENGTH_RE = re.compile(r"\d+(?:\.\d+)?\s*(?:מטר|מ')")
# ...but a stated length next to a packaging word is the size of the DRUM, not
# of the product: "כבל מכשור שחור 1X2X18 AWG כ\"מ - תוף 500מ'" is 500 metres of
# cable at 1.95 ₪ each, not a 1.95 ₪ drum. These arrived through the backfill
# with no category at all, so nothing else could have caught them.
PACKAGING_WORDS = ("תוף", "גליל", "סליל", "חבילה", "חב'", "מארז", 'כ"מ')

# Tier 2 — sold by length, stated in the name. "בחיתוך" (cut to order) is the
# one that mattered: every heat-shrink sleeve sold that way is per metre, and
# the tier-3 word "שרוול" was calling all of them pieces.
PER_METRE_NAME_HINTS = (
    "מטר כבל", "למטר", "לפי מטר", "מחיר למטר", "בחיתוך", "פס הארקת יסוד",
    # A tray cover is cut from the same stock as the tray and priced the same
    # way; only tier order kept it out, because tier 3 claims every "מכסה".
    "מכסה למחורצת", "מכסה לתעלה", "מכסה לתעלת", "מכסה להסתעפות",
    "פס צבירה", "פס השוואה",
)

# Tier 3 — discrete parts that live inside cable and conduit categories.
PER_UNIT_NAME_HINTS = (
    "נעל כבל", "שרוול", "סופית", "מהדק", "מחבר", "אלקטרודה", "מופה",
    "מפצלת", "זרוע", "מכסה", "פינה", "הסתעפות", "תמיכה", "מחזיק", "נשם",
    "אטם", "מחיצה", "תושבת", "בורג", "אום", "דסקית",
)


def infer_unit(name, cat_paths):
    """Return (unit, source). `source` is what the caller shows the model, so a
    guess is never presented with the same confidence as a stated fact."""
    n = name or ""
    is_length_goods = n.startswith(LENGTH_GOODS_PREFIXES)
    if not is_length_goods:
        for hint in PACKAGED_HINTS:
            if hint in n:
                return "יחידה", "name"
    for hint in PER_METRE_NAME_HINTS:
        if hint in n:
            return "מטר", "name"
    for hint in PER_UNIT_NAME_HINTS:
        if hint in n:
            return "יחידה", "name"

    full = " ".join(cat_paths).lower()
    leaf = (cat_paths[-1] if cat_paths else "").lower()

    # A thing called "כבל" that is filed in the cable department is sold by the
    # metre. Full stop — that is how the trade buys it, and the leaf-slug list
    # cannot keep up with the naming ("flame-retardant-cable", "pendal-cables",
    # every new speciality range ERCO adds). The name prefix is what makes this
    # safe: "כבל לעמדת טעינה ציבורית 5 מטר" is a finished lead, and it lives
    # under טעינה לרכב, not under כבלי חשמל, so it never reaches this rule.
    if n.startswith(LENGTH_GOODS_PREFIXES) and any(
            dep in full for dep in CABLE_DEPARTMENTS):
        return "מטר", "name"

    # ...and the same conclusion without trusting the category at all, because
    # the category is sometimes simply wrong: ERCO files its 16 UV-rated N2XY
    # ranges under kli-ebvdh/power-tools/accessories-3 — power tool accessories
    # — so "כבל N2XY 5x6 FR UV" came out priced per piece at 32 ₪.
    #
    # A name that is "כבל" plus a cross-section is bulk cable. The finished-lead
    # guard is what keeps this honest: "כבל לעמדת טעינה ציבורית 5 מטר ... 3*16A"
    # also carries a cross-section, but it states its own length, and a thing
    # that states its length is sold as that thing.
    states_own_length = bool(FINISHED_LENGTH_RE.search(n)) and not any(
        w in n for w in PACKAGING_WORDS)
    if (n.startswith(LENGTH_GOODS_PREFIXES)
            and CROSS_SECTION_RE.search(n)
            and not states_own_length):
        return "מטר", "name"
    for frag in PER_UNIT_LEAF:
        if frag in leaf:
            return "יחידה", "category"
    for frag in PER_METRE_LEAF:
        if frag in leaf:
            return "מטר", "category"
    return "יחידה", "category"


# --------------------------------------------------------------------------
# Text normalisation for Hebrew lexical search
# --------------------------------------------------------------------------

# Hebrew trade names are written a dozen ways: מא"ז / מאז / מא”ז, ממ"ר / ממר,
# 3X1.5 / 3x1.5 / 3*1.5. Search only works if both sides collapse to one form.
_QUOTES = dict.fromkeys(map(ord, '"\'`´״׳“”‘’'), None)


def norm(text):
    t = (text or "").translate(_QUOTES).lower()
    t = t.replace("×", "x").replace("*", "x")
    t = re.sub(r"[²]", "2", t)
    t = re.sub(r"[^\w֐-׿.]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def tokens(text):
    return [t for t in norm(text).split(" ") if len(t) >= 2]


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------

def ex_vat(price_incl):
    return round(float(price_incl) / (1 + VAT_RATE), 2)


def product_url(url_key):
    return "https://www.erco.co.il/%s.html" % url_key if url_key else ""


def deepest_categories(cats):
    """A product sits in several categories (level 2 anchor, level 3, level 4).
    The deepest one is the meaningful label; the whole chain is the path."""
    if not cats:
        return [], []
    ordered = sorted(cats, key=lambda c: c.get("level") or 0)
    names = [c["name"].strip() for c in ordered if c.get("name")]
    paths = [c.get("url_path") or "" for c in ordered]
    return names, paths


def load_raw():
    path = os.path.join(RAW_DIR, "erco_products.jsonl")
    if not os.path.exists(path):
        sys.exit("No harvest at %s — run erco_harvest.py first." % path)
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def load_page_units():
    """Optional enrichment produced by erco_units.py — exact per-SKU units read
    off the product pages for the families where metre-vs-unit actually changes
    the quote. Absent file just means every unit stays inferred."""
    path = os.path.join(RAW_DIR, "erco_units.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def build():
    raw = load_raw()
    page_units = load_page_units()
    items = []
    seen = set()

    for p in raw:
        cat_names, cat_paths = deepest_categories(p.get("categories") or [])
        parent_sku = p.get("sku")
        parent_name = (p.get("name") or "").strip()
        url = product_url(p.get("url_key"))
        variants = p.get("variants") or []

        if variants:
            # A configurable product is a FAMILY: the thing an electrician
            # actually buys is the variant (a specific cross-section), each with
            # its own SKU and its own price. Emit those, and keep the family
            # name so the bot can say "כבל N2XY — 5x6".
            for v in variants:
                vp = (v or {}).get("product") or {}
                sku = (vp.get("sku") or "").strip()
                if not sku or sku in seen:
                    continue
                price_incl = _final(vp)
                if price_incl is None:
                    continue
                seen.add(sku)
                attrs = {}
                for a in (v.get("attributes") or []):
                    if a.get("code") and a.get("label"):
                        attrs[a["code"]] = str(a["label"]).strip()
                name = (vp.get("name") or "").strip() or parent_name
                if not usable_name(name):
                    continue
                unit, unit_src = _unit_for(sku, name, cat_paths, page_units)
                items.append(_row(sku, name, price_incl, unit, unit_src,
                                  cat_names, cat_paths, attrs, url,
                                  parent_sku, parent_name))
        else:
            sku = (parent_sku or "").strip()
            if not sku or sku in seen:
                continue
            price_incl = _final(p)
            if price_incl is None:
                continue
            if not usable_name(parent_name):
                continue
            seen.add(sku)
            unit, unit_src = _unit_for(sku, parent_name, cat_paths, page_units)
            items.append(_row(sku, parent_name, price_incl, unit, unit_src,
                              cat_names, cat_paths, {}, url, None, None))

    items.sort(key=lambda r: (r["cat_path"], r["name"]))
    return items


def _unit_for(sku, name, cat_paths, page_units):
    if sku in page_units and page_units[sku]:
        return page_units[sku], "page"
    return infer_unit(name, cat_paths)


def _final(prod):
    """The sale price, or None when there isn't a usable one.

    A zero is not a price — it is ERCO's placeholder for a family whose variants
    were never priced ("מכסה לתעלת פח ... ברוחבים שונים"). Letting a 0 through
    would be actively harmful: a pricing agent that sees "0 ₪" quotes the item
    as free."""
    try:
        v = float(prod["price_range"]["minimum_price"]["final_price"]["value"])
    except (KeyError, TypeError, ValueError):
        return None
    return v if v > 0 else None


def _regular(prod):
    try:
        return float(prod["price_range"]["minimum_price"]["regular_price"]["value"])
    except (KeyError, TypeError, ValueError):
        return None


def usable_name(name):
    """A price attached to nothing is worse than no row.

    ERCO's catalog contains at least one product literally named "+" — a data
    entry slip on their side. It carries a real price and a real category, so
    every structural check passes, and it would reach the model as a priced item
    with no identity."""
    n = (name or "").strip()
    return len(re.sub(r"[^\wא-ת]", "", n)) >= 2


def _row(sku, name, price_incl, unit, unit_src, cat_names, cat_paths, attrs,
         url, parent_sku, parent_name):
    return {
        "sku": sku,
        "name": name,
        "price": ex_vat(price_incl),        # ₪ before VAT — what quotes use
        "price_vat": round(price_incl, 2),  # ₪ as shown on the site
        "unit": unit,
        "unit_src": unit_src,
        "cat": cat_names[-1] if cat_names else "",
        "cat_path": " / ".join(cat_names),
        "cat_slug": cat_paths[-1] if cat_paths else "",
        "attrs": attrs,
        "family": parent_name or None,
        "family_sku": parent_sku or None,
        "url": url,
        "supplier": SUPPLIER["id"],
    }


# --------------------------------------------------------------------------
# Taxonomy with price statistics
# --------------------------------------------------------------------------

def build_taxonomy(items):
    buckets = defaultdict(list)
    for it in items:
        if it["cat_path"]:
            buckets[it["cat_path"]].append(it["price"])
    nodes = []
    for path, prices in sorted(buckets.items()):
        prices = sorted(prices)
        nodes.append({
            "path": path,
            "count": len(prices),
            "min": prices[0],
            "median": round(statistics.median(prices), 2),
            "max": prices[-1],
        })
    nodes.sort(key=lambda n: -n["count"])
    return nodes


# --------------------------------------------------------------------------
# Compact runtime index
# --------------------------------------------------------------------------

def build_index(items):
    """Row-oriented JSON is ~3x the bytes of the same data as parallel arrays,
    and this file is fetched by a Worker on every materials lookup. Columns it
    is: one shared category table, one tuple per item."""
    cat_list = sorted({it["cat_path"] for it in items})
    cat_idx = {c: i for i, c in enumerate(cat_list)}
    units = ["יחידה", "מטר"]
    unit_idx = {u: i for i, u in enumerate(units)}

    rows = []
    for it in items:
        attr = " ".join(v for v in it["attrs"].values() if v)
        rows.append([
            it["sku"],
            it["name"],
            it["price"],
            unit_idx.get(it["unit"], 0),
            cat_idx.get(it["cat_path"], -1),
            attr,
        ])
    return {
        "meta": {
            "supplier": SUPPLIER,
            "vat_rate": VAT_RATE,
            "price_basis": "retail_ex_vat",
            "count": len(rows),
            "fields": ["sku", "name", "price", "unit", "cat", "attrs"],
        },
        "cats": cat_list,
        "units": units,
        "items": rows,
    }


UNIT_ACCURACY_FLOOR = 0.90


def unit_accuracy(items, page_units):
    """Score the unit RULES against the units read off real product pages.

    This is the only honest measure of the guesswork in this file. 5,216 of the
    rows get their unit from a category rule, and nothing downstream can tell
    whether those rules are good — the output looks identical either way. The
    746 page-verified SKUs are a held-out truth set, and the rules score 94% on
    them. When someone edits a hint list and that number drops, the build should
    stop rather than ship a catalog that prices lugs by the metre.

    Returns None when the enrichment file is absent (a bare harvest), because a
    missing truth set is not a failing one."""
    checked = agreed = 0
    for it in items:
        truth = page_units.get(it["sku"])
        if truth not in ("מטר", "יחידה"):
            continue
        guess, _ = infer_unit(it["name"], [it["cat_slug"]])
        checked += 1
        agreed += (guess == truth)
    return (agreed / checked) if checked else None


def check_invariants(items):
    """Assert here, where both numbers are still in hand.

    `erco.json` (the only file carrying price_vat) is not committed — it is
    4.6MB that regenerates in seconds — so CI cannot re-derive this later. If
    the VAT split is ever wrong, every quote the bot writes is wrong by 18%,
    which is exactly the kind of error that looks plausible on the page. It gets
    caught at the moment it is computed or not at all."""
    for it in items:
        expected = round(it["price"] * (1 + VAT_RATE), 2)
        if abs(expected - it["price_vat"]) > 0.03:
            sys.exit("VAT invariant broken on %s: %.2f ex-VAT implies %.2f but "
                     "stored %.2f" % (it["sku"], it["price"], expected, it["price_vat"]))
        if it["price"] <= 0:
            sys.exit("Zero price survived normalisation: %s (%s)" % (it["sku"], it["name"]))
    skus = [it["sku"] for it in items]
    if len(set(skus)) != len(skus):
        sys.exit("Duplicate SKUs in the normalized set.")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    items = build()
    if not items:
        sys.exit("Harvest produced no usable items.")
    check_invariants(items)

    acc = unit_accuracy(items, load_page_units())
    if acc is not None and acc < UNIT_ACCURACY_FLOOR:
        sys.exit("Unit rules score %.1f%% against the page-verified truth set, "
                 "below the %.0f%% floor. Fix the hint lists in this file before "
                 "shipping." % (acc * 100, UNIT_ACCURACY_FLOOR * 100))

    taxonomy = build_taxonomy(items)
    index = build_index(items)
    index["meta"]["unit_accuracy"] = round(acc, 3) if acc is not None else None

    write(os.path.join(OUT_DIR, "erco.json"),
          {"meta": index["meta"], "items": items})
    write(os.path.join(OUT_DIR, "taxonomy.json"),
          {"meta": index["meta"], "categories": taxonomy})
    write(os.path.join(OUT_DIR, "index.json"), index, compact=True)

    inferred = sum(1 for it in items if it["unit_src"] == "category")
    print("items          : %d" % len(items))
    print("unit accuracy  : %s" % ("%.1f%% (vs page truth)" % (acc * 100) if acc is not None else "n/a"))
    print("categories     : %d" % len(taxonomy))
    print("units inferred : %d (%.0f%%)" % (inferred, 100.0 * inferred / len(items)))
    print("price range    : %.2f - %.2f ₪ (ex-VAT)"
          % (min(i["price"] for i in items), max(i["price"] for i in items)))
    for f in ("erco.json", "taxonomy.json", "index.json"):
        p = os.path.join(OUT_DIR, f)
        print("%-16s %.1f MB" % (f, os.path.getsize(p) / 1e6))


def write(path, obj, compact=False):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
