"""Export checks catch secret-bearing files without emitting matched values."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "public_source", Path(__file__).parents[1] / "scripts/check_public_source.py"
)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class PublicSourceChecks(unittest.TestCase):
    def inspect(self, filename, content):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            return checker.inspect_file(path, root)

    def test_empty_template_allows_key_name_without_value(self):
        self.assertEqual(self.inspect(".env.example", "CHART_API_KEY=\nCHART_MODEL=\n"), [])

    def test_template_must_not_supply_any_secret_value(self):
        findings = self.inspect(".env.example", "CHART_API_KEY=example-value\n")
        self.assertEqual(findings[0]["rule"], "nonempty-public-secret-template")

    def test_keys_are_detected_without_echoing_the_value(self):
        token = "sk-" + "unitfixture" * 5
        findings = self.inspect("settings.py", "value = '" + token + "'\n")
        self.assertEqual(findings[0]["rule"], "provider-api-key")
        self.assertNotIn(token, json.dumps(findings))

    def test_environment_and_identity_files_are_rejected(self):
        for name in [".env", ".env.local", "model.env", "service-account.json", "secrets/config.json"]:
            with self.subTest(name=name):
                self.assertTrue(self.inspect(name, "{}"))


if __name__ == "__main__":
    unittest.main()
