import tempfile
import unittest
from pathlib import Path

from meal_helper.database import Database
from meal_helper.service import MealService
from scripts.apply_recipe_backfills import apply_backfills


class RecipeBackfillTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.directory.name) / "backfill.sqlite3")
        self.database.initialize()
        self.service = MealService(self.database)
        self.garlic = self.service.create_ingredient(
            {"name": "Garlic", "default_unit": "cloves", "whole_foods": True}
        )
        self.recipe = self.service.create_recipe(
            {"name": "Gochujang garlic tofu", "category": "oven_roasted", "ingredients": []}
        )
        self.payload = {
            "ingredients": [
                {
                    "name": "Gochujang",
                    "default_unit": "tbsp",
                    "whole_foods": True,
                }
            ],
            "recipes": [
                {
                    "name": self.recipe["name"],
                    "ingredients": [
                        {"name": "Garlic", "quantity": 3, "unit": "cloves"},
                        {"name": "Gochujang", "quantity": 2, "unit": "tbsp"},
                    ],
                }
            ],
        }

    def tearDown(self):
        self.directory.cleanup()

    def test_dry_run_reports_without_changing_database(self):
        summary = apply_backfills(self.database, self.payload)

        self.assertFalse(summary["applied"])
        self.assertEqual(summary["ingredients_to_create"], 1)
        self.assertEqual(summary["recipes_to_fill"], 1)
        self.assertEqual(self.service.get_recipe(self.recipe["id"])["ingredients"], [])
        self.assertNotIn(
            "Gochujang",
            [ingredient["name"] for ingredient in self.service.list_ingredients()],
        )

    def test_apply_creates_catalog_item_and_only_fills_empty_recipe_once(self):
        first = apply_backfills(self.database, self.payload, apply=True)
        second = apply_backfills(self.database, self.payload, apply=True)

        self.assertEqual(first["ingredients_to_create"], 1)
        self.assertEqual(first["recipes_to_fill"], 1)
        self.assertEqual(second["ingredients_to_create"], 0)
        self.assertEqual(second["recipes_to_fill"], 0)
        self.assertEqual(second["recipes_already_populated"], 1)
        ingredients = self.service.get_recipe(self.recipe["id"])["ingredients"]
        self.assertEqual(
            {ingredient["name"] for ingredient in ingredients},
            {"Garlic", "Gochujang"},
        )

    def test_apply_rolls_back_when_an_expected_recipe_is_missing(self):
        payload = {
            **self.payload,
            "recipes": [
                *self.payload["recipes"],
                {
                    "name": "Missing recipe",
                    "ingredients": [
                        {"name": "Garlic", "quantity": 1, "unit": "cloves"}
                    ],
                },
            ],
        }

        with self.assertRaisesRegex(ValueError, "Backfill aborted"):
            apply_backfills(self.database, payload, apply=True)

        self.assertEqual(self.service.get_recipe(self.recipe["id"])["ingredients"], [])
        self.assertNotIn(
            "Gochujang",
            [ingredient["name"] for ingredient in self.service.list_ingredients()],
        )


if __name__ == "__main__":
    unittest.main()
