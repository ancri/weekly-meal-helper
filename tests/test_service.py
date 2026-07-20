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


if __name__ == "__main__":
    unittest.main()
