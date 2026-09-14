import json
import re
import unittest
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


if __name__ == "__main__":
    unittest.main()
