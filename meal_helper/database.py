from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Iterator

from .workbook import HistoricalMeal, infer_category


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    whole_foods INTEGER NOT NULL DEFAULT 1 CHECK (whole_foods IN (0, 1)),
    default_unit TEXT NOT NULL DEFAULT 'pieces',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    category TEXT NOT NULL CHECK (category IN ('soups_stews', 'pastas', 'oven_roasted')),
    url TEXT,
    instructions TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY,
    week_start TEXT NOT NULL UNIQUE,
    locked_at TEXT
);

CREATE TABLE IF NOT EXISTS weekly_recipes (
    id INTEGER PRIMARY KEY,
    week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'accepted', 'rejected', 'postponed')),
    was_proposed INTEGER NOT NULL DEFAULT 1 CHECK (was_proposed IN (0, 1)),
    eaten_on TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (week_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_recipes_week ON weekly_recipes(week_id, position);
CREATE INDEX IF NOT EXISTS idx_weekly_recipes_recipe ON weekly_recipes(recipe_id, state);

CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY,
    suggestion_text TEXT NOT NULL CHECK (length(suggestion_text) BETWEEN 1 AND 500),
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    addressed INTEGER NOT NULL DEFAULT 0 CHECK (addressed IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_suggestions_addressed
    ON suggestions(addressed, submitted_at);
"""


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.transaction() as connection:
            connection.executescript(SCHEMA)
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(recipes)")
            }
            if "instructions" not in columns:
                connection.execute("ALTER TABLE recipes ADD COLUMN instructions TEXT")
            if "archived_at" not in columns:
                connection.execute("ALTER TABLE recipes ADD COLUMN archived_at TEXT")
            ingredient_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(ingredients)")
            }
            if "updated_at" not in ingredient_columns:
                connection.execute("ALTER TABLE ingredients ADD COLUMN updated_at TEXT")
                connection.execute(
                    "UPDATE ingredients SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP)"
                )

    def import_history(self, meals: list[HistoricalMeal]) -> tuple[int, int]:
        recipe_count = 0
        history_count = 0
        with self.transaction() as connection:
            for meal in meals:
                cursor = connection.execute(
                    "INSERT OR IGNORE INTO recipes(name, category) VALUES (?, ?)",
                    (meal.recipe_name, infer_category(meal.recipe_name)),
                )
                recipe_count += cursor.rowcount
                recipe_id = connection.execute(
                    "SELECT id FROM recipes WHERE name = ? COLLATE NOCASE",
                    (meal.recipe_name,),
                ).fetchone()["id"]
                connection.execute(
                    "INSERT OR IGNORE INTO weeks(week_start, locked_at) VALUES (?, ?)",
                    (meal.week_start.isoformat(), f"{meal.week_start.isoformat()}T12:00:00"),
                )
                week_id = connection.execute(
                    "SELECT id FROM weeks WHERE week_start = ?", (meal.week_start.isoformat(),)
                ).fetchone()["id"]
                cursor = connection.execute(
                    """
                    INSERT OR IGNORE INTO weekly_recipes
                        (week_id, recipe_id, state, was_proposed, eaten_on, position)
                    VALUES (?, ?, 'accepted', 0, ?, ?)
                    """,
                    (week_id, recipe_id, meal.eaten_on.isoformat(), history_count),
                )
                history_count += cursor.rowcount
        return recipe_count, history_count

    def delete_recipe(self, recipe_id: int) -> bool:
        """Delete an unused recipe. Intentionally not exposed in the web UI."""
        with self.transaction() as connection:
            cursor = connection.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
            return cursor.rowcount == 1


def utc_now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")
