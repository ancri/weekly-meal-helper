import unittest
from datetime import date, timedelta

from meal_helper.config import ALLOWED_UNITS
from meal_helper.ingredient_import import (
    INGREDIENT_DEFINITIONS,
    build_ingredient_candidates,
    matching_definitions,
)
from meal_helper.workbook import HistoricalOrderItem


def order(week: date, text: str, whole_foods: bool = True) -> HistoricalOrderItem:
    return HistoricalOrderItem(
        week_start=week,
        ordered_on=week,
        retailer="Whole Foods" if whole_foods else "Other",
        whole_foods=whole_foods,
        raw_text=text,
    )


class IngredientImportTests(unittest.TestCase):
    def test_definitions_have_unique_names_and_valid_units(self):
        names = [definition.name for definition in INGREDIENT_DEFINITIONS]
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(
            all(definition.default_unit in ALLOWED_UNITS for definition in INGREDIENT_DEFINITIONS)
        )

    def test_compound_order_text_matches_multiple_canonical_ingredients(self):
        matches = {item.name for item in matching_definitions("Olive oil / salted butter")}
        self.assertEqual(matches, {"Olive oil", "Salted butter"})

    def test_product_names_do_not_create_false_ingredient_matches(self):
        cases = {
            "ginger ale": "Ginger",
            "avocado oil": "Avocados",
            "sesame seed oil": "Sesame seeds",
            "spaghetti sauce": "Spaghetti",
            "egg noodles": "Eggs",
            "corn starch": "Corn",
            "bell pepper": "Pepper",
            "flour tortillas": "Flour",
        }
        for text, excluded in cases.items():
            with self.subTest(text=text):
                matches = {item.name for item in matching_definitions(text)}
                self.assertNotIn(excluded, matches)

    def test_candidates_are_ranked_by_distinct_weeks_and_source(self):
        start = date(2026, 1, 5)
        orders = [
            order(start + timedelta(weeks=index), "Broccoli") for index in range(4)
        ]
        orders.extend(
            order(start + timedelta(weeks=index), "2 lbs ground beef", whole_foods=False)
            for index in range(3)
        )
        orders.append(order(start, "Coffee"))

        candidates, unmatched, coverage = build_ingredient_candidates(orders, min_weeks=3)

        self.assertEqual([item.name for item in candidates], ["Broccoli", "Ground beef"])
        self.assertTrue(candidates[0].whole_foods)
        self.assertFalse(candidates[1].whole_foods)
        self.assertEqual(unmatched[0].raw_text, "Coffee")
        self.assertEqual(coverage, 7 / 8)


if __name__ == "__main__":
    unittest.main()
