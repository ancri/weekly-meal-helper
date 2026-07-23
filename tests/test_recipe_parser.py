import json
import unittest
from io import BytesIO
from urllib.error import HTTPError

from meal_helper.recipe_parser import (
    OpenAIRecipeParser,
    RecipeParserError,
    select_ingredient_candidates,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return self.payload


class RecipeParserTests(unittest.TestCase):
    def test_candidate_ranking_prioritizes_literal_matches_and_caps_results(self):
        ingredients = [
            {"id": 1, "name": "Broccoli", "default_unit": "heads", "usage_count": 20},
            {"id": 2, "name": "Red onion", "default_unit": "pieces", "usage_count": 0},
            {"id": 3, "name": "Garlic", "default_unit": "cloves", "usage_count": 3},
        ]

        selected = select_ingredient_candidates("Slice one red onion", ingredients, limit=2)

        self.assertEqual(selected[0]["id"], 2)
        self.assertEqual(len(selected), 2)

    def test_openai_request_uses_structured_output_and_validates_response(self):
        captured = {}
        api_payload = {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps(
                                {
                                    "ingredients": [
                                        {
                                            "ingredient_id": 7,
                                            "quantity": 2,
                                            "unit": "cups",
                                        }
                                    ],
                                    "unmatched": ["fresh basil"],
                                }
                            ),
                        }
                    ],
                }
            ]
        }

        def opener(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse(api_payload)

        parser = OpenAIRecipeParser("secret-key", opener=opener)
        result = parser.parse(
            "2 cups chickpeas",
            [{"id": 7, "name": "Chickpeas", "default_unit": "cans"}],
            ("cups", "cans"),
        )

        request_body = json.loads(captured["request"].data)
        self.assertFalse(request_body["store"])
        self.assertEqual(request_body["model"], "gpt-4o-mini")
        self.assertEqual(request_body["text"]["format"]["type"], "json_schema")
        self.assertTrue(request_body["text"]["format"]["strict"])
        self.assertEqual(
            request_body["text"]["format"]["schema"]["properties"]["ingredients"]
            ["items"]["properties"]["ingredient_id"]["enum"],
            [7],
        )
        self.assertEqual(captured["timeout"], 35)
        self.assertEqual(captured["request"].get_header("Authorization"), "Bearer secret-key")
        self.assertEqual(result["ingredients"][0]["quantity"], 2.0)

    def test_openai_response_cannot_return_an_uncatalogued_id(self):
        payload = {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps(
                                {
                                    "ingredients": [
                                        {"ingredient_id": 999, "quantity": 1, "unit": "cups"}
                                    ],
                                    "unmatched": [],
                                }
                            ),
                        }
                    ],
                }
            ]
        }
        parser = OpenAIRecipeParser("secret-key", opener=lambda *_args, **_kwargs: FakeResponse(payload))

        with self.assertRaises(RecipeParserError):
            parser.parse(
                "one cup chickpeas",
                [{"id": 7, "name": "Chickpeas", "default_unit": "cups"}],
                ("cups",),
            )

    def test_openai_http_error_preserves_safe_error_code(self):
        def opener(request, timeout):
            raise HTTPError(
                request.full_url,
                429,
                "Too Many Requests",
                {},
                BytesIO(
                    json.dumps(
                        {"error": {"code": "insufficient_quota", "message": "not returned"}}
                    ).encode()
                ),
            )

        parser = OpenAIRecipeParser("secret-key", opener=opener)

        with self.assertRaises(RecipeParserError) as raised:
            parser.parse(
                "one cup chickpeas",
                [{"id": 7, "name": "Chickpeas", "default_unit": "cups"}],
                ("cups",),
            )

        self.assertEqual(raised.exception.code, "insufficient_quota")


if __name__ == "__main__":
    unittest.main()
