from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DATABASE_PATH = DATA_DIR / "meal_helper.sqlite3"
HISTORY_WORKBOOK = ROOT_DIR / "meals_history.xlsx"

CATEGORIES = {
    "soups_stews": "Soups / stews",
    "pastas": "Pastas",
    "oven_roasted": "Oven / roasted",
}

PROPOSALS_PER_CATEGORY = {
    "soups_stews": 3,
    "pastas": 3,
    "oven_roasted": 3,
}

MEALS_TO_CHOOSE = 3
RECIPE_PARSE_REQUESTS_PER_HOUR = 10
RECIPE_PARSE_MAX_CANDIDATES = 100
RECIPE_PARSE_MAX_TEXT_LENGTH = 4000
DEFAULT_UNIT = "pieces"
ALLOWED_UNITS = (
    "pieces",
    "lbs",
    "oz",
    "cups",
    "tbsp",
    "tsp",
    "cans",
    "jars",
    "bunches",
    "packages",
    "heads",
    "cloves",
    "stalks",
)
