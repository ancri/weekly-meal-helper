import csv
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from meal_helper.database import Database
from scripts.import_ingredient_candidates import compare_with_database, read_candidates


class IngredientCandidateImportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = Database(Path(self.directory.name) / "ingredients.sqlite3")
        self.csv_path = Path(self.directory.name) / "candidates.csv"
        with self.csv_path.open("w", newline="", encoding="utf-8") as output:
            writer = csv.DictWriter(
                output,
                fieldnames=("name", "include", "default_unit", "whole_foods"),
            )
            writer.writeheader()
            writer.writerow(
                {"name": "Broccoli", "include": "1", "default_unit": "heads", "whole_foods": "1"}
            )
            writer.writerow(
                {"name": "Coffee", "include": "0", "default_unit": "cups", "whole_foods": "1"}
            )

    def tearDown(self):
        self.directory.cleanup()

    def test_dry_run_does_not_insert_candidates(self):
        candidates = read_candidates(self.csv_path)

        result = compare_with_database(self.database, candidates, apply=False)

        self.assertEqual(result, (1, 0, 0))
        with self.database.transaction() as connection:
            count = connection.execute("SELECT COUNT(*) FROM ingredients").fetchone()[0]
        self.assertEqual(count, 0)

    def test_apply_inserts_candidates_without_overwriting_conflicts(self):
        candidates = read_candidates(self.csv_path)
        compare_with_database(self.database, candidates, apply=True)
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE ingredients SET default_unit = 'pieces' WHERE name = 'Broccoli'"
            )

        with redirect_stdout(io.StringIO()):
            result = compare_with_database(self.database, candidates, apply=True)

        self.assertEqual(result, (0, 0, 1))
        with self.database.transaction() as connection:
            unit = connection.execute(
                "SELECT default_unit FROM ingredients WHERE name = 'Broccoli'"
            ).fetchone()[0]
        self.assertEqual(unit, "pieces")


if __name__ == "__main__":
    unittest.main()
