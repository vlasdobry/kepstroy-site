import json
import re
import unittest
from html import unescape
from pathlib import Path
from unittest.mock import patch

from scripts.readiness_checks import SOLAR_FORBIDDEN_CLAIMS, check_traffic_readiness


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "html"
CITY_DATA = ROOT / "generators" / "city-septik-data.json"
GENERAL_PAGE = HTML / "uslugi" / "solnechnye-paneli" / "index.html"
EXPECTED_SLUGS = {
    "alushta",
    "armjansk",
    "bahchisaraj",
    "dzhankoj",
    "evpatorija",
    "feodosija",
    "jalta",
    "kerch",
    "saki",
    "sevastopol",
    "simferopol",
    "sudak",
}


def city_registry():
    return json.loads(CITY_DATA.read_text(encoding="utf-8"))["cities"]


def city_page(city):
    return HTML / "krym" / city["slug"] / "solnechnye-paneli" / "index.html"


def plain_text(source):
    source = re.sub(
        r"<script\b.*?</script>|<style\b.*?</style>",
        " ",
        source,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", source)).split())


def json_ld_nodes(source):
    payloads = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        source,
        re.IGNORECASE | re.DOTALL,
    )
    nodes = []
    for payload in payloads:
        document = json.loads(payload)
        nodes.extend(document.get("@graph", [document]))
    return nodes


def nested_schema_types(value):
    types = []
    if isinstance(value, dict):
        node_type = value.get("@type")
        if isinstance(node_type, list):
            types.extend(node_type)
        elif node_type:
            types.append(node_type)
        for child in value.values():
            types.extend(nested_schema_types(child))
    elif isinstance(value, list):
        for child in value:
            types.extend(nested_schema_types(child))
    return types


def normalize_local_copy(source, city):
    normalized = plain_text(source).lower()
    city_tokens = {
        city.get("city", ""),
        city.get("city_genitive", ""),
        city.get("city_dative", ""),
        city.get("city_prepositional", ""),
        city.get("slug", ""),
    }
    for token in sorted(filter(None, city_tokens), key=len, reverse=True):
        normalized = re.sub(rf"\b{re.escape(token.lower())}\b", " ", normalized)
    normalized = re.sub(r"[^а-яёa-z0-9]+", " ", normalized, flags=re.IGNORECASE)
    return " ".join(normalized.split())


