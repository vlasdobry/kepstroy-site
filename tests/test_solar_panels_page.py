import importlib.util
import copy
import json
import re
import shutil
import unittest
import uuid
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

from scripts.readiness_checks import parse_html_contract


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
        self.assertNotIn("image", product)
        self.assertIn(
            "Визуализация солнечной системы на частном доме.", text
        )
        for unconfirmed in ("sku", "gtin", "aggregateRating", "review", "warranty"):
            self.assertNotIn(unconfirmed, product)

    def test_main_faq_matches_the_complete_approved_question_set(self):
        text = self.page()
        expected_questions = [
            "Можно купить только солнечные панели?",
            "Есть ли панели в наличии?",
            "Доставляете ли по всему Крыму?",
            "Какие системы устанавливает КэпСтрой?",
            "Можно установить панели на крыше или на участке?",
            "От чего зависит стоимость электростанции под ключ?",
            "Можно ли использовать аккумуляторы для резерва при отключениях?",
        ]
        visible = [
            (re.sub(r"<[^>]+>", "", question).strip(), re.sub(r"<[^>]+>", "", answer).strip())
            for question, answer in re.findall(
                r"<details><summary>(.*?)</summary><p>(.*?)</p></details>",
                text,
                re.DOTALL,
            )
        ]
        faq = next(
            node for node in json_ld_nodes(text) if node.get("@type") == "FAQPage"
        )
        schema = [
            (item["name"], item["acceptedAnswer"]["text"])
            for item in faq["mainEntity"]
        ]

        self.assertEqual(expected_questions, [question for question, _ in visible])
        self.assertEqual(visible, schema)

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

    def test_request_copy_speaks_for_the_company_on_all_solar_pages(self):
        expected = "Оставьте номер. Мы уточним задачу и предложим следующий шаг."
        old_promises = (
            "Оставьте номер. Андрей уточнит задачу и предложит следующий шаг.",
            "Оставьте номер. Инженер уточнит задачу и предложит следующий шаг.",
        )
        paths = [
            ROOT / "generators" / "solar-main-template.html",
            ROOT / "generators" / "solar-city-template.html",
            PAGE,
            *sorted((HTML / "krym").glob("*/solnechnye-paneli/index.html")),
        ]
        self.assertEqual(15, len(paths))
        for path in paths:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=path.relative_to(ROOT).as_posix()):
                self.assertEqual(1, source.count(expected))
                for old_promise in old_promises:
                    self.assertNotIn(old_promise, source)

    def test_all_solar_pages_qualify_model_specific_characteristics(self):
        notice = "Характеристики сверяются по паспорту поставляемой модификации."
        pages = [PAGE, *sorted((HTML / "krym").glob("*/solnechnye-paneli/index.html"))]
        self.assertEqual(13, len(pages))
        for page in pages:
            source = page.read_text(encoding="utf-8")
            self.assertEqual(1, source.count(notice), str(page))

    def test_solar_sources_do_not_promise_unconfirmed_service_maintenance(self):
        paths = [
            ROOT / "generators" / "solar-main-template.html",
            ROOT / "generators" / "solar-city-template.html",
            ROOT / "generators" / "solar-city-content.json",
            HTML / "llms-full.txt",
            PAGE,
            *sorted((HTML / "krym").glob("*/solnechnye-paneli/index.html")),
        ]
        unsupported = re.compile(
            r"сервисн(?:ое|ого) обслужив|сервис силами|по сервису|"
            r"монтируем и обслуживаем|установк[^.]{0,80}и сервис",
            re.IGNORECASE,
        )
        for path in paths:
            self.assertNotRegex(path.read_text(encoding="utf-8"), unsupported, str(path))

    def test_every_solar_hero_exposes_two_explicit_buyer_paths_and_phone(self):
        pages = [PAGE, *sorted((HTML / "krym").glob("*/solnechnye-paneli/index.html"))]
        self.assertEqual(13, len(pages))

        for page in pages:
            source = page.read_text(encoding="utf-8")
            hero_match = re.search(
                r'<section\b[^>]*class="[^"]*solar-hero[^"]*"[^>]*>(.*?)</section>',
                source,
                re.IGNORECASE | re.DOTALL,
            )
            self.assertIsNotNone(hero_match, str(page))
            hero = hero_match.group(1)

            self.assertEqual(1, hero.count('data-solar-intent="turnkey"'), str(page))
            self.assertEqual(1, hero.count('data-solar-intent="panels"'), str(page))
            self.assertRegex(
                hero,
                re.compile(
                    r'<a\b[^>]*href="#calculator"[^>]*data-solar-intent="turnkey"[^>]*>'
                    r'.*?Подобрать систему под ключ.*?</a>',
                    re.IGNORECASE | re.DOTALL,
                ),
            )
            self.assertRegex(
                hero,
                re.compile(
                    r'<a\b[^>]*href="#panel"[^>]*data-solar-intent="panels"[^>]*>'
                    r'.*?Купить панели LONGi 650 Вт.*?20 000 ₽/шт\..*?В наличии и под заказ.*?</a>',
                    re.IGNORECASE | re.DOTALL,
                ),
            )
            self.assertIn('href="tel:+79784615962"', hero, str(page))
            self.assertIn("Итоговую стоимость системы рассчитаем после уточнения задачи.", hero)

    def test_every_solar_mobile_cta_names_the_primary_outcome(self):
        pages = [PAGE, *sorted((HTML / "krym").glob("*/solnechnye-paneli/index.html"))]
        self.assertEqual(13, len(pages))

        for page in pages:
            source = page.read_text(encoding="utf-8")
            mobile_cta = re.search(
                r'<div\s+class="solar-mobile-cta">(.*?)</div>',
                source,
                re.IGNORECASE | re.DOTALL,
            )
            self.assertIsNotNone(mobile_cta, str(page))
            self.assertIn(
                '<a href="#calculator" class="btn btn--primary">Подобрать систему</a>',
                mobile_cta.group(1),
                str(page),
            )
            self.assertIn(
                '<a href="tel:+79784615962">Позвонить</a>',
                mobile_cta.group(1),
                str(page),
            )

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
        self.assertEqual("solar-request-form", inputs["locality"].get("form"))
        self.assertTrue(
            {"order_scenario", "object_type", "primary_task", "monthly_consumption", "placement"}
            <= inputs.keys()
        )
        self.assertNotIn("system_type", inputs)
        self.assertEqual("1", inputs["panel_quantity"].get("min"))
        self.assertEqual("100", inputs["panel_quantity"].get("max"))
        self.assertNotIn("value", inputs["panel_quantity"])
        self.assertIn('id="panel-quantity-field"', text)
        self.assertRegex(
            text,
            re.compile(r'<div\b[^>]*id="panel-quantity-field"[^>]*\bhidden\b', re.I),
        )
        self.assertIn('action="/submit"', text)
        self.assertIn("/js/tracking.js", text)
        self.assertIn("/js/main.js", text)
        self.assertIn("/js/solnechnye-paneli.js", text)

        self.assertTrue(SCRIPT.exists(), "Solar calculator script must exist")
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertNotRegex(script, r"\b0\.65\b")
        self.assertNotRegex(script, r"\b20000\b")
        self.assertIn("data-panel-power-w", text)
        self.assertIn("data-panel-price-rub", text)

        calculator = re.search(
            r'<section\b[^>]*id="calculator"[^>]*>(.*?)</section>',
            text,
            re.IGNORECASE | re.DOTALL,
        )
        self.assertIsNotNone(calculator)
        calculator_text = calculator.group(1)
        self.assertIn("Подбор системы по вашей задаче", calculator_text)
        self.assertIn("Данные для подбора готовы", calculator_text)
        self.assertIn("Состав и стоимость системы уточним после проверки исходных данных", calculator_text)
        self.assertNotIn("10 панелей", calculator_text)
        self.assertNotIn("6,5 кВт", calculator_text)
        self.assertNotIn("200 000 ₽", calculator_text)

    def test_offer_mutation_drives_calculator_config_in_all_rendered_pages(self):
        module = self.solar_generator()
        cities, city_content, offer, main_template, city_template = module.load_inputs()
        mutated_offer = copy.deepcopy(offer)
        mutated_offer["panel_power_w"] = 720
        mutated_offer["panel_power_kw"] = 0.72
        mutated_offer["panel_price_rub"] = 23456

        rendered = module.render_pages(
            cities, city_content, mutated_offer, main_template, city_template
        )

        self.assertEqual(13, len(rendered))
        for path, source in rendered.items():
            self.assertIn('data-panel-power-w="720"', source, str(path))
            self.assertIn('data-panel-price-rub="23456"', source, str(path))
            calculator = re.search(
                r'<section\b[^>]*id="calculator"[^>]*>(.*?)</section>',
                source,
                re.IGNORECASE | re.DOTALL,
            )
            self.assertIsNotNone(calculator, str(path))
            self.assertNotIn("7,2 кВт", calculator.group(1), str(path))
            self.assertNotIn("234 560 ₽", calculator.group(1), str(path))

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
        city_solar_pages = list(
            (HTML / "krym").glob("*/solnechnye-paneli/index.html")
        )
        self.assertEqual(12, len(city_solar_pages))
        directory = re.search(
            r'<section\b[^>]*class="[^"]*solar-city-directory[^"]*"[^>]*>'
            r"(.*?)</section>",
            self.page(),
            re.IGNORECASE | re.DOTALL,
        )
        self.assertIsNotNone(directory)
        city_links = re.findall(
            r'href="/krym/[^/]+/solnechnye-paneli/"', directory.group(1)
        )
        self.assertEqual(12, len(city_links))

    def test_all_generated_solar_pages_use_the_current_css_cache_version(self):
        expected_version = "7"
        for template_name in ("solar-main-template.html", "solar-city-template.html"):
            template = (ROOT / "generators" / template_name).read_text(encoding="utf-8")
            self.assertIn(
                'href="/css/solnechnye-paneli.css?v=${solar_css_version}"',
                template,
            )
        pages = [PAGE, *sorted((HTML / "krym").glob("*/solnechnye-paneli/index.html"))]
        versions = []
        for page in pages:
            source = page.read_text(encoding="utf-8")
            matches = re.findall(
                r'href="/css/solnechnye-paneli\.css\?v=([0-9]+)"', source
            )
            self.assertEqual([expected_version], matches, str(page))
            versions.extend(matches)
        self.assertEqual({expected_version}, set(versions))

    def test_all_generated_solar_pages_use_the_current_js_cache_version(self):
        expected_version = "7"
        for template_name in ("solar-main-template.html", "solar-city-template.html"):
            template = (ROOT / "generators" / template_name).read_text(encoding="utf-8")
            self.assertIn(
                '<script src="/js/solnechnye-paneli.js?v=${solar_js_version}"></script>',
                template,
            )
        pages = [PAGE, *sorted((HTML / "krym").glob("*/solnechnye-paneli/index.html"))]
        versions = []
        for page in pages:
            source = page.read_text(encoding="utf-8")
            matches = re.findall(
                r'src="/js/solnechnye-paneli\.js\?v=([0-9]+)"', source
            )
            self.assertEqual([expected_version], matches, str(page))
            versions.extend(matches)
        self.assertEqual({expected_version}, set(versions))

    def test_main_solar_form_has_no_city_page_context(self):
        form = parse_html_contract(self.page()).submit_forms[0]
        self.assertNotIn("data-solar-city", form["attrs"])
        self.assertFalse(
            any(control.get("name") == "city" for control in form["controls"])
        )

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
