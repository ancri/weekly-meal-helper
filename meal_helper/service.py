from __future__ import annotations

import hashlib
import math
import random
import re
import sqlite3
import unicodedata
from datetime import date, timedelta
from typing import Any

from .config import (
    ALLOWED_UNITS,
    CATEGORIES,
    MEALS_TO_CHOOSE,
    PROPOSALS_PER_CATEGORY,
    RECIPE_PARSE_MAX_CANDIDATES,
    RECIPE_PARSE_MAX_TEXT_LENGTH,
    RECIPE_PARSE_REQUESTS_PER_HOUR,
)
from .database import Database, utc_now
from .recipe_parser import RecipeParserError, select_ingredient_candidates
from .workbook import monday_for


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _clean_name(value: Any, field: str = "Name") -> str:
    if not isinstance(value, str) or not value.strip():
        raise ServiceError(f"{field} is required.")
    return " ".join(value.split())


def _parse_week_start(value: str | None) -> date:
    if value:
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ServiceError("Week must be an ISO date.") from exc
    else:
        parsed = date.today()
    return monday_for(parsed)


class MealService:
    def __init__(self, database: Database, recipe_parser: Any = None):
        self.database = database
        self.recipe_parser = recipe_parser

    def get_week(self, week: str | None = None) -> dict[str, Any]:
        week_start = _parse_week_start(week)
        with self.database.transaction() as connection:
            week_id = self._ensure_week(connection, week_start)
            record = connection.execute("SELECT * FROM weeks WHERE id = ?", (week_id,)).fetchone()
            existing = connection.execute(
                "SELECT COUNT(*) AS count FROM weekly_recipes WHERE week_id = ?", (week_id,)
            ).fetchone()["count"]
            if not record["locked_at"] and existing == 0:
                self._generate_proposal(connection, week_id, week_start)
            return self._week_payload(connection, week_id)

    def _ensure_week(self, connection: sqlite3.Connection, week_start: date) -> int:
        connection.execute(
            "INSERT OR IGNORE INTO weeks(week_start) VALUES (?)", (week_start.isoformat(),)
        )
        return connection.execute(
            "SELECT id FROM weeks WHERE week_start = ?", (week_start.isoformat(),)
        ).fetchone()["id"]

    def _generate_proposal(
        self, connection: sqlite3.Connection, week_id: int, week_start: date
    ) -> None:
        chosen: set[int] = set()
        position = 0
        previous_week = (week_start - timedelta(days=7)).isoformat()

        postponed = connection.execute(
            """
            SELECT r.id, r.category
            FROM weekly_recipes wr
            JOIN weeks w ON w.id = wr.week_id
            JOIN recipes r ON r.id = wr.recipe_id
            WHERE w.week_start = ? AND wr.state = 'postponed' AND r.archived_at IS NULL
            ORDER BY wr.position
            """,
            (previous_week,),
        ).fetchall()

        by_category: dict[str, list[int]] = {category: [] for category in CATEGORIES}
        for row in postponed:
            by_category[row["category"]].append(row["id"])

        rows = connection.execute(
            """
            SELECT r.id, r.category,
                   MAX(CASE WHEN wr.state = 'accepted' THEN w.week_start END) AS last_eaten
            FROM recipes r
            LEFT JOIN weekly_recipes wr ON wr.recipe_id = r.id
            LEFT JOIN weeks w ON w.id = wr.week_id
            WHERE r.archived_at IS NULL
            GROUP BY r.id
            """
        ).fetchall()

        recent_cutoff = (week_start - timedelta(weeks=6)).isoformat()
        for category, amount in PROPOSALS_PER_CATEGORY.items():
            category_ids = by_category[category][:amount]
            chosen.update(category_ids)
            eligible = [
                row
                for row in rows
                if row["category"] == category
                and row["id"] not in chosen
                and (row["last_eaten"] is None or row["last_eaten"] < recent_cutoff)
            ]
            fallback = [
                row
                for row in rows
                if row["category"] == category and row["id"] not in chosen
            ]
            seed = int.from_bytes(
                hashlib.sha256(f"{week_start}:{category}".encode()).digest()[:8], "big"
            )
            generator = random.Random(seed)
            generator.shuffle(eligible)
            generator.shuffle(fallback)
            pool = eligible + [row for row in fallback if row not in eligible]
            category_ids.extend(row["id"] for row in pool[: amount - len(category_ids)])

            for recipe_id in category_ids:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO weekly_recipes
                        (week_id, recipe_id, state, was_proposed, position)
                    VALUES (?, ?, 'pending', 1, ?)
                    """,
                    (week_id, recipe_id, position),
                )
                chosen.add(recipe_id)
                position += 1

    def _week_payload(self, connection: sqlite3.Connection, week_id: int) -> dict[str, Any]:
        week = connection.execute("SELECT * FROM weeks WHERE id = ?", (week_id,)).fetchone()
        rows = connection.execute(
            """
            SELECT wr.id AS weekly_recipe_id, wr.state, wr.was_proposed, wr.eaten_on,
                   wr.position, r.id, r.name, r.category, r.url, r.instructions,
                   MAX(CASE WHEN old_wr.state = 'accepted' AND old_w.id != w.id
                            THEN old_w.week_start END) AS last_eaten
            FROM weekly_recipes wr
            JOIN weeks w ON w.id = wr.week_id
            JOIN recipes r ON r.id = wr.recipe_id
            LEFT JOIN weekly_recipes old_wr ON old_wr.recipe_id = r.id
            LEFT JOIN weeks old_w ON old_w.id = old_wr.week_id
            WHERE wr.week_id = ?
            GROUP BY wr.id
            ORDER BY wr.position, r.name COLLATE NOCASE
            """,
            (week_id,),
        ).fetchall()
        items = [dict(row) | {"ingredients": self._recipe_ingredients(connection, row["id"])} for row in rows]
        accepted = sum(item["state"] == "accepted" for item in items)
        return {
            "id": week["id"],
            "week_start": week["week_start"],
            "locked": week["locked_at"] is not None,
            "locked_at": week["locked_at"],
            "choose_count": MEALS_TO_CHOOSE,
            "accepted_count": accepted,
            "categories": CATEGORIES,
            "items": items,
            "shopping": self._shopping_list(connection, week_id),
        }

    def _recipe_ingredients(
        self, connection: sqlite3.Connection, recipe_id: int
    ) -> list[dict[str, Any]]:
        return [
            dict(row)
            for row in connection.execute(
                """
                SELECT i.id, i.name, i.whole_foods, i.default_unit,
                       ri.quantity, ri.unit
                FROM recipe_ingredients ri
                JOIN ingredients i ON i.id = ri.ingredient_id
                WHERE ri.recipe_id = ?
                ORDER BY i.name COLLATE NOCASE
                """,
                (recipe_id,),
            )
        ]

    def _shopping_list(
        self, connection: sqlite3.Connection, week_id: int
    ) -> dict[str, list[dict[str, Any]]]:
        rows = connection.execute(
            """
            SELECT i.id, i.name, i.whole_foods, ri.unit, SUM(ri.quantity) AS quantity
            FROM weekly_recipes wr
            JOIN recipe_ingredients ri ON ri.recipe_id = wr.recipe_id
            JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE wr.week_id = ? AND wr.state = 'accepted'
            GROUP BY i.id, ri.unit
            ORDER BY i.name COLLATE NOCASE
            """,
            (week_id,),
        ).fetchall()
        return {
            "whole_foods": [dict(row) for row in rows if row["whole_foods"]],
            "elsewhere": [dict(row) for row in rows if not row["whole_foods"]],
        }

    def set_decision(self, weekly_recipe_id: int, state: str) -> dict[str, Any]:
        if state not in {"pending", "accepted", "rejected", "postponed"}:
            raise ServiceError("Unknown meal decision.")
        with self.database.transaction() as connection:
            row = self._editable_weekly_recipe(connection, weekly_recipe_id)
            if state == "accepted":
                accepted = connection.execute(
                    "SELECT COUNT(*) AS count FROM weekly_recipes WHERE week_id = ? AND state = 'accepted'",
                    (row["week_id"],),
                ).fetchone()["count"]
                if accepted >= MEALS_TO_CHOOSE and row["state"] != "accepted":
                    raise ServiceError(f"Choose exactly {MEALS_TO_CHOOSE} meals.")
            connection.execute(
                "UPDATE weekly_recipes SET state = ? WHERE id = ?", (state, weekly_recipe_id)
            )
            return self._week_payload(connection, row["week_id"])

    def add_recipe_to_week(self, week: str, recipe_id: int) -> dict[str, Any]:
        week_start = _parse_week_start(week)
        with self.database.transaction() as connection:
            week_id = self._ensure_week(connection, week_start)
            self._assert_unlocked(connection, week_id)
            if connection.execute(
                "SELECT id FROM recipes WHERE id = ? AND archived_at IS NULL", (recipe_id,)
            ).fetchone() is None:
                raise ServiceError("Recipe not found.", 404)
            position = connection.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM weekly_recipes WHERE week_id = ?",
                (week_id,),
            ).fetchone()["position"]
            try:
                connection.execute(
                    """
                    INSERT INTO weekly_recipes(week_id, recipe_id, state, was_proposed, position)
                    VALUES (?, ?, 'pending', 0, ?)
                    """,
                    (week_id, recipe_id, position),
                )
            except sqlite3.IntegrityError as exc:
                raise ServiceError("That recipe is already on this week's menu.") from exc
            return self._week_payload(connection, week_id)

    def remove_weekly_recipe(self, weekly_recipe_id: int) -> dict[str, Any]:
        with self.database.transaction() as connection:
            row = self._editable_weekly_recipe(connection, weekly_recipe_id)
            connection.execute("DELETE FROM weekly_recipes WHERE id = ?", (weekly_recipe_id,))
            return self._week_payload(connection, row["week_id"])

    def lock_week(self, week: str) -> dict[str, Any]:
        week_start = _parse_week_start(week)
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM weeks WHERE week_start = ?", (week_start.isoformat(),)
            ).fetchone()
            if row is None:
                raise ServiceError("Week not found.", 404)
            if row["locked_at"]:
                return self._week_payload(connection, row["id"])
            accepted = connection.execute(
                "SELECT COUNT(*) AS count FROM weekly_recipes WHERE week_id = ? AND state = 'accepted'",
                (row["id"],),
            ).fetchone()["count"]
            if accepted != MEALS_TO_CHOOSE:
                raise ServiceError(f"Choose exactly {MEALS_TO_CHOOSE} meals before locking the week.")
            connection.execute(
                "UPDATE weeks SET locked_at = ? WHERE id = ?", (utc_now(), row["id"])
            )
            return self._week_payload(connection, row["id"])

    def unlock_week(self, week: str) -> dict[str, Any]:
        week_start = _parse_week_start(week)
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM weeks WHERE week_start = ?", (week_start.isoformat(),)
            ).fetchone()
            if row is None:
                raise ServiceError("Week not found.", 404)
            connection.execute("UPDATE weeks SET locked_at = NULL WHERE id = ?", (row["id"],))
            return self._week_payload(connection, row["id"])

    def _editable_weekly_recipe(
        self, connection: sqlite3.Connection, weekly_recipe_id: int
    ) -> sqlite3.Row:
        row = connection.execute(
            """
            SELECT wr.*, w.locked_at FROM weekly_recipes wr
            JOIN weeks w ON w.id = wr.week_id WHERE wr.id = ?
            """,
            (weekly_recipe_id,),
        ).fetchone()
        if row is None:
            raise ServiceError("Meal not found.", 404)
        if row["locked_at"]:
            raise ServiceError("This week is locked.", 409)
        return row

    def _assert_unlocked(self, connection: sqlite3.Connection, week_id: int) -> None:
        row = connection.execute("SELECT locked_at FROM weeks WHERE id = ?", (week_id,)).fetchone()
        if row and row["locked_at"]:
            raise ServiceError("This week is locked.", 409)

    def list_recipes(self, query: str = "") -> list[dict[str, Any]]:
        with self.database.transaction() as connection:
            rows = connection.execute(
                """
                SELECT r.*,
                       MAX(CASE WHEN wr.state = 'accepted' THEN w.week_start END) AS last_eaten,
                       COUNT(DISTINCT ri.ingredient_id) AS ingredient_count
                FROM recipes r
                LEFT JOIN weekly_recipes wr ON wr.recipe_id = r.id
                LEFT JOIN weeks w ON w.id = wr.week_id
                LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                WHERE r.name LIKE ? AND r.archived_at IS NULL
                GROUP BY r.id
                ORDER BY r.name COLLATE NOCASE
                """,
                (f"%{query.strip()}%",),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_recipe(self, recipe_id: int) -> dict[str, Any]:
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM recipes WHERE id = ? AND archived_at IS NULL", (recipe_id,)
            ).fetchone()
            if row is None:
                raise ServiceError("Recipe not found.", 404)
            return dict(row) | {"ingredients": self._recipe_ingredients(connection, recipe_id)}

    def create_recipe(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = _clean_name(payload.get("name"), "Recipe name")
        category = payload.get("category")
        if category not in CATEGORIES:
            raise ServiceError("Choose a valid recipe category.")
        url = self._clean_url(payload.get("url"))
        instructions = self._clean_instructions(payload.get("instructions"))
        with self.database.transaction() as connection:
            try:
                cursor = connection.execute(
                    "INSERT INTO recipes(name, category, url, instructions) VALUES (?, ?, ?, ?)",
                    (name, category, url, instructions),
                )
            except sqlite3.IntegrityError as exc:
                raise ServiceError("A recipe with that name already exists.") from exc
            recipe_id = cursor.lastrowid
            self._replace_recipe_ingredients(connection, recipe_id, payload.get("ingredients", []))
            return dict(connection.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()) | {
                "ingredients": self._recipe_ingredients(connection, recipe_id)
            }

    def update_recipe(self, recipe_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        name = _clean_name(payload.get("name"), "Recipe name")
        category = payload.get("category")
        if category not in CATEGORIES:
            raise ServiceError("Choose a valid recipe category.")
        url = self._clean_url(payload.get("url"))
        instructions = self._clean_instructions(payload.get("instructions"))
        with self.database.transaction() as connection:
            if connection.execute(
                "SELECT id FROM recipes WHERE id = ? AND archived_at IS NULL", (recipe_id,)
            ).fetchone() is None:
                raise ServiceError("Recipe not found.", 404)
            try:
                connection.execute(
                    """
                    UPDATE recipes
                    SET name = ?, category = ?, url = ?, instructions = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (name, category, url, instructions, utc_now(), recipe_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ServiceError("A recipe with that name already exists.") from exc
            self._replace_recipe_ingredients(connection, recipe_id, payload.get("ingredients", []))
            return dict(connection.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()) | {
                "ingredients": self._recipe_ingredients(connection, recipe_id)
            }

    def archive_recipe(self, recipe_id: int) -> dict[str, bool]:
        with self.database.transaction() as connection:
            row = connection.execute(
                "SELECT id FROM recipes WHERE id = ? AND archived_at IS NULL", (recipe_id,)
            ).fetchone()
            if row is None:
                raise ServiceError("Recipe not found.", 404)
            connection.execute(
                """
                DELETE FROM weekly_recipes
                WHERE recipe_id = ? AND week_id IN (
                    SELECT id FROM weeks WHERE locked_at IS NULL
                )
                """,
                (recipe_id,),
            )
            archived_at = utc_now()
            connection.execute(
                "UPDATE recipes SET archived_at = ?, updated_at = ? WHERE id = ?",
                (archived_at, archived_at, recipe_id),
            )
            return {"deleted": True}

    def _replace_recipe_ingredients(
        self, connection: sqlite3.Connection, recipe_id: int, ingredients: Any
    ) -> None:
        if not isinstance(ingredients, list):
            raise ServiceError("Ingredients must be a list.")
        normalized: list[tuple[int, float, str]] = []
        seen: set[int] = set()
        for item in ingredients:
            try:
                ingredient_id = int(item["id"])
                quantity = float(item["quantity"])
                unit = item["unit"]
            except (KeyError, TypeError, ValueError) as exc:
                raise ServiceError("Each ingredient needs an item, quantity, and unit.") from exc
            if quantity <= 0:
                raise ServiceError("Ingredient quantities must be greater than zero.")
            if unit not in ALLOWED_UNITS:
                raise ServiceError("Choose a valid ingredient unit.")
            if ingredient_id in seen:
                raise ServiceError("Each ingredient can only appear once in a recipe.")
            if connection.execute("SELECT id FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone() is None:
                raise ServiceError("Ingredient not found.", 404)
            seen.add(ingredient_id)
            normalized.append((ingredient_id, quantity, unit))
        connection.execute("DELETE FROM recipe_ingredients WHERE recipe_id = ?", (recipe_id,))
        connection.executemany(
            "INSERT INTO recipe_ingredients(recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?)",
            ((recipe_id, ingredient_id, quantity, unit) for ingredient_id, quantity, unit in normalized),
        )

    @staticmethod
    def _clean_url(value: Any) -> str | None:
        if value in (None, ""):
            return None
        if not isinstance(value, str) or not value.startswith(("http://", "https://")):
            raise ServiceError("Recipe URL must start with http:// or https://.")
        return value.strip()

    @staticmethod
    def _clean_instructions(value: Any) -> str | None:
        if value in (None, ""):
            return None
        if not isinstance(value, str):
            raise ServiceError("Instructions must be text.")
        cleaned = value.strip()
        if len(cleaned) > 1200:
            raise ServiceError("Instructions must be 1,200 characters or fewer.")
        return cleaned or None

    def list_ingredients(self, query: str = "") -> list[dict[str, Any]]:
        with self.database.transaction() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT i.*, COUNT(DISTINCT ri.recipe_id) AS usage_count
                    FROM ingredients i
                    LEFT JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
                    WHERE i.name LIKE ?
                    GROUP BY i.id
                    ORDER BY i.name COLLATE NOCASE
                    """,
                    (f"%{query.strip()}%",),
                )
            ]

    def create_ingredient(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = _clean_name(payload.get("name"), "Ingredient name")
        if len(name) > 100:
            raise ServiceError("Ingredient name must be 100 characters or fewer.")
        unit = payload.get("default_unit", "pieces")
        if unit not in ALLOWED_UNITS:
            raise ServiceError("Choose a valid default unit.")
        whole_foods = 1 if payload.get("whole_foods", True) else 0
        with self.database.transaction() as connection:
            try:
                cursor = connection.execute(
                    """
                    INSERT INTO ingredients(name, whole_foods, default_unit, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (name, whole_foods, unit, utc_now()),
                )
            except sqlite3.IntegrityError as exc:
                raise ServiceError("An ingredient with that name already exists.") from exc
            return dict(
                connection.execute("SELECT * FROM ingredients WHERE id = ?", (cursor.lastrowid,)).fetchone()
            )

    def update_ingredient(self, ingredient_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        name = _clean_name(payload.get("name"), "Ingredient name")
        if len(name) > 100:
            raise ServiceError("Ingredient name must be 100 characters or fewer.")
        unit = payload.get("default_unit", "pieces")
        if unit not in ALLOWED_UNITS:
            raise ServiceError("Choose a valid default unit.")
        whole_foods = 1 if payload.get("whole_foods", True) else 0
        with self.database.transaction() as connection:
            if connection.execute(
                "SELECT id FROM ingredients WHERE id = ?", (ingredient_id,)
            ).fetchone() is None:
                raise ServiceError("Ingredient not found.", 404)
            try:
                connection.execute(
                    """
                    UPDATE ingredients
                    SET name = ?, default_unit = ?, whole_foods = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (name, unit, whole_foods, utc_now(), ingredient_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ServiceError("An ingredient with that name already exists.") from exc
            return dict(
                connection.execute(
                    "SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)
                ).fetchone()
            )

    def delete_ingredient(self, ingredient_id: int) -> dict[str, bool]:
        with self.database.transaction() as connection:
            row = connection.execute(
                """
                SELECT i.id, COUNT(DISTINCT ri.recipe_id) AS usage_count
                FROM ingredients i
                LEFT JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
                WHERE i.id = ?
                GROUP BY i.id
                """,
                (ingredient_id,),
            ).fetchone()
            if row is None:
                raise ServiceError("Ingredient not found.", 404)
            if row["usage_count"]:
                raise ServiceError(
                    f"Remove this ingredient from {row['usage_count']} recipe(s) before deleting it.",
                    409,
                )
            connection.execute("DELETE FROM ingredients WHERE id = ?", (ingredient_id,))
            return {"deleted": True}

    def parse_recipe_ingredients(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = self._clean_recipe_source_text(payload.get("text"))
        if self.recipe_parser is None:
            raise ServiceError("Ingredient parsing is not configured yet.", 503)

        with self.database.transaction() as connection:
            catalog = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT i.id, i.name, i.default_unit,
                           COUNT(DISTINCT ri.recipe_id) AS usage_count
                    FROM ingredients i
                    LEFT JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
                    GROUP BY i.id
                    """
                )
            ]
        if not catalog:
            raise ServiceError("Add ingredients to the catalog before parsing a recipe.", 409)
        candidates = select_ingredient_candidates(
            text, catalog, RECIPE_PARSE_MAX_CANDIDATES
        )
        request_id, remaining = self._reserve_recipe_parse_request()
        try:
            parsed = self.recipe_parser.parse(text, candidates, ALLOWED_UNITS)
            result = self._validated_recipe_parse_result(parsed, candidates)
        except RecipeParserError as exc:
            if exc.code in {"insufficient_quota", "billing_hard_limit_reached"}:
                raise ServiceError(
                    "OpenAI API quota is unavailable. Check the API project's billing and usage limits.",
                    503,
                ) from exc
            if exc.code == "invalid_api_key":
                raise ServiceError("OpenAI rejected the configured API key.", 503) from exc
            if exc.code == "rate_limit_exceeded":
                raise ServiceError(
                    "OpenAI is rate-limiting ingredient parsing. Try again shortly.", 429
                ) from exc
            raise ServiceError("Ingredient parsing is temporarily unavailable.", 502) from exc

        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE recipe_parse_requests SET succeeded = 1 WHERE id = ?",
                (request_id,),
            )
        return result | {"requests_remaining": remaining}

    def _reserve_recipe_parse_request(self) -> tuple[int, int]:
        connection = self.database.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM recipe_parse_requests WHERE requested_at < datetime('now', '-7 days')"
            )
            used = connection.execute(
                """
                SELECT COUNT(*) AS count
                FROM recipe_parse_requests
                WHERE requested_at >= datetime('now', '-1 hour')
                """
            ).fetchone()["count"]
            if used >= RECIPE_PARSE_REQUESTS_PER_HOUR:
                connection.rollback()
                raise ServiceError(
                    "The hourly ingredient parsing limit has been reached. Try again later.",
                    429,
                )
            cursor = connection.execute("INSERT INTO recipe_parse_requests DEFAULT VALUES")
            connection.commit()
            return cursor.lastrowid, RECIPE_PARSE_REQUESTS_PER_HOUR - used - 1
        except Exception:
            if connection.in_transaction:
                connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _validated_recipe_parse_result(
        value: Any, candidates: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise RecipeParserError("The parser returned an invalid result.")
        ingredients = value.get("ingredients")
        unmatched = value.get("unmatched")
        if not isinstance(ingredients, list) or not isinstance(unmatched, list):
            raise RecipeParserError("The parser returned an invalid result.")

        by_id = {int(candidate["id"]): candidate for candidate in candidates}
        normalized: list[dict[str, Any]] = []
        seen: set[int] = set()
        for item in ingredients:
            if not isinstance(item, dict):
                raise RecipeParserError("The parser returned an invalid ingredient.")
            ingredient_id = item.get("ingredient_id")
            quantity = item.get("quantity")
            unit = item.get("unit")
            if isinstance(ingredient_id, bool) or not isinstance(ingredient_id, int):
                raise RecipeParserError("The parser returned an invalid ingredient ID.")
            if ingredient_id not in by_id or ingredient_id in seen:
                raise RecipeParserError("The parser returned an unavailable ingredient ID.")
            if isinstance(quantity, bool) or not isinstance(quantity, (int, float)):
                raise RecipeParserError("The parser returned an invalid quantity.")
            quantity = float(quantity)
            if not math.isfinite(quantity) or quantity <= 0 or quantity > 10_000:
                raise RecipeParserError("The parser returned an invalid quantity.")
            if unit not in ALLOWED_UNITS:
                raise RecipeParserError("The parser returned an invalid unit.")
            seen.add(ingredient_id)
            normalized.append(
                {
                    "id": ingredient_id,
                    "name": by_id[ingredient_id]["name"],
                    "quantity": quantity,
                    "unit": unit,
                }
            )

        cleaned_unmatched: list[str] = []
        for item in unmatched[:30]:
            if not isinstance(item, str):
                raise RecipeParserError("The parser returned invalid unmatched text.")
            cleaned = " ".join(item.split())[:160]
            if cleaned:
                cleaned_unmatched.append(cleaned)
        return {"ingredients": normalized, "unmatched": cleaned_unmatched}

    @staticmethod
    def _clean_recipe_source_text(value: Any) -> str:
        if not isinstance(value, str):
            raise ServiceError("Paste an ingredient list to parse.")
        normalized = (
            unicodedata.normalize("NFKC", value)
            .replace("\r\n", "\n")
            .replace("\r", "\n")
        )
        normalized = "".join(
            character
            for character in normalized
            if character == "\n" or unicodedata.category(character) not in {"Cc", "Cf", "Cs"}
        ).strip()
        if not normalized:
            raise ServiceError("Paste an ingredient list to parse.")
        if len(normalized) > RECIPE_PARSE_MAX_TEXT_LENGTH:
            raise ServiceError(
                f"Ingredient text must be {RECIPE_PARSE_MAX_TEXT_LENGTH:,} characters or fewer."
            )
        return normalized

    def create_suggestion(self, payload: dict[str, Any]) -> dict[str, Any]:
        suggestion = self._clean_suggestion(payload.get("text"))
        with self.database.transaction() as connection:
            cursor = connection.execute(
                "INSERT INTO suggestions(suggestion_text) VALUES (?)", (suggestion,)
            )
            row = connection.execute(
                "SELECT id, submitted_at, addressed FROM suggestions WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            return dict(row)

    @staticmethod
    def _clean_suggestion(value: Any) -> str:
        if not isinstance(value, str):
            raise ServiceError("Suggestion text is required.")
        normalized = (
            unicodedata.normalize("NFKC", value)
            .replace("\r\n", "\n")
            .replace("\r", "\n")
        )
        # Suggestions are untrusted data. This removes invisible/control content
        # for storage hygiene; it does not make the text safe to use as an AI prompt.
        normalized = "".join(
            character
            for character in normalized
            if character == "\n" or unicodedata.category(character) not in {"Cc", "Cf", "Cs"}
        )
        normalized = "\n".join(
            re.sub(r"[ \t]+", " ", line).strip() for line in normalized.split("\n")
        )
        normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
        if not normalized:
            raise ServiceError("Suggestion text is required.")
        if len(normalized) > 500:
            raise ServiceError("Suggestion text must be 500 characters or fewer.")
        return normalized

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"categories": CATEGORIES, "units": ALLOWED_UNITS, "choose_count": MEALS_TO_CHOOSE}
