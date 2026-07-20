import unittest
from datetime import date

from meal_helper.config import HISTORY_WORKBOOK
from meal_helper.workbook import infer_category, parse_sheet_date, read_historical_meals


class WorkbookTests(unittest.TestCase):
    def test_parses_compact_sheet_dates(self):
        self.assertEqual(parse_sheet_date("71726"), date(2026, 7, 17))
        self.assertEqual(parse_sheet_date("2162024"), date(2024, 2, 16))
        self.assertEqual(parse_sheet_date("122720"), date(2020, 12, 27))
        self.assertIsNone(parse_sheet_date("Go to Recipes"))
        self.assertIsNone(parse_sheet_date("Sheet34"))

    @unittest.skipUnless(HISTORY_WORKBOOK.exists(), "proprietary history workbook is not present")
    def test_reads_only_dated_history_sheets(self):
        meals = read_historical_meals(HISTORY_WORKBOOK)
        self.assertGreater(len(meals), 800)
        names = {meal.recipe_name for meal in meals}
        self.assertIn("Gojuchang roasted tofu and eggplant", names)
        self.assertNotIn("sesame oil", names)
        self.assertTrue(all(meal.week_start.weekday() == 0 for meal in meals))

    def test_infers_requested_categories(self):
        self.assertEqual(infer_category("Chicken noodle soup"), "soups_stews")
        self.assertEqual(infer_category("Spaghetti bolognese"), "pastas")
        self.assertEqual(infer_category("Cumin roasted salmon"), "oven_roasted")


if __name__ == "__main__":
    unittest.main()
