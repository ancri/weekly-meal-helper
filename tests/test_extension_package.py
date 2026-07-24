import json
import unittest
from pathlib import Path

from scripts.package_chrome_extension import SOURCE, manifest_references, validate


ROOT = Path(__file__).resolve().parents[1]


class ExtensionPackageTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(
            (SOURCE / "manifest.json").read_text(encoding="utf-8")
        )

    def test_manifest_has_narrow_permissions(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["permissions"], ["storage"])
        self.assertEqual(
            set(self.manifest["host_permissions"]),
            {
                "https://meals.andreicristea.com/*",
                "https://www.amazon.com/*",
                "https://www.wholefoodsmarket.com/*",
            },
        )
        for permission in ("cookies", "history", "identity", "webRequest"):
            self.assertNotIn(permission, self.manifest["permissions"])

    def test_manifest_runtime_files_exist(self):
        _, runtime_files = validate()
        packaged_names = {path.name for path in runtime_files}
        self.assertIn("manifest.json", packaged_names)
        self.assertTrue(manifest_references(self.manifest) <= packaged_names)

    def test_portal_message_protocol_matches_web_app(self):
        app_source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        portal_source = (SOURCE / "portal.js").read_text(encoding="utf-8")
        for message_type in (
            "PING_CART_EXTENSION",
            "CART_EXTENSION_READY",
            "POPULATE_WHOLE_FOODS_CART",
            "CART_EXTENSION_JOB_STARTED",
            "CART_EXTENSION_ERROR",
        ):
            self.assertIn(message_type, app_source)
            self.assertIn(message_type, portal_source)


if __name__ == "__main__":
    unittest.main()
