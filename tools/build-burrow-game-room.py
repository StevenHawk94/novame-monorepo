"""Import the supplied 70-game workbook as versioned API content."""

import json
import re
import sys
from pathlib import Path

from openpyxl import load_workbook


SOURCE = Path(sys.argv[1])
DESTINATION = Path(__file__).resolve().parents[1] / "apps/api/src/data/burrow-game-room-v1.json"


def slug(value):
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


workbook = load_workbook(SOURCE, read_only=True, data_only=True)
sheet = workbook["All Questions"]
rows = list(sheet.values)
headers = rows[0]
games = {}
categories = []
for raw in rows[1:]:
    row = dict(zip(headers, raw))
    category = str(row["Category"]).strip()
    number = int(row["Game #"])
    title = str(row["Game"]).strip()
    if category not in categories:
        categories.append(category)
    game_id = f"{slug(category)}_{number:02d}"
    game = games.setdefault(game_id, {
        "id": game_id,
        "category": category,
        "categoryId": slug(category),
        "number": number,
        "title": title,
        "spicy": str(row["Spicy"] or "—").strip(),
        "hook": str(row["Hook"] or "").strip(),
        "questions": [],
    })
    assert game["category"] == category and game["title"] == title
    assert int(row["Q#"]) == len(game["questions"]) + 1, game_id
    question = {
        "self": str(row["Question (self)"]).strip(),
        "partner": str(row["Question (partner)"]).strip(),
        "options": [str(row[key]).strip() for key in ("A", "B", "C", "D")],
    }
    assert question["self"] and question["partner"] and all(question["options"]), game_id
    game["questions"].append(question)

assert len(categories) == 7 and len(games) == 70
assert all(sum(game["category"] == category for game in games.values()) == 10 for category in categories)
assert all(len(game["questions"]) == 6 for game in games.values())
overview = list(workbook["Game Overview"].values)
for raw in overview[1:]:
    row = dict(zip(overview[0], raw))
    if row["Category"] not in categories or not row["Game #"]:
        continue
    game = games[f"{slug(str(row['Category']))}_{int(row['Game #']):02d}"]
    assert game["title"] == str(row["Game"]).strip()
    assert game["hook"] == str(row["Hook"] or "").strip()
    assert game["spicy"] == str(row["Spicy"] or "—").strip()
    assert int(row["Questions"]) == 6 and int(row["Options / Q"]) == 4
payload = {"version": 1, "categories": categories, "games": list(games.values())}
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
DESTINATION.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Imported {len(games)} games and {sum(len(game['questions']) for game in games.values())} questions to {DESTINATION}")
