#!/usr/bin/env python3
"""
build-item-dictionary.py — generate packages/engine/src/items/dictionary.json
from the item-sheet keyword mapping.

Inputs (in tools/item-source/memory-items/):
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
ASSETS = os.path.join(ROOT, "tools/item-source/memory-items")
OUT = os.path.join(ROOT, "packages/engine/src/items/dictionary.json")
# DB catalog migration (see the note at the write site). Bump the filename when
# regenerating after the previous one has already been executed in Supabase.
SQL_OUT = os.path.join(ROOT, "supabase/migrations/20260723000026_items_full_catalog.sql")

# category -> (item id prefix, sprite sheet id). Sheet ids are the webp
# basenames in apps/mobile/assets/items/ (kebab-case: Metro chokes on spaces).
#
# 2026-07-24 taxonomy (14 categories, 460 items). The CSV is already updated;
# ⚠️ DO NOT RUN until the new sheet images land in tools/item-source/memory-items/ —
# regenerating now would point every item at grid cells that don't exist yet.
# When they land: normalize each sheet (--grid, rows=ceil(n/8)), run this,
# convert to webp, update ITEM_SHEETS in item-sprite.tsx, bump SQL_OUT's
# filename, and execute the new migration in Supabase.
# ('emotions' keeps its prefix but moves to sheet emotions-02 so the stale
# emotions-01.webp can never render the wrong art.)
CATEGORIES = {
    "Routine": ("routine", "routine-01"),
    "Chores": ("chores", "chores-01"),
    "Exercise": ("exercise", "exercise-01"),
    "Eating": ("eating", "eating-01"),
    "Hobby": ("hobby", "hobby-01"),
    "Relaxing": ("relaxing", "relaxing-01"),
    "Beauty": ("beauty", "beauty-01"),
    "Social": ("social", "social-01"),
    "Better Me": ("better_me", "better-me-01"),
    "Nature&Outdoor": ("outdoor", "nature-outdoor-01"),
    "Petting": ("petting", "petting-01"),
    "Gardening": ("gardening", "gardening-01"),
    "Emotions": ("emotions", "emotions-02"),
    "Health": ("health", "health-01"),
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

    # The DB-side catalog. public.items is the FK target of user_items /
    # item_memories and record_item_matches silently drops any id not in it --
    # the dictionary and this table MUST move together (2026-07-23 bug: the
    # table still held the 16-row C8 sample, so every new match was dropped
    # and Bags stayed empty).
    if SQL_OUT:
        def q(s):
            return "'" + s.replace("'", "''") + "'"
        lines = [
            "-- Full item catalog, GENERATED by tools/build-item-dictionary.py --",
            "-- keep in lockstep with packages/engine/src/items/dictionary.json.",
            "-- Upserts so re-running after a CSV edit is safe; stale ids keep",
            "-- their rows (old memories reference them by FK).",
            "insert into public.items (id, sheet_id, row, col, display_name, rarity, category) values",
        ]
        rows_sql = []
        for item_id in sorted(items):
            d = items[item_id]
            rows_sql.append(
                f"  ({q(item_id)}, {q(d['sheetId'])}, {d['row']}, {d['col']}, "
                f"{q(d['displayName'])}, {q(d['rarity'])}, {q(d['category'])})"
            )
        lines.append(",\n".join(rows_sql))
        lines.append(
            "on conflict (id) do update set\n"
            "  sheet_id = excluded.sheet_id, row = excluded.row, col = excluded.col,\n"
            "  display_name = excluded.display_name, rarity = excluded.rarity,\n"
            "  category = excluded.category;"
        )
        with open(SQL_OUT, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"{len(items)} catalog rows -> {SQL_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