class SolarCityPagesTests(unittest.TestCase):
    def require_all_sources(self):
        paths = {city["slug"]: city_page(city) for city in city_registry()}
        missing = [
            path.relative_to(ROOT).as_posix()
            for path in paths.values()
            if not path.exists()
        ]
        self.assertEqual([], missing, f"Missing solar city pages: {missing}")
        return {
            slug: path.read_text(encoding="utf-8") for slug, path in paths.items()
        }

    def test_city_output_set_exactly_matches_the_twelve_city_registry_entries(self):
        registry_slugs = {city["slug"] for city in city_registry()}
        self.assertEqual(EXPECTED_SLUGS, registry_slugs)

        actual_slugs = {
            path.parent.parent.name
            for path in (HTML / "krym").glob("*/solnechnye-paneli/index.html")
        }
        self.assertEqual(EXPECTED_SLUGS, actual_slugs)

    def test_each_city_has_unique_metadata_h1_and_local_content(self):
        sources = self.require_all_sources()
        titles = {}
        descriptions = {}
        headings = {}
        local_blocks = {}

        for city in city_registry():
            with self.subTest(city=city["slug"]):
                source = sources[city["slug"]]
                canonical = (
                    "https://kepstroy.ru/krym/"
                    f"{city['slug']}/solnechnye-paneli/"
                )
                self.assertEqual(
                    [canonical],
                    re.findall(
                        r'<link\s+rel="canonical"\s+href="([^"]+)"', source
                    ),
                )

                title_matches = re.findall(r"<title>(.*?)</title>", source, re.DOTALL)
                description_matches = re.findall(
                    r'<meta\s+name="description"\s+content="([^"]+)"', source
                )
                h1_matches = re.findall(r"<h1\b[^>]*>(.*?)</h1>", source, re.DOTALL)
                local_matches = re.findall(
                    r"<section\b[^>]*data-solar-city-content[^>]*>(.*?)</section>",
                    source,
                    re.IGNORECASE | re.DOTALL,
                )
                self.assertEqual(1, len(title_matches))
                self.assertEqual(1, len(description_matches))
                self.assertEqual(1, len(h1_matches))
                self.assertEqual(1, len(local_matches))

                title = plain_text(title_matches[0])
                description = unescape(description_matches[0]).strip()
                h1 = plain_text(h1_matches[0])
                local_source = local_matches[0]
                local = plain_text(local_source)
                self.assertIn("Солнечные", h1)
                self.assertIn(f"в {city['city_prepositional']}", h1)
                self.assertIn(city["city"], title)
                self.assertIn(city["city"], description)
                self.assertGreaterEqual(len(local.split()), 60)
                self.assertGreaterEqual(
                    len(re.findall(r"<p\b", local_source, re.IGNORECASE)), 2
                )
                self.assertGreaterEqual(
                    len(re.findall(r"<li\b", local_source, re.IGNORECASE)), 3
                )

                titles[city["slug"]] = title
                descriptions[city["slug"]] = description
                headings[city["slug"]] = h1
                local_blocks[city["slug"]] = normalize_local_copy(
                    local_source, city
                )

        for label, values in (
            ("title", titles),
            ("description", descriptions),
            ("H1", headings),
            ("local block", local_blocks),
        ):
            self.assertEqual(
                len(EXPECTED_SLUGS),
                len(set(values.values())),
                f"Every city must have a unique {label}",
            )

    def test_direct_offer_is_server_rendered_immediately_after_h1(self):
        sources = self.require_all_sources()
        for city in city_registry():
            with self.subTest(city=city["slug"]):
                source = sources[city["slug"]]
                post_h1 = re.split(r"</h1>", source, maxsplit=1, flags=re.IGNORECASE)[1]
                first_80_words = " ".join(plain_text(post_h1).split()[:80]).lower()
                for expected in (
                    "кэпстрой",
                    "650 вт",
                    "20 000 ₽",
                    "в наличии",
                    "под заказ",
                    "монтаж",
                ):
                    self.assertIn(expected, first_80_words)

    def test_confirmed_offer_and_system_types_are_visible_without_javascript(self):
        sources = self.require_all_sources()
        for city in city_registry():
            with self.subTest(city=city["slug"]):
                visible = plain_text(sources[city["slug"]]).lower()
                for expected in (
                    "650 вт",
                    "20 000 ₽",
                    "в наличии",
                    "под заказ",
                    "монтаж",
                    "автономные",
                    "сетевые",
                    "гибридные",
                ):
                    self.assertIn(expected, visible)
                self.assertRegex(
                    visible,
                    re.compile(
                        r"(?:цена|стоимость)\s+(?:одной\s+)?панел[^.]{0,45}20\s*000\s*₽|"
                        r"20\s*000\s*₽[^.]{0,45}(?:цена|стоимость)\s+(?:одной\s+)?панел",
                        re.IGNORECASE,
                    ),
                )

    def test_schema_describes_local_service_product_offer_and_matching_faq(self):
        sources = self.require_all_sources()
        for city in city_registry():
            with self.subTest(city=city["slug"]):
                source = sources[city["slug"]]
                nodes = json_ld_nodes(source)
                node_types = {node.get("@type") for node in nodes}
                self.assertTrue(
                    {"BreadcrumbList", "Service", "Product", "FAQPage"}
                    <= node_types
                )
                self.assertNotIn("PostalAddress", nested_schema_types(nodes))

                service = next(node for node in nodes if node.get("@type") == "Service")
                area_served = service.get("areaServed")
                area_items = area_served if isinstance(area_served, list) else [area_served]
                served = {
                    (item or {}).get("@type"): (item or {}).get("name")
                    for item in area_items
                    if isinstance(item, dict)
                }
                self.assertEqual(city["city"], served.get("City"))
                self.assertEqual("Республика Крым", served.get("AdministrativeArea"))

                product = next(node for node in nodes if node.get("@type") == "Product")
                offer = product.get("offers", {})
                self.assertEqual("Offer", offer.get("@type"))
                self.assertEqual(20000, offer.get("price"))
                self.assertEqual("RUB", offer.get("priceCurrency"))
                self.assertEqual(
                    "https://schema.org/InStock", offer.get("availability")
                )

                visible = plain_text(source)
                faq = next(node for node in nodes if node.get("@type") == "FAQPage")
                self.assertGreaterEqual(len(faq.get("mainEntity", [])), 2)
                for item in faq["mainEntity"]:
                    self.assertIn(item["name"], visible)
                    self.assertIn(item["acceptedAnswer"]["text"], visible)

    def test_all_solar_pages_reject_unconfirmed_marketing_claims(self):
        sources = self.require_all_sources()
        targets = [(GENERAL_PAGE, GENERAL_PAGE.read_text(encoding="utf-8"))]
        targets.extend(
            (city_page(city), sources[city["slug"]]) for city in city_registry()
        )
        forbidden = SOLAR_FORBIDDEN_CLAIMS
        for path, source in targets:
            with self.subTest(path=path.relative_to(ROOT).as_posix()):
                visible = plain_text(source)
                for pattern in forbidden:
                    self.assertNotRegex(visible, re.compile(pattern, re.IGNORECASE))
                self.assertRegex(
                    visible,
                    re.compile(
                        r"(?:цена|стоимость)\s+(?:одной\s+)?панел[^.]{0,45}20\s*000\s*₽|"
                        r"20\s*000\s*₽[^.]{0,45}(?:цена|стоимость)\s+(?:одной\s+)?панел",
                        re.IGNORECASE,
                    ),
                )
                self.assertRegex(
                    visible,
                    re.compile(
                        r"(?:монтаж|инвертор|аккумулятор|комплектующ)[^.]{0,120}"
                        r"(?:рассчитыва|оплачива|стоимост)[^.]{0,80}(?:отдельно|индивидуально)",
                        re.IGNORECASE,
                    ),
                )

    def test_forms_and_reciprocal_internal_links_preserve_the_city(self):
        sources = self.require_all_sources()
        for city in city_registry():
            with self.subTest(city=city["slug"]):
                source = sources[city["slug"]]
                form_match = re.search(
                    r'<form\b[^>]*action="/submit"[^>]*>.*?</form>',
                    source,
                    re.IGNORECASE | re.DOTALL,
                )
                self.assertIsNotNone(form_match)
                form = form_match.group(0)
                self.assertRegex(
                    form,
                    r'<input[^>]+name="form_source"[^>]+value="kepstroy"',
                )
                self.assertRegex(
                    form,
                    r'<input[^>]+name="service"[^>]+value="Солнечные панели и электростанции"',
                )
                self.assertRegex(
                    form,
                    rf'name="(?:city|locality)"[^>]+value="{re.escape(city["city"])}"',
                )
                self.assertIn('href="/uslugi/solnechnye-paneli/"', source)
                self.assertIn(f'href="/krym/{city["slug"]}/"', source)

                hub = HTML / "krym" / city["slug"] / "index.html"
                self.assertIn(
                    f'href="/krym/{city["slug"]}/solnechnye-paneli/"',
                    hub.read_text(encoding="utf-8"),
                )

    def test_readiness_reports_missing_city_outputs_instead_of_crashing(self):
        original_exists = Path.exists

        def exists_except_solar_city_outputs(path):
            normalized = path.as_posix()
            if re.search(r"/html/krym/[^/]+/solnechnye-paneli/index\.html$", normalized):
                return False
            return original_exists(path)

        with patch.object(Path, "exists", autospec=True, side_effect=exists_except_solar_city_outputs):
            errors = []
            check_traffic_readiness(ROOT, errors)

            missing = [error for error in errors if "missing solar city page" in error]
            self.assertEqual(12, len(missing), errors)

    def test_readiness_claim_patterns_cover_variants_without_blocking_confirmed_copy(self):
        def is_forbidden(copy):
            return any(
                re.search(pattern, copy, re.IGNORECASE)
                for pattern in SOLAR_FORBIDDEN_CLAIMS
            )

        forbidden_examples = (
            "Поставка 5 сентября.",
            "Система вырабатывает 900 кВт·ч в месяц.",
            "Комплект даёт 1200 киловатт-часов в год.",
            "Панель генерирует 70 единиц энергии ежедневно.",
            "Предлагаем бесплатную установку оборудования.",
            "Вы получите полностью независимое электроснабжение.",
        )
        for copy in forbidden_examples:
            with self.subTest(copy=copy):
                self.assertTrue(is_forbidden(copy), copy)

        confirmed_examples = (
            "Двусторонняя генерация энергии.",
            "Мощность панели 650 Вт.",
            "Стоимость доставки рассчитывается после уточнения адреса.",
            "Проектируем автономные, сетевые и гибридные системы.",
        )
        for copy in confirmed_examples:
            with self.subTest(copy=copy):
                self.assertFalse(is_forbidden(copy), copy)


if __name__ == "__main__":
    unittest.main()
