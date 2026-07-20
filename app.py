from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from meal_helper.config import DATABASE_PATH, HISTORY_WORKBOOK, ROOT_DIR
from meal_helper.database import Database
from meal_helper.service import MealService, ServiceError
from meal_helper.workbook import read_historical_meals


STATIC_DIR = ROOT_DIR / "static"


def bootstrap(database_path: str | Path, workbook_path: str | Path = HISTORY_WORKBOOK) -> MealService:
    database = Database(database_path)
    database.initialize()
    workbook = Path(workbook_path)
    if workbook.exists():
        database.import_history(read_historical_meals(workbook))
    return MealService(database)


def make_handler(service: MealService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MealHelper/1.0"

        def do_GET(self) -> None:
            try:
                parsed = urlparse(self.path)
                query = parse_qs(parsed.query)
                if parsed.path == "/api/meta":
                    self._json(service.metadata())
                elif parsed.path == "/api/week":
                    self._json(service.get_week(self._first(query, "start")))
                elif parsed.path == "/api/recipes":
                    self._json(service.list_recipes(self._first(query, "q") or ""))
                elif match := re.fullmatch(r"/api/recipes/(\d+)", parsed.path):
                    self._json(service.get_recipe(int(match.group(1))))
                elif parsed.path == "/api/ingredients":
                    self._json(service.list_ingredients(self._first(query, "q") or ""))
                elif parsed.path == "/":
                    self._file(STATIC_DIR / "index.html", no_cache=True)
                elif parsed.path.startswith("/static/"):
                    relative = parsed.path.removeprefix("/static/")
                    target = (STATIC_DIR / relative).resolve()
                    if STATIC_DIR.resolve() not in target.parents:
                        raise ServiceError("File not found.", 404)
                    self._file(target)
                else:
                    raise ServiceError("Not found.", 404)
            except ServiceError as exc:
                self._json({"error": exc.message}, exc.status)
            except Exception:
                self._json({"error": "Unexpected server error."}, 500)
                raise

        def do_POST(self) -> None:
            try:
                parsed = urlparse(self.path)
                payload = self._body()
                if parsed.path == "/api/recipes":
                    self._json(service.create_recipe(payload), 201)
                elif parsed.path == "/api/ingredients":
                    self._json(service.create_ingredient(payload), 201)
                elif parsed.path == "/api/suggestions":
                    self._json(service.create_suggestion(payload), 201)
                elif parsed.path == "/api/week/recipes":
                    self._json(service.add_recipe_to_week(payload.get("week_start"), int(payload["recipe_id"])))
                elif parsed.path == "/api/week/lock":
                    self._json(service.lock_week(payload.get("week_start")))
                elif parsed.path == "/api/week/unlock":
                    self._json(service.unlock_week(payload.get("week_start")))
                elif match := re.fullmatch(r"/api/week-items/(\d+)/decision", parsed.path):
                    self._json(service.set_decision(int(match.group(1)), payload.get("state")))
                else:
                    raise ServiceError("Not found.", 404)
            except (KeyError, TypeError, ValueError):
                self._json({"error": "The request is missing a required value."}, 400)
            except ServiceError as exc:
                self._json({"error": exc.message}, exc.status)
            except Exception:
                self._json({"error": "Unexpected server error."}, 500)
                raise

        def do_PUT(self) -> None:
            try:
                parsed = urlparse(self.path)
                payload = self._body()
                if match := re.fullmatch(r"/api/recipes/(\d+)", parsed.path):
                    self._json(service.update_recipe(int(match.group(1)), payload))
                elif match := re.fullmatch(r"/api/ingredients/(\d+)", parsed.path):
                    self._json(service.update_ingredient(int(match.group(1)), payload))
                else:
                    raise ServiceError("Not found.", 404)
            except ServiceError as exc:
                self._json({"error": exc.message}, exc.status)
            except Exception:
                self._json({"error": "Unexpected server error."}, 500)
                raise

        def do_DELETE(self) -> None:
            try:
                parsed = urlparse(self.path)
                if match := re.fullmatch(r"/api/week-items/(\d+)", parsed.path):
                    self._json(service.remove_weekly_recipe(int(match.group(1))))
                elif match := re.fullmatch(r"/api/recipes/(\d+)", parsed.path):
                    self._json(service.archive_recipe(int(match.group(1))))
                elif match := re.fullmatch(r"/api/ingredients/(\d+)", parsed.path):
                    self._json(service.delete_ingredient(int(match.group(1))))
                else:
                    raise ServiceError("Not found.", 404)
            except ServiceError as exc:
                self._json({"error": exc.message}, exc.status)
            except Exception:
                self._json({"error": "Unexpected server error."}, 500)
                raise

        def _body(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as exc:
                raise ServiceError("Invalid request length.") from exc
            if length <= 0 or length > 1_000_000:
                raise ServiceError("Request body is missing or too large.")
            try:
                value = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                raise ServiceError("Request body must be valid JSON.") from exc
            if not isinstance(value, dict):
                raise ServiceError("Request body must be a JSON object.")
            return value

        @staticmethod
        def _first(query: dict[str, list[str]], key: str) -> str | None:
            values = query.get(key)
            return values[0] if values else None

        def _json(self, payload, status: int = 200) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._security_headers()
            self.end_headers()
            self.wfile.write(body)

        def _file(self, path: Path, no_cache: bool = False) -> None:
            if not path.is_file():
                raise ServiceError("File not found.", 404)
            body = path.read_bytes()
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store" if no_cache else "public, max-age=300")
            self._security_headers()
            self.end_headers()
            self.wfile.write(body)

        def _security_headers(self) -> None:
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "same-origin")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Meal Helper web server")
    parser.add_argument("--host", default=os.environ.get("MEAL_HELPER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MEAL_HELPER_PORT", "8080")))
    parser.add_argument("--database", default=os.environ.get("MEAL_HELPER_DATABASE", str(DATABASE_PATH)))
    args = parser.parse_args()

    service = bootstrap(args.database)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(service))
    print(f"Meal Helper is running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
