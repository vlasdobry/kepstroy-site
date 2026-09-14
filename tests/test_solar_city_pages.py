import json
import re
import unittest
import xml.etree.ElementTree as ET
from difflib import SequenceMatcher
from html import unescape
from html.parser import HTMLParser
from itertools import combinations
from pathlib import Path
from unittest.mock import patch

from scripts import readiness_checks
from scripts.readiness_checks import (
    SOLAR_FORBIDDEN_CLAIMS,
    check_traffic_readiness,
    parse_html_contract,
    visible_text,
)
from tests.test_footer_services import service_footer_links


ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "html"
CITY_DATA = ROOT / "generators" / "city-septik-data.json"
GENERAL_PAGE = HTML / "uslugi" / "solnechnye-paneli" / "index.html"
SITE_ORIGIN = "https://kepstroy.ru"
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
MAX_LOCAL_COPY_SIMILARITY = 0.86


def city_solar_urls():
    return {
        f"{SITE_ORIGIN}/krym/{city['slug']}/solnechnye-paneli/"
        for city in city_registry()
    }


def sitemap_urls():
    return [
        node.text or ""
        for node in ET.parse(HTML / "sitemap.xml").iter(
            "{http://www.sitemaps.org/schemas/sitemap/0.9}loc"
        )
    ]


def robots_groups(source):
    groups = {}
    current_agents = []
    current_rules = []

    def save_group():
        for agent in current_agents:
            groups.setdefault(agent.lower(), []).extend(current_rules)

    for raw_line in source.splitlines() + [""]:
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            if current_agents:
                save_group()
                current_agents = []
                current_rules = []
            continue
        field, separator, value = line.partition(":")
        if not separator:
            continue
        field = field.strip().lower()
        value = value.strip()
        if field == "user-agent":
            if current_rules:
                save_group()
                current_agents = []
                current_rules = []
            current_agents.append(value)
        elif current_agents and field in {"allow", "disallow"}:
            current_rules.append((field, value))
    return groups


def robots_allows(source, user_agent, path):
    groups = robots_groups(source)
    agent = user_agent.lower()
    rules = groups[agent] if agent in groups else groups.get("*", [])
    matching_rules = [
        (len(pattern), directive == "allow")
        for directive, pattern in rules
        if pattern and path.startswith(pattern)
    ]
    if not matching_rules:
        return True
    _specificity, is_allowed = max(matching_rules)
    return is_allowed


def city_registry():
    return json.loads(CITY_DATA.read_text(encoding="utf-8"))["cities"]


def city_page(city):
    return HTML / "krym" / city["slug"] / "solnechnye-paneli" / "index.html"


def plain_text(source):
    return visible_text(source)


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


def local_copy_similarity(left, right):
    return SequenceMatcher(None, left, right, autojunk=False).ratio()


