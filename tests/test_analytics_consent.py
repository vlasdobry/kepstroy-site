import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
ANALYTICS_SCRIPT = HTML_ROOT / "js" / "analytics-consent.js"
MAIN_SCRIPT = HTML_ROOT / "js" / "main.js"
POLICY_PAGE = HTML_ROOT / "politika-konfidencialnosti" / "index.html"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy.yml"
PACKAGE_JSON = REPO_ROOT / "package.json"


def is_verification_page(source):
    """Identify provider token pages by their deliberately content-only body."""
    body = re.search(r"<body[^>]*>(?P<body>.*?)</body>", source, re.DOTALL | re.IGNORECASE)
    if not body:
        return False
    body_text = re.sub(r"<[^>]+>", "", body.group("body")).strip()
    return bool(re.fullmatch(r"Verification:\s*[a-f0-9]+", body_text, re.IGNORECASE))


def public_html_sources():
    pages = []
    for path in sorted(HTML_ROOT.rglob("*.html")):
        source = path.read_text(encoding="utf-8")
        if not is_verification_page(source):
            pages.append((path, source))
    return pages


def generated_page_templates():
    return [
        (path, path.read_text(encoding="utf-8"))
        for path in sorted((REPO_ROOT / "generators").glob("*-template.html"))
    ]


class AnalyticsConsentContractsTests(unittest.TestCase):
    def test_all_public_pages_and_generated_templates_use_only_shared_consent_loader(self):
        sources = [*public_html_sources(), *generated_page_templates()]

        self.assertGreaterEqual(len(public_html_sources()), 55)
        self.assertIn(
            HTML_ROOT / "uslugi" / "generatory" / "index.html",
            {path for path, _ in public_html_sources()},
        )
        self.assertGreaterEqual(len(generated_page_templates()), 2)

        for path, source in sources:
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                self.assertNotIn("mc.yandex.ru/metrika/tag.js", source)
                self.assertNotIn("mc.yandex.ru/watch/109754800", source)
                self.assertNotRegex(source, r"\bym\s*\(\s*109754800\s*,\s*['\"]init['\"]")
                self.assertEqual(
                    1,
                    len(
                        re.findall(
                            r'<script\b[^>]*\bsrc=["\']/js/analytics-consent\.js\?v=1["\'][^>]*></script>',
                            source,
                            re.IGNORECASE,
                        )
                    ),
                )
                self.assertNotRegex(source, r'\bid=["\']cookieBanner["\']')

    def test_shared_loader_runs_before_scripts_that_can_emit_goals(self):
        for path, source in [*public_html_sources(), *generated_page_templates()]:
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                consent_position = source.index("/js/analytics-consent.js?v=1")
                goal_script_positions = [
                    source.find(marker)
                    for marker in ("/js/tracking.js", "/js/main.js", "js/main.js")
                    if source.find(marker) >= 0
                ]
                if goal_script_positions:
                    self.assertLess(consent_position, min(goal_script_positions))

    def test_main_script_no_longer_owns_cookie_consent(self):
        source = MAIN_SCRIPT.read_text(encoding="utf-8")

        self.assertNotIn("cookiesAccepted", source)
        self.assertNotIn("cookieBanner", source)
        self.assertNotIn("Cookie Consent Banner", source)

    def test_policy_describes_deferred_analytics_and_the_consent_storage_key(self):
        policy = POLICY_PAGE.read_text(encoding="utf-8")

        self.assertIn("kepstroy_analytics_consent", policy)
        self.assertRegex(
            policy,
            r"Яндекс\.Метрика[^<]{0,200}(?:загружается|подключается)[^<]{0,120}(?:нажат|согласи)",
        )

    def test_node20_runtime_test_is_available_locally_and_in_ci(self):
        package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertEqual(
            "node --test --test-isolation=none tests/test_analytics_consent_runtime.cjs",
            package.get("scripts", {}).get("test:analytics-consent"),
        )
        self.assertIn("npm run test:analytics-consent", workflow)

    def test_predeploy_validator_accepts_only_the_consent_gated_analytics_contract(self):
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "validate.py")],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

        self.assertEqual(0, result.returncode, result.stderr)


if __name__ == "__main__":
    unittest.main()
