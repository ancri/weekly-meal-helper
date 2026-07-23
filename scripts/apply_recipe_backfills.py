#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from meal_helper.config import ALLOWED_UNITS  # noqa: E402
from meal_helper.database import Database, utc_now  # noqa: E402


def _name(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required.")
    return " ".join(value.split())


def _validated_payload(value: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(value, dict):
        raise ValueError("Backfill input must be a JSON object.")
    ingredients = value.get("ingredients", [])
    recipes = value.get("recipes")
    if not isinstance(ingredients, list) or not isinstance(recipes, list):
        raise ValueError("Backfill input needs ingredient and recipe lists.")

    cleaned_ingredients: list[dict[str, Any]] = []
    ingredient_names: set[str] = set()
    for item in ingredients:
        if not isinstance(item, dict):
            raise ValueError("Each catalog ingredient must be an object.")
        name = _name(item.get("name"), "Catalog ingredient name")
        key = name.casefold()
        if key in ingredient_names:
            raise ValueError(f"Duplicate catalog ingredient: {name}.")
        unit = item.get("default_unit")
        if unit not in ALLOWED_UNITS:
            raise ValueError(f"Invalid default unit for {name}.")
        ingredient_names.add(key)
        cleaned_ingredients.append(
            {
                "name": name,
                "default_unit": unit,
                "whole_foods": bool(item.get("whole_foods", True)),
            }
        )

    cleaned_recipes: list[dict[str, Any]] = []
    recipe_names: set[str] = set()
    for recipe in recipes:
        if not isinstance(recipe, dict):
            raise ValueError("Each recipe backfill must be an object.")
        recipe_name = _name(recipe.get("name"), "Recipe name")
        recipe_key = recipe_name.casefold()
        if recipe_key in recipe_names:
            raise ValueError(f"Duplicate recipe backfill: {recipe_name}.")
        items = recipe.get("ingredients")
        if not isinstance(items, list) or not items:
            raise ValueError(f"{recipe_name} needs at least one ingredient.")
        cleaned_items: list[dict[str, Any]] = []
        used_names: set[str] = set()
        for item in items:
            if not isinstance(item, dict):
                raise ValueError(f"{recipe_name} has an invalid ingredient.")
            name = _name(item.get("name"), f"Ingredient name for {recipe_name}")
            key = name.casefold()
            if key in used_names:
                raise ValueError(f"{recipe_name} contains {name} more than once.")
            quantity = item.get("quantity")
            if (
                isinstance(quantity, bool)
                or not isinstance(quantity, (int, float))
                or not math.isfinite(float(quantity))
                or float(quantity) <= 0
            ):
                raise ValueError(f"{recipe_name} has an invalid quantity for {name}.")
            unit = item.get("unit")
            if unit not in ALLOWED_UNITS:
                raise ValueError(f"{recipe_name} has an invalid unit for {name}.")
            used_names.add(key)
            cleaned_items.append(
                {"name": name, "quantity": float(quantity), "unit": unit}
            )
        recipe_names.add(recipe_key)
        cleaned_recipes.append({"name": recipe_name, "ingredients": cleaned_items})

    return cleaned_ingredients, cleaned_recipes


def apply_backfills(
    database: Database, payload: Any, apply: bool = False
) -> dict[str, Any]:
    catalog_items, recipe_items = _validated_payload(payload)
    summary: dict[str, Any] = {
        "applied": apply,
        "ingredients_to_create": 0,
        "recipes_to_fill": 0,
        "recipes_already_populated": 0,
        "recipes_missing": [],
        "ingredients_missing": [],
    }

    with database.transaction() as connection:
        existing_catalog = {
            row["name"].casefold(): dict(row)
            for row in connection.execute(
                "SELECT id, name, default_unit, whole_foods FROM ingredients"
            )
        }
        for item in catalog_items:
            key = item["name"].casefold()
            if key in existing_catalog:
                continue
            summary["ingredients_to_create"] += 1
            if apply:
                cursor = connection.execute(
                    """
                    INSERT INTO ingredients(name, default_unit, whole_foods, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        item["name"],
                        item["default_unit"],
                        int(item["whole_foods"]),
                        utc_now(),
                    ),
                )
                existing_catalog[key] = item | {"id": cursor.lastrowid}
            else:
                existing_catalog[key] = item | {"id": None}

        for recipe in recipe_items:
            row = connection.execute(
                """
                SELECT r.id, COUNT(ri.ingredient_id) AS ingredient_count
                FROM recipes r
                LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                WHERE r.name = ? COLLATE NOCASE AND r.archived_at IS NULL
                GROUP BY r.id
                """,
                (recipe["name"],),
            ).fetchone()
            if row is None:
                summary["recipes_missing"].append(recipe["name"])
                continue
            if row["ingredient_count"]:
                summary["recipes_already_populated"] += 1
                continue

            missing = [
                item["name"]
                for item in recipe["ingredients"]
                if item["name"].casefold() not in existing_catalog
            ]
            if missing:
                summary["ingredients_missing"].extend(missing)
                continue

            summary["recipes_to_fill"] += 1
            if apply:
                connection.executemany(
                    """
                    INSERT INTO recipe_ingredients
                        (recipe_id, ingredient_id, quantity, unit)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        (
                            row["id"],
                            existing_catalog[item["name"].casefold()]["id"],
                            item["quantity"],
                            item["unit"],
                        )
                        for item in recipe["ingredients"]
                    ),
                )
                connection.execute(
                    "UPDATE recipes SET updated_at = ? WHERE id = ?",
                    (utc_now(), row["id"]),
                )

        if apply and (
            summary["recipes_missing"] or summary["ingredients_missing"]
        ):
            raise ValueError(
                "Backfill aborted because an expected recipe or ingredient is missing."
            )

    summary["recipes_missing"].sort(key=str.casefold)
    summary["ingredients_missing"] = sorted(
        set(summary["ingredients_missing"]), key=str.casefold
    )
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fill empty recipes from a reviewed private JSON mapping."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    database = Database(args.database)
    database.initialize()
    summary = apply_backfills(database, payload, apply=args.apply)
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
