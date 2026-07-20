#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from meal_helper.ingredient_import import build_ingredient_candidates  # noqa: E402
from meal_helper.workbook import read_historical_orders  # noqa: E402


def write_candidates(path: Path, candidates) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        writer.writerow(
            (
                "name",
                "include",
                "default_unit",
                "order_weeks",
                "whole_foods_weeks",
                "elsewhere_weeks",
                "whole_foods",
                "source_confidence",
                "source_review",
                "examples",
            )
        )
        for candidate in candidates:
            writer.writerow(
                (
                    candidate.name,
                    1,
                    candidate.default_unit,
                    candidate.order_weeks,
                    candidate.whole_foods_weeks,
                    candidate.elsewhere_weeks,
                    int(candidate.whole_foods),
                    f"{candidate.source_confidence:.3f}",
                    "review" if candidate.source_confidence < 0.75 else "",
                    " | ".join(candidate.examples),
                )
            )


def write_unmatched(path: Path, unmatched) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        writer.writerow(
            ("raw_text", "order_weeks", "whole_foods_weeks", "elsewhere_weeks")
        )
        for item in unmatched:
            writer.writerow(
                (
                    item.raw_text,
                    item.order_weeks,
                    item.whole_foods_weeks,
                    item.elsewhere_weeks,
                )
            )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a reviewable ingredient catalog from the private order workbook."
    )
    parser.add_argument("--workbook", type=Path, default=ROOT_DIR / "meals_history.xlsx")
    parser.add_argument(
        "--output", type=Path, default=ROOT_DIR / "data" / "ingredient_candidates.csv"
    )
    parser.add_argument(
        "--unmatched-output",
        type=Path,
        default=ROOT_DIR / "data" / "ingredient_unmatched.csv",
    )
    parser.add_argument("--min-weeks", type=int, default=10)
    args = parser.parse_args()

    orders = read_historical_orders(args.workbook)
    candidates, unmatched, coverage = build_ingredient_candidates(orders, args.min_weeks)
    write_candidates(args.output, candidates)
    write_unmatched(args.unmatched_output, unmatched)

    print(f"Read {len(orders):,} historical order cells.")
    print(f"Produced {len(candidates):,} ingredient candidates.")
    print(f"Matched {coverage:.1%} of order cells to at least one cooking ingredient.")
    print(f"Candidate report: {args.output}")
    print(f"Unmatched review report: {args.unmatched_output}")


if __name__ == "__main__":
    main()
