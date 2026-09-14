import importlib.util
import json
import re
import shutil
import unittest
import uuid
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "html"
URL = "/uslugi/solnechnye-paneli/"
PAGE = HTML / "uslugi" / "solnechnye-paneli" / "index.html"
SCRIPT = HTML / "js" / "solnechnye-paneli.js"


class Elements(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.nodes = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))


def json_ld_nodes(text):
    documents = [
        json.loads(source)
        for source in re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', text, re.DOTALL
        )
    ]
    return [node for document in documents for node in document.get("@graph", [document])]


class SolarPanelsPageTests(unittest.TestCase):
    def page(self):
        self.assertTrue(PAGE.exists(), "Solar panels landing page must exist")
        return PAGE.read_text(encoding="utf-8")

    def test_page_metadata_schema_and_single_h1(self):
        text = self.page()
        self.assertEqual(1, len(re.findall(r"<h1\b", text)))
        self.assertIn(
            '<link rel="canonical" href="https://kepstroy.ru/uslugi/solnechnye-paneli/">',
            text,
        )
        self.assertIn(
            "Солнечные панели и электростанции под ключ в Крыму", text
        )
        self.assertIn(
            "Солнечные панели и электростанции в Крыму | КэпСтрой", text
        )
        self.assertNotIn("noindex", text.lower())

        nodes = json_ld_nodes(text)
        types = {node.get("@type") for node in nodes}
        self.assertTrue(
            {"Service", "Product", "BreadcrumbList", "FAQPage", "Person"} <= types
        )
        product = next(node for node in nodes if node.get("@type") == "Product")
        offer = product["offers"]
        self.assertEqual(20000, offer["price"])
        self.assertEqual("RUB", offer["priceCurrency"])
        self.assertEqual("https://schema.org/InStock", offer["availability"])
        for unconfirmed in ("sku", "gtin", "aggregateRating", "review", "warranty"):
            self.assertNotIn(unconfirmed, product)

    def test_offer_boundaries(self):
        text = self.page()
        visible = re.sub(r"<script\b.*?</script>|<style\b.*?</style>", " ", text, flags=re.I | re.S)
        visible = re.sub(r"<[^>]+>", " ", visible)
        visible = re.sub(r"\s+", " ", visible)
        for fact in ("650 Вт", "20 000 ₽", "в наличии", "под заказ", "по всему Крыму"):
            self.assertIn(fact.lower(), visible.lower())

        forbidden = (
            r"КПД.{0,30}24[,.]6",
            r"окупаем",
            r"бесплатн.{0,30}(?:достав|монтаж)",
            r"монтаж.{0,30}(?:за|в течение) 1 (?:день|дня)",
            r"15-летн.{0,30}гарант",
            r"30-летн.{0,30}гарант",
            r"полная независимость",
        )
        for pattern in forbidden:
            self.assertNotRegex(visible, re.compile(pattern, re.IGNORECASE))
        self.assertNotIn("—", visible)
        self.assertNotIn("–", visible)

    def test_form_and_calculator_contract(self):
        text = self.page()
        nodes = Elements(text).nodes
        inputs = {
            attrs.get("name"): attrs
            for tag, attrs in nodes
            if tag in {"input", "textarea", "select"} and attrs.get("name")
        }
        self.assertEqual("tel", inputs["phone"].get("type"))
        self.assertIn("required", inputs["phone"])
        self.assertNotIn("required", inputs["name"])
        self.assertNotIn("required", inputs["comment"])
        self.assertIn("required", inputs["consent"])
        self.assertNotIn("checked", inputs["consent"])
        self.assertEqual("kepstroy", inputs["form_source"].get("value"))
        self.assertEqual(
            "Солнечные панели и электростанции", inputs["service"].get("value")
        )
        self.assertTrue({"website", "company", "message"} <= inputs.keys())
        self.assertEqual("1", inputs["panel_quantity"].get("min"))
        self.assertEqual("100", inputs["panel_quantity"].get("max"))
        self.assertIn('action="/submit"', text)
        self.assertIn("/js/tracking.js", text)
        self.assertIn("/js/main.js", text)
        self.assertIn("/js/solnechnye-paneli.js", text)

        self.assertTrue(SCRIPT.exists(), "Solar calculator script must exist")
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertRegex(script, r"\b0\.65\b")
        self.assertRegex(script, r"\b20000\b")

    def test_local_anchors_images_and_assets(self):
        text = self.page()
        nodes = Elements(text).nodes
        ids = [attrs["id"] for _, attrs in nodes if "id" in attrs]
        self.assertEqual(len(ids), len(set(ids)))
        for tag, attrs in nodes:
            href = attrs.get("href", "")
            if href.startswith("#"):
                self.assertIn(href[1:], ids)
            if tag == "img" and attrs.get("src", "").startswith("/"):
                self.assertTrue((HTML / attrs["src"].lstrip("/")).exists(), attrs["src"])
                self.assertTrue(attrs.get("alt"), attrs["src"])
                self.assertIn("width", attrs)
                self.assertIn("height", attrs)

    def test_hubs_services_and_template_link_to_one_landing(self):
        paths = [
            HTML / "index.html",
            HTML / "krym" / "index.html",
            ROOT / "generators" / "city-index-template.html",
            HTML / "uslugi" / "generatory" / "index.html",
            HTML / "uslugi" / "elektrosnabzhenie" / "index.html",
        ]
        paths.extend(sorted((HTML / "krym").glob("*/index.html")))
        for path in paths:
            self.assertIn(f'href="{URL}"', path.read_text(encoding="utf-8"), str(path))
        self.assertFalse(list((HTML / "krym").glob("*/solnechnye-paneli/index.html")))

    def test_homepage_offer_card_schema_and_forms_use_confirmed_solar_offer(self):
        text = (HTML / "index.html").read_text(encoding="utf-8")
        for expected in (
            "Солнечные панели и электростанции",
            "Панели LONGi 650 Вт, подбор инверторов и аккумуляторов, монтаж систем по всему Крыму.",
            "20 000 ₽/шт.",
            "Рассчитать систему",
            'value="solnechnye-paneli"',
        ):
            self.assertIn(expected, text)

        offers = [
            node
            for node in json_ld_nodes(text)
            if node.get("@type") == "OfferCatalog"
        ]
        if not offers:
            offers = [
                node["hasOfferCatalog"]
                for node in json_ld_nodes(text)
                if isinstance(node, dict) and "hasOfferCatalog" in node
            ]
        self.assertTrue(offers)
        solar_services = [
            item.get("itemOffered", {}).get("name")
            for catalog in offers
            for item in catalog.get("itemListElement", [])
        ]
        self.assertIn("Солнечные панели и электростанции", solar_services)

    def test_every_public_footer_lists_solar_panels_once(self):
        failures = []
        for path in sorted(HTML.rglob("*.html")):
            text = path.read_text(encoding="utf-8")
            footer = re.search(r"<footer\b.*?</footer>", text, re.IGNORECASE | re.DOTALL)
            if not footer:
                continue
            count = footer.group(0).count(f'href="{URL}"')
            if count != 1:
                failures.append(f"{path.relative_to(ROOT).as_posix()}: {count}")
        self.assertEqual([], failures)

    def test_sitemap_and_ai_files_reference_canonical(self):
        urls = [
            node.text
            for node in ET.parse(HTML / "sitemap.xml").iter(
                "{http://www.sitemaps.org/schemas/sitemap/0.9}loc"
            )
        ]
        self.assertEqual(1, urls.count("https://kepstroy.ru" + URL))
        for filename in ("llms.txt", "llms-full.txt"):
            self.assertIn(URL, (HTML / filename).read_text(encoding="utf-8"), filename)

        short = (HTML / "llms.txt").read_text(encoding="utf-8")
        self.assertIn(
            "LONGi Hi-MO X10 Scientist 650 Вт по 20 000 ₽/шт., в наличии и под заказ.",
            short,
        )
        full = (HTML / "llms-full.txt").read_text(encoding="utf-8")
        section = full[full.index("### Солнечные панели и электростанции") :]
        next_heading = section.find("\n### ", 5)
        if next_heading != -1:
            section = section[:next_heading]
        for confirmed in (
            "650 Вт",
            "20 000 ₽",
            "в наличии и под заказ",
            "автономные, сетевые и гибридные системы",
            "по всему Крыму",
        ):
            self.assertIn(confirmed, section)
        for forbidden in ("24,6", "15-лет", "30-лет", "окупаем", "бесплатн"):
            self.assertNotIn(forbidden, section.lower())

        robots = (HTML / "robots.txt").read_text(encoding="utf-8")
        self.assertIn("User-agent: YandexBot\nAllow: /", robots)
        self.assertIn("User-agent: GPTBot\nAllow: /", robots)

    def solar_generator(self):
        script = ROOT / "generators" / "generate-solar-pages.py"
        self.assertTrue(script.exists(), "solar generator API is missing")
        spec = importlib.util.spec_from_file_location("solar_page_generator", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_generator_keeps_published_main_page_in_sync(self):
        module = self.solar_generator()
        rendered = module.render_pages(*module.load_inputs())
        main_path = Path("uslugi/solnechnye-paneli/index.html")
        self.assertEqual(PAGE.read_text(encoding="utf-8"), rendered[main_path])
        self.assertEqual(
            [], module.compare_outputs({main_path: rendered[main_path]}, HTML)
        )

    def test_generator_reports_exact_city_drift_for_main_only_fixture(self):
        module = self.solar_generator()
        rendered = module.render_pages(*module.load_inputs())
        main_path = Path("uslugi/solnechnye-paneli/index.html")

        expected_city_drift = {
            Path("krym") / city["slug"] / "solnechnye-paneli" / "index.html"
            for city in json.loads(
                (ROOT / "generators" / "city-septik-data.json").read_text(
                    encoding="utf-8"
                )
            )["cities"]
        }
        output_root = ROOT / "tests" / "solar-main-fixture.tmp" / uuid.uuid4().hex
        output_root.mkdir(parents=True)
        try:
            module.atomic_write(output_root / main_path, rendered[main_path])
            self.assertEqual(
                expected_city_drift,
                set(module.compare_outputs(rendered, output_root)),
            )
            self.assertEqual([], module.unexpected_outputs(rendered, output_root))
        finally:
            shutil.rmtree(output_root)
            try:
                output_root.parent.rmdir()
            except OSError:
                pass

    def test_repository_solar_generator_drift_is_a_complete_city_set_or_empty(self):
        module = self.solar_generator()
        rendered = module.render_pages(*module.load_inputs())
        city_paths = set(rendered) - {Path("uslugi/solnechnye-paneli/index.html")}
        changed = set(module.compare_outputs(rendered, HTML))

        self.assertIn(changed, (set(), city_paths))
        self.assertEqual([], module.unexpected_outputs(rendered, HTML))


if __name__ == "__main__":
    unittest.main()
