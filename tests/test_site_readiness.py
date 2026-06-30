import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
SITEMAP = HTML_ROOT / "sitemap.xml"
UTILITY_URLS = {
    "https://kepstroy.ru/call/",
    "https://kepstroy.ru/lead-magnet/",
    "https://kepstroy.ru/spasibo/",
}


def production_pages():
    for path in HTML_ROOT.rglob("*.html"):
        relative = path.relative_to(HTML_ROOT).as_posix()
        if relative in {"404.html", "yandex_42d19edda2426210.html"}:
            continue
        yield path, path.read_text(encoding="utf-8")


class SiteReadinessTests(unittest.TestCase):
    def test_nonexistent_lead_magnet_is_not_published_or_promised(self):
        self.assertFalse((HTML_ROOT / "lead-magnet" / "index.html").exists())

        forbidden = re.compile(r"lead-magnet|pdf[-\s]?гайд|получить\s+pdf", re.IGNORECASE)
        matches = []
        for path in [HTML_ROOT / "js" / "main.js", HTML_ROOT / "politika-konfidencialnosti" / "index.html"]:
            text = path.read_text(encoding="utf-8")
            if forbidden.search(text):
                matches.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], matches)

    def test_sitemap_generator_does_not_add_non_html_or_utility_urls(self):
        generator = (REPO_ROOT / "generators" / "update-sitemap.py").read_text(encoding="utf-8")
        self.assertNotIn("llms.txt", generator)
        self.assertNotIn("llms-full.txt", generator)
    def test_utility_pages_are_not_in_sitemap(self):
        root = ET.parse(SITEMAP).getroot()
        namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        urls = {node.text for node in root.findall("sm:url/sm:loc", namespace)}
        self.assertTrue(UTILITY_URLS.isdisjoint(urls), UTILITY_URLS.intersection(urls))

    def test_every_indexable_page_loads_attribution_tracking(self):
        missing = []
        for path, text in production_pages():
            if re.search(r'<meta\s+name="robots"\s+content="[^"]*noindex', text, re.IGNORECASE):
                continue
            if "/js/tracking.js" not in text:
                missing.append(path.relative_to(HTML_ROOT).as_posix())
        self.assertEqual([], missing)

    def test_every_lead_form_has_required_delivery_fields(self):
        errors = []
        for path, text in production_pages():
            for index, form in enumerate(re.findall(r"<form\b.*?</form>", text, re.DOTALL | re.IGNORECASE), 1):
                if 'action="/submit"' not in form:
                    continue
                required = [
                    'name="form_source"',
                    'value="kepstroy"',
                    'name="website"',
                    'name="company"',
                    'name="consent"',
                ]
                missing = [token for token in required if token not in form]
                if missing:
                    rel = path.relative_to(HTML_ROOT).as_posix()
                    errors.append(f"{rel} form #{index}: {', '.join(missing)}")
        self.assertEqual([], errors)

    def test_generator_sources_do_not_restore_stale_offer(self):
        paths = [
            REPO_ROOT / "generators" / "city-septik-template.html",
            REPO_ROOT / "generators" / "city-index-template.html",
            REPO_ROOT / "generators" / "city-septik-data.json",
        ]
        forbidden = {
            "Топас": [],
            "Тверь": [],
            "Выезд инженера — 0 ₽": [],
            "септика в ${city_dative} начинается от 60 000 ₽": [],
            '<div class="service-tile__price">от 60 000 ₽</div>': [],
        }
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for token in forbidden:
                if token in text:
                    forbidden[token].append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual({}, {key: value for key, value in forbidden.items() if value})

    def test_form_handler_image_contains_all_runtime_modules(self):
        dockerfile = (REPO_ROOT / "form-handler" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("lead-message.js", dockerfile)

    def test_deploy_validation_runs_form_handler_tests(self):
        workflow = (REPO_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        package = (REPO_ROOT / "form-handler" / "package.json").read_text(encoding="utf-8")
        self.assertIn("npm test", workflow)
        self.assertIn("getMe", workflow)
        self.assertIn("CI Test", workflow)
        self.assertIn('"test"', package)
    def test_main_script_has_no_orphan_quiz_tracking(self):
        pages = "\n".join(text for _, text in production_pages())
        main_js = (HTML_ROOT / "js" / "main.js").read_text(encoding="utf-8")
        if "quiz-container" not in pages:
            self.assertNotIn("quiz_submit", main_js)
            self.assertNotIn("// === Quiz ===", main_js)
    def test_public_copy_uses_confirmed_engineer_visit_terms(self):
        forbidden = re.compile(
            r"бесплатн(?:ый|ого|ом|о)?\s+выезд|"
            r"выезд\s+(?:инженера|специалиста)[^<\n]{0,80}(?:бесплат|(?<!\d)0\s*₽)|"
            r"выедем[^<\n]{0,60}бесплат",
            re.IGNORECASE,
        )
        matches = []
        for path, text in production_pages():
            if forbidden.search(text):
                matches.append(path.relative_to(HTML_ROOT).as_posix())
        self.assertEqual([], matches)

    def test_city_pages_use_current_septic_starting_price(self):
        stale = []
        for city_page in (HTML_ROOT / "krym").glob("*/index.html"):
            text = city_page.read_text(encoding="utf-8")
            first_tile = re.search(r'<div class="service-tile__title">Септик под ключ</div>.*?<div class="service-tile__price">([^<]+)</div>', text, re.DOTALL)
            if not first_tile or first_tile.group(1).strip() != "от 140 000 ₽":
                stale.append(city_page.relative_to(HTML_ROOT).as_posix())
        self.assertEqual([], stale)
    def test_public_copy_uses_one_year_installation_warranty(self):
        matches = []
        pattern = re.compile(r"гаранти[^<\n]{0,50}2\s+год|2\s+года[^<\n]{0,50}гаранти", re.IGNORECASE)
        for path, text in production_pages():
            if pattern.search(text):
                matches.append(path.relative_to(HTML_ROOT).as_posix())
        self.assertEqual([], matches)


if __name__ == "__main__":
    unittest.main()
