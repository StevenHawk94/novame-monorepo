#!/usr/bin/env python3
"""
build-item-dictionary.py — generate packages/engine/src/items/dictionary.json
from the item-sheet keyword mapping.

Inputs (in apps/mobile/assets/memory items/):
  icon_keyword_mapping.csv           category,n,row,col,itemId,displayName,keywords
                                     (keywords are /-separated)
  keyword-conflicts-resolution.csv   keyword,winner_category,winner_item,...
                                     (2026-07-23 ruling: on a collision the
                                     winner keeps the keyword, everyone else
                                     drops it)

Keywords are normalized exactly like the matcher's tokenizer ([a-z0-9']+
joined by single spaces) so hyphenated brands ("chick-fil-a") match the
token stream. Multi-word phrases need no special handling here — the matcher
tries longest phrases first and consumes their tokens (rule 6), so "electric
guitar" can never double-match "guitar".

Run from the repo root:
  python3 tools/build-item-dictionary.py
"""
import csv
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "apps/mobile/assets/memory items")
OUT = os.path.join(ROOT, "packages/engine/src/items/dictionary.json")

# category -> (item id prefix, sprite sheet id). Sheet ids are the webp
# basenames in apps/mobile/assets/items/ (kebab-case: Metro chokes on spaces).
CATEGORIES = {
    "Food & Drinks": ("food", "food-drinks-01"),
    "Sports & Fitness": ("sports", "sports-fitness-01"),
    "Entertainment & Games": ("entertainment", "entertainment-games-01"),
    "Relaxation & Leisure": ("relax", "relaxation-leisure-01"),
    "Personal Belongings": ("belongings", "personal-belongings-01"),
    "Music": ("music", "music-01"),
    "Plants & Gardening": ("plants", "plants-gardening-01"),
    "Professions": ("professions", "professions-01"),
    "Work Activities": ("work", "work-activities-01"),
    "Places & Buildings": ("places", "places-buildings-01"),
    "Transportation": ("transport", "transportation-01"),
    "Animals & Pets": ("animals", "animals-pets-01"),
    "Clothing & Accessories": ("clothing", "clothing-accessories-01"),
    "Beauty & Personal Care": ("beauty", "beauty-care-01"),
    "Home Appliances": ("appliances", "home-appliances-01"),
    "Kitchen & Cooking": ("kitchen", "kitchen-cooking-01"),
    "Emotions & Mental States": ("emotions", "emotions-01"),
    "Health & Medical": ("health", "health-medical-01"),
    "Daily Routines & Chores": ("routines", "daily-routines-01"),
    "Home & Furniture": ("home", "home-furniture-01"),
    "Shopping, Money & Services": ("shopping", "shopping-services-01"),
    "Celebrations & Life Events": ("celebrations", "celebrations-01"),
    "Nature, Weather & Seasons": ("nature", "nature-seasons-01"),
}


def norm(phrase: str) -> str:
    """Tokenizer-equivalent normalization."""
    phrase = phrase.strip().lower().replace("’", "'")
    return " ".join(re.findall(r"[a-z0-9']+", phrase))


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return s


def main() -> int:
    rows = list(csv.DictReader(open(os.path.join(ASSETS, "icon_keyword_mapping.csv"))))

    # keyword -> (category, displayName) allowed to keep it
    winners = {}
    res_path = os.path.join(ASSETS, "keyword-conflicts-resolution.csv")
    for r in csv.DictReader(open(res_path)):
        winners[norm(r["keyword"])] = (r["winner_category"], r["winner_item"])

    items = {}
    synonyms = {}
    for r in rows:
        cat = r["category"]
        if cat not in CATEGORIES:
            print(f"ERROR unknown category: {cat}")
            return 1
        prefix, sheet_id = CATEGORIES[cat]
        item_id = f"{prefix}.{slug(r['displayName'])}"
        if item_id in items:
            print(f"ERROR duplicate item id: {item_id}")
            return 1
        items[item_id] = {
            "displayName": r["displayName"].strip(),
            "rarity": "common",
            "category": prefix,
            "sheetId": sheet_id,
            "row": int(r["row"]),
            "col": int(r["col"]),
        }
        for kw in r["keywords"].split("/"):
            nk = norm(kw)
            if not nk:
                continue
            win = winners.get(nk)
            if win is not None and win != (cat, r["displayName"].strip()):
                continue  # this item lost the keyword
            prev = synonyms.get(nk)
            if prev is not None and prev != item_id:
                print(f"ERROR unresolved collision: {nk!r} -> {prev} vs {item_id}")
                return 1
            synonyms[nk] = item_id

    # Every winner must actually exist and hold its keyword.
    for nk, (wc, wn) in winners.items():
        want = f"{CATEGORIES[wc][0]}.{slug(wn)}"
        if synonyms.get(nk) != want:
            print(f"ERROR winner not applied: {nk!r} -> {synonyms.get(nk)} (want {want})")
            return 1

    out = {"items": items, "synonyms": synonyms}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    print(f"{len(items)} items, {len(synonyms)} synonyms -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
