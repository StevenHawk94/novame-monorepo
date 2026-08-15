#!/usr/bin/env python3
"""Generate runtime item data from Icon_Mapping_Core_Tables_v19.xlsx."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "apps" / "mobile" / "assets" / "memory items"
WORKBOOK = SOURCE_DIR / "Icon_Mapping_Core_Tables_v19.xlsx"
DICTIONARY = ROOT / "packages" / "engine" / "src" / "items" / "dictionary.json"
IMAGE_MAP = ROOT / "apps" / "mobile" / "src" / "lib" / "item-images.g.ts"
GUIDED_CATALOG = ROOT / "apps" / "mobile" / "src" / "lib" / "guided-catalog.g.ts"
MIGRATION = ROOT / "supabase" / "migrations" / "20260815000041_items_v19_catalog.sql"
QA_PATH = SOURCE_DIR / "items-v19-data-qa.json"


CATEGORY_KEYS = {
    "Emotions & Feelings": "emotion_and_feeling",
    "Food & Drink": "food_drink",
    "Chores & Home Care": "chores_home_care",
    "Health & Self-Care": "self_care_hygiene",
    "Work & Productivity": "work_productivity",
    "Entertainment & Leisure": "entertainment_leisure",
    "Exercise & Movement": "exercise_movement",
    "Social & Relationships": "social_relationships",
    "Travel & Getting Around": "travel_commute",
    "Nature & Outdoors": "nature_outdoors",
    "Learning & Hobbies": "learning_hobbies",
    "Shopping & Errands": "shopping_errands",
}

# The workbook contains exactly 20 cross-icon executable keyword collisions.
# Product rule: one winner only, choosing the icon whose name/visual carrier is
# the most direct meaning of the keyword.
CONFLICT_WINNERS = {
    "dance club": "Dance Club",
    "fried egg": "Fried Egg",
    "scrambled eggs": "Scrambled Eggs",
    "boiled egg": "Hard-Boiled Egg",
    "avocado toast": "Avocado Toast",
    "toast with jam": "Jam Toast",
    "date fruit": "Date Fruit",
    "ultimate frisbee": "Frisbee",
    "played ultimate": "Frisbee",
    "vet appointment": "Veterinary Clinic",
    "cocktail bar": "Cocktail Bar",
    "cruise port": "Cruise Terminal",
    "very tired": "Sleepy",
    "fatigued": "Sleepy",
    "felt shocked": "Neutral",
    "felt stunned": "Neutral",
    "surprised": "Surprised",
    "feeling surprised": "Surprised",
    "composed": "Neutral",
    "celebrating": "Celebrating",
}

# Four Keyword_Safety labels refer to retired names that are not present in
# Icon_Mapping v19. Route them to the closest concrete carrier that does exist.
ORPHAN_ICON_REMAP = {
    "Online Shopping": "Shopping",
    "Rideshare": "Car",
    "Slight Smile": "Neutral",
    "Streaming": "Video",
}

INSTRUCTIONAL_EXCLUSION = re.compile(
    r"\b(do not|don't|exclude|unless|require|only when|context|infer|meaning|usage|reference|refers?)\b",
    re.IGNORECASE,
)


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def normalize_phrase(value: object) -> str:
    text = str(value or "").strip().lower().replace("’", "'").replace("–", "-")
    return " ".join(re.findall(r"[a-z0-9']+", text))


def parse_literal_exclusions(value: object) -> tuple[list[str], str | None]:
    raw = str(value or "").strip()
    if not raw or raw == "17316":
        return [], None
    lowered = raw.lower()
    if lowered in {
        "no exclusion needed; direct health-object term.",
        "direct sacred-book term is safe.",
    }:
        return [], None
    if lowered == "direct sacred-book term is safe; exclude figurative 'bible of' only when clearly not an object mention.":
        return ["bible of"], None
    parts = [part.strip() for part in raw.split(";") if part.strip()]
    literals = []
    for part in parts:
        word_count = len(re.findall(r"[A-Za-z0-9']+", part))
        if word_count == 0 or word_count > 8 or INSTRUCTIONAL_EXCLUSION.search(part):
            return [], raw
        literals.append(normalize_phrase(part))
    return list(dict.fromkeys(literals)), None


def sql(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def main() -> None:
    workbook = load_workbook(WORKBOOK, read_only=True, data_only=True)

    icon_sheet = workbook["Icon_Mapping"]
    icon_rows = icon_sheet.iter_rows(values_only=True)
    icon_headers = next(icon_rows)
    icon_ix = {name: index for index, name in enumerate(icon_headers) if name}
    items_by_name = {}
    items_by_row = {}
    for row_number, row in enumerate(icon_rows, start=2):
        name = str(row[icon_ix["Icon_name"]]).strip()
        item_id = f"memory.{row_number:04d}_{slugify(name)}"
        keywords = [
            keyword.strip()
            for keyword in str(row[icon_ix["keywords_mapping"]] or "").split(";")
            if keyword.strip()
        ]
        item = {
            "id": item_id,
            "row_number": row_number,
            "displayName": name,
            "keywords": keywords,
            "visualConcept": str(row[icon_ix["visual_concept"]] or "").strip(),
            "category": str(row[icon_ix["Primary_Domain"]] or "Uncategorized").strip(),
            "tier": str(row[icon_ix["Tier"]] or "Tier 2").strip(),
        }
        items_by_name[name] = item
        items_by_row[row_number] = item
    if len(items_by_name) != 5390:
        raise ValueError(f"Expected 5390 icons, found {len(items_by_name)}")

    reflect_sheet = workbook["Reflect_Icon_Map"]
    reflect_rows = reflect_sheet.iter_rows(values_only=True)
    reflect_headers = next(reflect_rows)
    reflect_ix = {name: index for index, name in enumerate(reflect_headers)}
    reflect_by_name = {}
    category_items = defaultdict(list)
    for row in reflect_rows:
        name = str(row[reflect_ix["Icon_name"]]).strip()
        category = str(row[reflect_ix["Primary_Category"]]).strip()
        display_order = int(row[reflect_ix["Display_Order"]])
        frequency = str(row[reflect_ix["Frequency_Level"]]).strip()
        reflect_by_name[name] = {"category": category, "order": display_order, "frequency": frequency}
        category_items[category].append((display_order, items_by_name[name]["id"]))
    if len(reflect_by_name) != 5390:
        raise ValueError("Reflect_Icon_Map does not cover all icons")

    rarity_for_frequency = {"High": "common", "Medium": "common", "Low": "uncommon", "Rare": "rare"}
    runtime_items = {}
    for name, item in items_by_name.items():
        reflect = reflect_by_name[name]
        runtime_items[item["id"]] = {
            "displayName": name,
            "rarity": rarity_for_frequency[reflect["frequency"]],
            "category": reflect["category"],
            "bagsCategory": item["category"],
            "keywords": item["keywords"],
            "visualConcept": item["visualConcept"],
        }

    safety_sheet = workbook["Keyword_Safety"]
    safety_rows = safety_sheet.iter_rows(values_only=True)
    safety_headers = next(safety_rows)
    safety_ix = {name: index for index, name in enumerate(safety_headers) if name}
    candidates = defaultdict(list)
    never_auto = 0
    never_auto_keywords = set()
    unresolved_exclusions = []
    executable_rows = 0
    for excel_row, row in enumerate(safety_rows, start=2):
        source_name = str(row[safety_ix["Icon_name"]]).strip()
        name = ORPHAN_ICON_REMAP.get(source_name, source_name)
        if name not in items_by_name:
            raise ValueError(f"Keyword_Safety row {excel_row} references missing icon {source_name!r}")
        keyword = normalize_phrase(row[safety_ix["Keyword"]])
        mode = str(row[safety_ix["Trigger_Mode"]]).strip()
        if not keyword:
            continue
        if mode == "NEVER_AUTO":
            never_auto += 1
            never_auto_keywords.add(keyword)
            continue
        if mode not in {"AUTO", "AUTO_UNLESS_EXCLUDED"}:
            raise ValueError(f"Unknown Trigger_Mode at Keyword_Safety row {excel_row}: {mode}")
        exclusions = []
        if mode == "AUTO_UNLESS_EXCLUDED":
            exclusions, unresolved = parse_literal_exclusions(row[safety_ix["Exclusion_Rule"]])
            if unresolved:
                unresolved_exclusions.append({"row": excel_row, "icon": name, "keyword": keyword, "rule": unresolved})
        candidates[keyword].append({
            "name": name,
            "mode": mode,
            "exclusions": exclusions,
            "unsafe_instructional_exclusion": unresolved is not None if mode == "AUTO_UNLESS_EXCLUDED" else False,
        })
        executable_rows += 1

    cross_icon_conflicts = {
        keyword: sorted({candidate["name"] for candidate in options})
        for keyword, options in candidates.items()
        if len({candidate["name"] for candidate in options}) > 1
    }
    if set(cross_icon_conflicts) != set(CONFLICT_WINNERS):
        missing = sorted(set(cross_icon_conflicts) - set(CONFLICT_WINNERS))
        stale = sorted(set(CONFLICT_WINNERS) - set(cross_icon_conflicts))
        raise ValueError(f"Conflict winner table mismatch: missing={missing}, stale={stale}")

    synonyms = {}
    exclusions = {}
    conflict_report = []
    unsafe_keywords_omitted = []
    for keyword, options in sorted(candidates.items()):
        if keyword in never_auto_keywords:
            continue
        names = {option["name"] for option in options}
        winner_name = CONFLICT_WINNERS.get(keyword) if len(names) > 1 else next(iter(names))
        if winner_name not in names:
            raise ValueError(f"Invalid conflict winner for {keyword}: {winner_name} not in {sorted(names)}")
        winner_options = [
            option for option in options
            if option["name"] == winner_name and not option["unsafe_instructional_exclusion"]
        ]
        if len(names) > 1:
            conflict_report.append({
                "keyword": keyword,
                "candidates": sorted(names),
                "winner": winner_name,
                "auto_active": bool(winner_options),
            })
        if not winner_options:
            unsafe_keywords_omitted.append(keyword)
            continue
        synonyms[keyword] = items_by_name[winner_name]["id"]
        literal_exclusions = sorted({rule for option in winner_options for rule in option["exclusions"]})
        if literal_exclusions:
            exclusions[keyword] = literal_exclusions

    dictionary = {"items": runtime_items, "synonyms": synonyms, "exclusions": exclusions}
    DICTIONARY.write_text(json.dumps(dictionary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    image_lines = [
        "/**",
        " * GENERATED by tools/build-item-data-v19.py — DO NOT EDIT.",
        " * One bundled 256px WebP per v19 memory item (5,390 total).",
        " */",
        "",
        "export const ITEM_IMAGES: Record<string, number> = {",
    ]
    for row_number in sorted(items_by_row):
        item = items_by_row[row_number]
        image_lines.append(
            f"  {json.dumps(item['id'])}: require('../../assets/items/each/{item['id']}.webp'),"
        )
    image_lines.extend(["};", ""])
    IMAGE_MAP.write_text("\n".join(image_lines), encoding="utf-8")

    category_sheet = workbook["Reflect_Categories"]
    category_rows = category_sheet.iter_rows(values_only=True)
    category_headers = next(category_rows)
    category_ix = {name: index for index, name in enumerate(category_headers)}
    categories = []
    for row in category_rows:
        label = str(row[category_ix["Reflect_Category"]]).strip()
        if label not in CATEGORY_KEYS:
            raise ValueError(f"Missing stable category key for {label}")
        ordered_ids = [item_id for _, item_id in sorted(category_items[label])]
        categories.append({
            "order": int(row[category_ix["Category_Order"]]),
            "key": CATEGORY_KEYS[label],
            "label": label,
            "question": str(row[category_ix["Reflect_Question"]]).strip(),
            "itemIds": ordered_ids,
        })
    categories.sort(key=lambda category: category["order"])
    if len(categories) != 12 or sum(len(category["itemIds"]) for category in categories) != 5390:
        raise ValueError("Reflect category generation is incomplete")

    guided_lines = [
        "/** GENERATED by tools/build-item-data-v19.py — DO NOT EDIT. */",
        "export interface PromptCategoryDef { key: string; label: string; question: string; itemIds: string[] }",
        "",
        "export const PROMPT_CATEGORIES: PromptCategoryDef[] = [",
    ]
    for category in categories:
        guided_lines.append(
            "  { key: %s, label: %s, question: %s, itemIds: ["
            % (json.dumps(category["key"]), json.dumps(category["label"]), json.dumps(category["question"]))
        )
        guided_lines.extend(f"    {json.dumps(item_id)}," for item_id in category["itemIds"])
        guided_lines.append("  ] },")
    guided_lines.append("];")
    GUIDED_CATALOG.write_text("\n".join(guided_lines) + "\n", encoding="utf-8")

    migration_lines = [
        "-- Memory Items v19 catalog, GENERATED by tools/build-item-data-v19.py.",
        "-- Old rows remain so historical foreign-key references stay valid.",
        "insert into public.items (id, sheet_id, row, col, display_name, rarity, category) values",
    ]
    values = []
    for row_number in sorted(items_by_row):
        item = items_by_row[row_number]
        reflect = reflect_by_name[item["displayName"]]
        page_start = 2 + ((row_number - 2) // 49) * 49
        page_end = page_start + 48
        offset = row_number - page_start
        values.append(
            "  (%s, %s, %d, %d, %s, %s, %s)"
            % (
                sql(item["id"]), sql(f"v19-{page_start}-{page_end}"), offset // 7, offset % 7,
                sql(item["displayName"]), sql(rarity_for_frequency[reflect["frequency"]]),
                sql(reflect["category"]),
            )
        )
    migration_lines.append(",\n".join(values))
    migration_lines.extend([
        "on conflict (id) do update set",
        "  sheet_id = excluded.sheet_id, row = excluded.row, col = excluded.col,",
        "  display_name = excluded.display_name, rarity = excluded.rarity, category = excluded.category;",
        "",
    ])
    MIGRATION.write_text("\n".join(migration_lines), encoding="utf-8")

    qa = {
        "schema": "memory-items-v19-data-qa@1",
        "items": len(runtime_items),
        "executable_keyword_rows": executable_rows,
        "unique_executable_keywords": len(synonyms),
        "never_auto_rows_omitted": never_auto,
        "never_auto_unique_keywords": len(never_auto_keywords),
        "never_auto_keywords_overriding_auto_rows": sorted(never_auto_keywords & set(candidates)),
        "auto_unless_excluded_keywords_with_literal_rules": len(exclusions),
        "unresolved_instructional_exclusions": len(unresolved_exclusions),
        "unsafe_auto_unless_excluded_keywords_omitted": len(unsafe_keywords_omitted),
        "unsafe_keyword_samples": unsafe_keywords_omitted[:100],
        "unresolved_instructional_exclusion_samples": unresolved_exclusions[:100],
        "cross_icon_conflicts": conflict_report,
        "reflect_categories": [
            {"order": category["order"], "key": category["key"], "label": category["label"], "items": len(category["itemIds"])}
            for category in categories
        ],
    }
    QA_PATH.write_text(json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(runtime_items)} items, {len(synonyms)} executable keywords, {len(categories)} categories")
    print(f"resolved {len(conflict_report)} cross-icon keyword conflicts")
    print(f"literal exclusion maps: {len(exclusions)}; instructional exclusions flagged: {len(unresolved_exclusions)}")


if __name__ == "__main__":
    main()
