import sqlite3
import tempfile
import unittest
from pathlib import Path

from meal_helper.database import Database
from meal_helper.service import MealService, ServiceError


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.temp_directory.name) / "test.sqlite3")
        self.database.initialize()
        with self.database.transaction() as connection:
            for category in ("soups_stews", "pastas", "oven_roasted"):
                for number in range(4):
                    connection.execute(
                        "INSERT INTO recipes(name, category) VALUES (?, ?)",
                        (f"{category} recipe {number}", category),
                    )
        self.service = MealService(self.database)

    def tearDown(self):
        self.temp_directory.cleanup()

    def test_proposal_uses_configured_category_counts(self):
        week = self.service.get_week("2026-07-22")
        self.assertEqual(week["week_start"], "2026-07-20")
        self.assertEqual(len(week["items"]), 9)
        for category in week["categories"]:
            self.assertEqual(sum(item["category"] == category for item in week["items"]), 3)

    def test_lock_requires_exactly_three_meals(self):
        week = self.service.get_week("2026-07-20")
        with self.assertRaises(ServiceError):
            self.service.lock_week(week["week_start"])

        for item in week["items"][:3]:
            week = self.service.set_decision(item["weekly_recipe_id"], "accepted")
        locked = self.service.lock_week(week["week_start"])
        self.assertTrue(locked["locked"])
        with self.assertRaises(ServiceError):
            self.service.set_decision(week["items"][3]["weekly_recipe_id"], "rejected")

    def test_shopping_list_combines_quantities_and_sources(self):
        week = self.service.get_week("2026-07-20")
        whole_foods = self.service.create_ingredient(
            {"name": "Broccoli", "default_unit": "lbs", "whole_foods": True}
        )
        elsewhere = self.service.create_ingredient(
            {"name": "Chicken from butcher", "default_unit": "lbs", "whole_foods": False}
        )
        accepted = week["items"][:3]
        for index, item in enumerate(accepted):
            recipe = self.service.get_recipe(item["id"])
            ingredients = [{"id": whole_foods["id"], "quantity": 1, "unit": "lbs"}]
            if index == 0:
                ingredients.append({"id": elsewhere["id"], "quantity": 2, "unit": "lbs"})
            self.service.update_recipe(
                item["id"],
                {
                    "name": recipe["name"],
                    "category": recipe["category"],
                    "url": recipe["url"],
                    "ingredients": ingredients,
                },
            )
            week = self.service.set_decision(item["weekly_recipe_id"], "accepted")

        self.assertEqual(week["shopping"]["whole_foods"][0]["quantity"], 3)
        self.assertEqual(week["shopping"]["elsewhere"][0]["quantity"], 2)

    def test_delete_recipe_function_is_available_for_unused_recipes(self):
        recipe = self.service.create_recipe(
            {"name": "Temporary recipe", "category": "pastas", "ingredients": []}
        )
        self.assertTrue(self.database.delete_recipe(recipe["id"]))
        with self.assertRaises(ServiceError):
            self.service.get_recipe(recipe["id"])

    def test_recipe_instructions_are_editable_and_included_in_week(self):
        recipe = self.service.create_recipe(
            {
                "name": "Recipe with notes",
                "category": "pastas",
                "url": "https://example.com/recipe",
                "instructions": "Boil, drain, and finish in the sauce.",
                "ingredients": [],
            }
        )
        self.assertEqual(recipe["instructions"], "Boil, drain, and finish in the sauce.")

        updated = self.service.update_recipe(
            recipe["id"],
            {
                "name": recipe["name"],
                "category": recipe["category"],
                "url": recipe["url"],
                "instructions": "Cook until just tender.",
                "ingredients": [],
            },
        )
        self.assertEqual(updated["instructions"], "Cook until just tender.")

        week = self.service.add_recipe_to_week("2026-08-03", recipe["id"])
        week_recipe = next(item for item in week["items"] if item["id"] == recipe["id"])
        self.assertEqual(week_recipe["instructions"], "Cook until just tender.")

    def test_archive_recipe_removes_it_from_library_and_unlocked_weeks(self):
        recipe = self.service.create_recipe(
            {"name": "Discard this recipe", "category": "pastas", "ingredients": []}
        )
        week = self.service.add_recipe_to_week("2026-08-03", recipe["id"])
        self.assertIn(recipe["id"], [item["id"] for item in week["items"]])

        self.assertEqual(self.service.archive_recipe(recipe["id"]), {"deleted": True})
        self.assertNotIn(recipe["id"], [item["id"] for item in self.service.list_recipes()])
        with self.assertRaises(ServiceError):
            self.service.get_recipe(recipe["id"])
        week = self.service.get_week("2026-08-03")
        self.assertNotIn(recipe["id"], [item["id"] for item in week["items"]])

    def test_archive_recipe_preserves_locked_history(self):
        week = self.service.get_week("2026-07-20")
        archived_id = week["items"][0]["id"]
        for item in week["items"][:3]:
            week = self.service.set_decision(item["weekly_recipe_id"], "accepted")
        self.service.lock_week(week["week_start"])

        self.service.archive_recipe(archived_id)

        historical_week = self.service.get_week("2026-07-20")
        self.assertIn(archived_id, [item["id"] for item in historical_week["items"]])


class DatabaseMigrationTests(unittest.TestCase):
    def test_initialize_adds_recipe_columns_to_an_existing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            with sqlite3.connect(path) as connection:
                connection.execute(
                    """
                    CREATE TABLE recipes (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                        category TEXT NOT NULL,
                        url TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO recipes(name, category) VALUES ('Existing recipe', 'pastas')"
                )

            database = Database(path)
            database.initialize()

            with database.transaction() as connection:
                columns = {
                    row["name"] for row in connection.execute("PRAGMA table_info(recipes)")
                }
                recipe = connection.execute(
                    "SELECT name, instructions, archived_at FROM recipes"
                ).fetchone()
            self.assertIn("instructions", columns)
            self.assertIn("archived_at", columns)
            self.assertEqual(recipe["name"], "Existing recipe")
            self.assertIsNone(recipe["instructions"])
            self.assertIsNone(recipe["archived_at"])


if __name__ == "__main__":
    unittest.main()