class ServicesTilesParser(HTMLParser):
    """Collect service cards from the `.services-tiles` section structurally."""

    def __init__(self):
        super().__init__()
        self.div_depth = 0
        self.services_depth = None
        self.current_card = None
        self.cards = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = set(attributes.get("class", "").split())
        if tag == "div":
            self.div_depth += 1
            if self.services_depth is None and "services-tiles" in classes:
                self.services_depth = self.div_depth
        elif (
            tag == "a"
            and self.services_depth is not None
            and "service-tile" in classes
        ):
            self.current_card = {"href": attributes.get("href"), "text": []}

    def handle_data(self, data):
        if self.current_card is not None:
            self.current_card["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.current_card is not None:
            self.current_card["text"] = " ".join(
                "".join(self.current_card["text"]).split()
            )
            self.cards.append(self.current_card)
            self.current_card = None
        elif tag == "div":
            if self.services_depth == self.div_depth:
                self.services_depth = None
            self.div_depth -= 1


def service_cards(source):
    parser = ServicesTilesParser()
    parser.feed(source)
    return parser.cards


class RobotsMetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = []

    def handle_starttag(self, tag, attrs):
        attributes = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "meta" and attributes.get("name", "").lower() == "robots":
            self.values.append(attributes.get("content", ""))


def robots_meta_values(source):
    parser = RobotsMetaParser()
    parser.feed(source)
    return parser.values


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
                contract = parse_html_contract(source)
                self.assertEqual([canonical], contract.canonicals)

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
                for head_token in (
                    '<meta name="color-scheme" content="light only">',
                    '<meta name="theme-color" content="#15803d">',
                    '<link rel="icon" type="image/svg+xml" href="/images/favicon/favicon.svg?v=2">',
                    "https://fonts.googleapis.com/css2?family=Manrope",
                    '<link rel="stylesheet" href="/css/style.css?v=20">',
                    '<link rel="preload" as="image" href="/images/solnechnye-paneli/solar-hero-960.webp"',
                    '<meta property="og:image:alt" content="Визуализация дома с солнечными панелями на крыше в Крыму">',
                ):
                    self.assertIn(head_token, source)

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

        for left_slug, right_slug in combinations(sorted(local_blocks), 2):
            similarity = local_copy_similarity(
                local_blocks[left_slug], local_blocks[right_slug]
            )
            self.assertLess(
                similarity,
                MAX_LOCAL_COPY_SIMILARITY,
                f"Local blocks for {left_slug} and {right_slug} are "
                f"{similarity:.1%} similar after city names are removed",
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
                lead_match = re.search(
                    r'<p\s+class="solar-lead">(.*?)</p>',
                    source,
                    re.IGNORECASE | re.DOTALL,
                )
                self.assertIsNotNone(lead_match)
                self.assertIn(
                    f"в {city['city_prepositional']}",
                    plain_text(lead_match.group(1)),
                )

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
                self.assertEqual(
                    "Солнечные панели и электростанции "
                    f"в {city['city_prepositional']}",
                    service.get("name"),
                )
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

                faq = next(node for node in nodes if node.get("@type") == "FAQPage")
                questions_section = re.search(
                    r'<section\s+id="questions".*?</section>',
                    source,
                    re.IGNORECASE | re.DOTALL,
                )
                self.assertIsNotNone(questions_section)
                visible_faq = [
                    (plain_text(question), plain_text(answer))
                    for question, answer in re.findall(
                        r"<details>\s*<summary>(.*?)</summary>\s*<p>(.*?)</p>\s*</details>",
                        questions_section.group(0),
                        re.IGNORECASE | re.DOTALL,
                    )
                ]
                schema_faq = [
                    (item["name"], item["acceptedAnswer"]["text"])
                    for item in faq.get("mainEntity", [])
                ]
                self.assertEqual(3, len(visible_faq))
                self.assertEqual(visible_faq, schema_faq)

    def test_neighbor_city_links_are_limited_valid_and_never_self_links(self):
        sources = self.require_all_sources()
        expected_slugs = {city["slug"] for city in city_registry()}
        city_names = {city["slug"]: city["city"] for city in city_registry()}

        for city in city_registry():
            with self.subTest(city=city["slug"]):
                section = re.search(
                    r"<section\b[^>]*data-solar-neighbors[^>]*>(.*?)</section>",
                    sources[city["slug"]],
                    re.IGNORECASE | re.DOTALL,
                )
                self.assertIsNotNone(section)
                links = re.findall(
                    r'<a\s+href="/krym/([^/]+)/solnechnye-paneli/">(.*?)</a>',
                    section.group(1),
                    re.IGNORECASE | re.DOTALL,
                )
                self.assertGreaterEqual(len(links), 1)
                self.assertLessEqual(len(links), 4)
                linked_slugs = [slug for slug, _label in links]
                self.assertEqual(len(linked_slugs), len(set(linked_slugs)))
                self.assertNotIn(city["slug"], linked_slugs)
                self.assertTrue(set(linked_slugs) <= expected_slugs)
                self.assertEqual(
                    [city_names[slug] for slug in linked_slugs],
                    [plain_text(label) for _slug, label in links],
                )

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
                forms = parse_html_contract(source).submit_forms
                self.assertEqual(1, len(forms))
                controls = forms[0]["controls"]
                self.assertTrue(
                    any(
                        control.get("name") == "form_source"
                        and control.get("value") == "kepstroy"
                        for control in controls
                    )
                )
                self.assertTrue(
                    any(
                        control.get("name") == "service"
                        and control.get("value")
                        == "Солнечные панели и электростанции"
                        for control in controls
                    )
                )
                self.assertTrue(
                    any(
                        control.get("name") in {"city", "locality"}
                        and control.get("value") == city["city"]
                        for control in controls
                    )
                )
                self.assertIn('href="/uslugi/solnechnye-paneli/"', source)
                self.assertIn(f'href="/krym/{city["slug"]}/"', source)

                hub = HTML / "krym" / city["slug"] / "index.html"
                hub_source = hub.read_text(encoding="utf-8")
                expected_city_solar = (
                    f'/krym/{city["slug"]}/solnechnye-paneli/'
                )
                solar_cards = [
                    card
                    for card in service_cards(hub_source)
                    if "solnechnye-paneli" in (card["href"] or "")
                ]
                self.assertEqual(1, len(solar_cards))
                self.assertEqual(expected_city_solar, solar_cards[0]["href"])
                self.assertNotEqual(
                    "/uslugi/solnechnye-paneli/", solar_cards[0]["href"]
                )
                self.assertIn(
                    f"в {city['city_prepositional']}", solar_cards[0]["text"]
                )

                footer_links = service_footer_links(hub_source)
                self.assertEqual(1, footer_links.count("/uslugi/solnechnye-paneli/"))
                self.assertNotIn(expected_city_solar, footer_links)

    def test_sitemap_indexes_every_city_solar_canonical_exactly_once(self):
        urls = sitemap_urls()
        expected_city_urls = city_solar_urls()

        self.assertEqual(len(urls), len(set(urls)), "sitemap contains duplicate URLs")
        self.assertEqual(65, len(urls), "sitemap must match all indexable pages")
        self.assertEqual(
            expected_city_urls,
            {url for url in urls if url.endswith("/solnechnye-paneli/") and "/krym/" in url},
        )
        for url in expected_city_urls:
            with self.subTest(url=url):
                self.assertEqual(1, urls.count(url))
        self.assertEqual(1, urls.count(f"{SITE_ORIGIN}/uslugi/solnechnye-paneli/"))

    def test_sitemap_exactly_matches_public_indexable_canonicals(self):
        html_pages = [
            path
            for path in HTML.rglob("*.html")
            if path.name != "yandex_42d19edda2426210.html"
        ]
        indexable_canonicals = []
        for path in html_pages:
            source = path.read_text(encoding="utf-8")
            if path.name == "404.html" or any(
                "noindex" in value.lower() for value in robots_meta_values(source)
            ):
                continue
            contract = parse_html_contract(source)
            self.assertEqual(
                1,
                len(contract.canonicals),
                path.relative_to(ROOT).as_posix(),
            )
            indexable_canonicals.extend(contract.canonicals)

        self.assertEqual(68, len(html_pages))
        self.assertEqual(65, len(indexable_canonicals))
        self.assertEqual(set(indexable_canonicals), set(sitemap_urls()))

    def test_city_solar_pages_are_indexable_and_allowed_by_robots(self):
        for city in city_registry():
            with self.subTest(city=city["slug"]):
                source = city_page(city).read_text(encoding="utf-8")
                canonical = (
                    f"{SITE_ORIGIN}/krym/{city['slug']}/solnechnye-paneli/"
                )
                self.assertEqual([canonical], parse_html_contract(source).canonicals)
                self.assertFalse(
                    any(
                        "noindex" in value.lower()
                        for value in robots_meta_values(source)
                    )
                )

        robots = (HTML / "robots.txt").read_text(encoding="utf-8")
        for agent in (
            "YandexBot",
            "YandexImages",
            "ChatGPT-User",
            "Claude-SearchBot",
            "PerplexityBot",
        ):
            for city in city_registry():
                path = f"/krym/{city['slug']}/solnechnye-paneli/"
                with self.subTest(agent=agent, path=path):
                    self.assertTrue(robots_allows(robots, agent, path))

    def test_robots_falls_back_to_wildcard_group(self):
        source = "User-agent: *\nAllow: /\n"
        self.assertTrue(
            robots_allows(
                source,
                "Claude-SearchBot",
                "/krym/jalta/solnechnye-paneli/",
            )
        )

    def test_robots_detects_path_level_block(self):
        source = "User-agent: *\nAllow: /\nDisallow: /krym/\n"
        self.assertFalse(
            robots_allows(
                source,
                "Claude-SearchBot",
                "/krym/jalta/solnechnye-paneli/",
            )
        )

    def test_robots_more_specific_allow_overrides_broader_disallow(self):
        source = (
            "User-agent: *\n"
            "Disallow: /krym/\n"
            "Allow: /krym/jalta/solnechnye-paneli/\n"
        )
        self.assertTrue(
            robots_allows(
                source,
                "Claude-SearchBot",
                "/krym/jalta/solnechnye-paneli/",
            )
        )

    def test_robots_allow_wins_at_equal_specificity(self):
        path = "/krym/jalta/solnechnye-paneli/"
        source = (
            "User-agent: *\n"
            f"Disallow: {path}\n"
            f"Allow: {path}\n"
        )
        self.assertTrue(robots_allows(source, "Claude-SearchBot", path))

    def test_robots_separate_bot_group_takes_precedence_over_wildcard(self):
        source = (
            "User-agent: *\n"
            "Disallow: /krym/\n\n"
            "User-agent: Claude-SearchBot\n"
            "Allow: /\n"
        )
        self.assertTrue(
            robots_allows(
                source,
                "Claude-SearchBot",
                "/krym/jalta/solnechnye-paneli/",
            )
        )

    def test_ai_discovery_files_list_main_and_city_solar_pages_once(self):
        expected_urls = city_solar_urls() | {
            f"{SITE_ORIGIN}/uslugi/solnechnye-paneli/"
        }
        for filename in ("llms.txt", "llms-full.txt"):
            source = (HTML / filename).read_text(encoding="utf-8")
            with self.subTest(filename=filename):
                for url in expected_urls:
                    self.assertEqual(1, source.count(url), url)
                listed_city_urls = set(
                    re.findall(
                        r"https://kepstroy\.ru/krym/[^\s)]+/solnechnye-paneli/",
                        source,
                    )
                )
                self.assertEqual(city_solar_urls(), listed_city_urls)

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

        forbidden_examples = {
            "efficiency_before_number": "Максимальная эффективность модуля достигает 24,6%.",
            "efficiency_after_number": "24,6% КПД подтверждает высокую производительность.",
            "named_delivery_date": "Поставка 5 сентября.",
            "numeric_delivery_date": "Поставка 05.09.2026.",
            "slash_delivery_date": "Доставка запланирована на 05/09/2026.",
            "word_installation_duration": "Монтаж за два дня.",
            "numeric_installation_duration": "Монтаж за 2 дня.",
            "working_day_duration": "Монтаж занимает 2 рабочих дня.",
            "word_warranty_15": "Гарантия на монтаж пятнадцать лет.",
            "word_warranty_30": "Гарантия на панели тридцати лет.",
            "word_compound_warranty": "Пятнадцатилетняя гарантия на оборудование.",
            "numeric_warranty": "Гарантия на монтаж 2 года.",
            "kilowatt_hours": "Система вырабатывает 900 кВт·ч в месяц.",
            "megawatt_hours_dot": "Годовая выработка системы 4 МВт·ч.",
            "megawatt_hours_space": "Годовая выработка системы 4 МВт ч.",
            "megawatt_hours_period": "Годовая выработка системы 4 МВт.ч.",
            "spelled_energy_unit": "Комплект даёт 1200 киловатт-часов в год.",
            "free_installation": "Предлагаем бесплатную установку оборудования.",
            "independence_absolute": "Вы получите полностью независимое электроснабжение.",
        }
        for case, copy in forbidden_examples.items():
            with self.subTest(case=case, copy=copy):
                self.assertTrue(is_forbidden(copy), copy)

        confirmed_examples = (
            "Двусторонняя генерация энергии.",
            "Панель генерирует энергию при мощности 650 Вт.",
            "Мощность панели 650 Вт.",
            "Стоимость доставки рассчитывается после уточнения адреса.",
            "Проектируем автономные, сетевые и гибридные системы.",
        )
        for copy in confirmed_examples:
            with self.subTest(copy=copy):
                self.assertFalse(is_forbidden(copy), copy)

    def test_visible_text_excludes_non_rendered_and_explicitly_hidden_content(self):
        source = """
        <head><title>24,6% КПД и бесплатная установка</title></head>
        <main>
          <p>Видимый подтверждённый текст.</p>
          <script>Поставка 5 сентября.</script>
          <style>.fake::before { content: "24,6% КПД"; }</style>
          <noscript>Гарантия на монтаж тридцать лет.</noscript>
          <template>Бесплатная установка.</template>
          <div hidden>Монтаж за два дня.</div>
          <div aria-hidden="true">Выработка 4 МВт·ч.</div>
        </main>
        """
        self.assertEqual("Видимый подтверждённый текст.", plain_text(source))

    def test_contract_parser_accepts_attribute_order_and_quote_variations(self):
        self.assertTrue(
            hasattr(readiness_checks, "parse_html_contract"),
            "readiness must expose structural HTML contract parsing",
        )
        source = """
        <link href='https://kepstroy.ru/krym/saki/solnechnye-paneli/'
              data-owner='generator' rel='stylesheet canonical'>
        <form method='POST' class='lead' action='/submit'>
          <input value='kepstroy' type='hidden' name='form_source'>
          <input value='Саки' name='locality' type='hidden'>
        </form>
        """
        contract = readiness_checks.parse_html_contract(source)
        self.assertEqual(
            ["https://kepstroy.ru/krym/saki/solnechnye-paneli/"],
            contract.canonicals,
        )
        self.assertEqual(1, len(contract.submit_forms))
        controls = contract.submit_forms[0]["controls"]
        self.assertIn(
            {"value": "kepstroy", "type": "hidden", "name": "form_source"},
            controls,
        )
        self.assertIn(
            {"value": "Саки", "name": "locality", "type": "hidden"}, controls
        )

    def test_similarity_guard_detects_city_only_and_one_word_variations(self):
        simferopol = {
            "city": "Симферополь",
            "city_genitive": "Симферополя",
            "city_dative": "Симферополе",
            "city_prepositional": "Симферополе",
            "slug": "simferopol",
        }
        sevastopol = {
            "city": "Севастополь",
            "city_genitive": "Севастополя",
            "city_dative": "Севастополе",
            "city_prepositional": "Севастополе",
            "slug": "sevastopol",
        }
        first = (
            "<p>Для объекта в Симферополе уточним профиль потребления, место "
            "размещения оборудования и параметры сети.</p>"
            "<p>До расчёта попросим схему кровли и перечень приборов.</p>"
        )
        near_duplicate = (
            "<p>Для объекта в Севастополе уточним профиль потребления, место "
            "размещения оборудования и состояние сети.</p>"
            "<p>До расчёта попросим схему кровли и перечень приборов.</p>"
        )
        similarity = local_copy_similarity(
            normalize_local_copy(first, simferopol),
            normalize_local_copy(near_duplicate, sevastopol),
        )
        self.assertGreaterEqual(similarity, MAX_LOCAL_COPY_SIMILARITY)


if __name__ == "__main__":
    unittest.main()
