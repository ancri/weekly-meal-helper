#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from meal_helper.config import ALLOWED_UNITS  # noqa: E402
from meal_helper.database import Database  # noqa: E402


TRUE_VALUES = {"1", "true", "yes", "y"}


def read_candidates(path: Path) -> list[tuple[str, str, bool]]:
    candidates = []
    names = set()
    with path.open(newline="", encoding="utf-8") as source:
        for line, row in enumerate(csv.DictReader(source), start=2):
            if row.get("include", "1").strip().casefold() not in TRUE_VALUES:
                continue
            name = " ".join(row.get("name", "").split())
            unit = row.get("default_unit", "").strip()
            whole_foods = row.get("whole_foods", "").strip().casefold() in TRUE_VALUES
            if not name:
                raise ValueError(f"Candidate row {line} has no name.")
            if name.casefold() in names:
                raise ValueError(f"Candidate row {line} duplicates {name!r}.")
            if unit not in ALLOWED_UNITS:
                raise ValueError(f"Candidate row {line} has unsupported unit {unit!r}.")
            names.add(name.casefold())
            candidates.append((name, unit, whole_foods))
    return candidates


def compare_with_database(
    database: Database, candidates: list[tuple[str, str, bool]], apply: bool
) -> tuple[int, int, int]:
    inserted = 0
    unchanged = 0
    conflicts = 0
    database.initialize()
    with database.transaction() as connection:
        for name, unit, whole_foods in candidates:
            existing = connection.execute(
                "SELECT name, default_unit, whole_foods FROM ingredients WHERE name = ? COLLATE NOCASE",
                (name,),
            ).fetchone()
            if existing is None:
                inserted += 1
                if apply:
                    connection.execute(
                        "INSERT INTO ingredients(name, default_unit, whole_foods) VALUES (?, ?, ?)",
                        (name, unit, int(whole_foods)),
                    )
            elif existing["default_unit"] == unit and bool(existing["whole_foods"]) == whole_foods:
                unchanged += 1
            else:
                conflicts += 1
                print(
                    f"Preserving existing {existing['name']!r}: "
                    f"{existing['default_unit']}, whole_foods={bool(existing['whole_foods'])}; "
                    f"candidate was {unit}, whole_foods={whole_foods}."
                )
        if not apply:
            connection.rollback()
    return inserted, unchanged, conflicts


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import a reviewed ingredient candidate CSV without overwriting manual entries."
    )
    parser.add_argument("candidates", type=Path)
    parser.add_argument("--database", type=Path, default=ROOT_DIR / "data" / "meal_helper.sqlite3")
    parser.add_argument("--apply", action="store_true", help="Commit inserts; otherwise dry-run.")
    args = parser.parse_args()

    candidates = read_candidates(args.candidates)
    inserted, unchanged, conflicts = compare_with_database(
        Database(args.database), candidates, args.apply
    )
    mode = "Applied" if args.apply else "Dry run"
    print(
        f"{mode}: {inserted} new, {unchanged} unchanged, {conflicts} preserved conflicts "
        f"from {len(candidates)} included candidates."
    )


if __name__ == "__main__":
    main()
