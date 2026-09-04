import json
import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
SEPTIKI_PAGE = HTML_ROOT / "uslugi" / "septiki" / "index.html"
KANALIZACIYA_PAGE = HTML_ROOT / "uslugi" / "kanalizaciya" / "index.html"
PRICES_PAGE = HTML_ROOT / "tseny" / "index.html"
CITY_TEMPLATE = REPO_ROOT / "generators" / "city-septik-template.html"
LLMS_FILES = [HTML_ROOT / "llms.txt", HTML_ROOT / "llms-full.txt"]
ENGINEER_TERMS = (
    "Выезд инженера — 3 000–6 000 ₽. "
    "При заключении договора сумма возвращается."
)
SERVICE_SLUGS = {
    "elektrosnabzhenie",
    "gazosnabzhenie",
    "generatory",
    "kanalizaciya",
    "septiki",
    "vodosnabzhenie",
    "yuridicheskoe-soprovozhdenie-podklyuchenij",
    "zabory",
}


def city_pages():
    pages = sorted((HTML_ROOT / "krym").glob("*/septik-pod-kluch/index.html"))
    if len(pages) != 12:
        raise AssertionError(f"Expected exactly 12 city septic pages, found {len(pages)}")
    return pages


def city_sources():
    return [CITY_TEMPLATE, *city_pages()]


def json_ld_documents(path):
    source = path.read_text(encoding="utf-8")
    payloads = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        source,
        re.DOTALL | re.IGNORECASE,
    )
    return [json.loads(payload) for payload in payloads]


class ContentConsistencyTests(unittest.TestCase):
    def test_city_scope_is_exactly_twelve_pages_plus_the_template(self):
        self.assertEqual(12, len(city_pages()))
        self.assertEqual(13, len(city_sources()))

    def test_unconfirmed_offer_claims_are_not_published(self):
        targets = [SEPTIKI_PAGE, KANALIZACIYA_PAGE, *LLMS_FILES, *city_sources()]
        forbidden = re.compile(
            r"скидк[^<\n]{0,30}10\s*%|"
            r"забронировать\s+смету|"
            r"(?:в\s+течение|перезвоним\s+за)\s*(?:15|30)\s+минут|"
            r"без\s+откачки|"
            r"не\s+требует\s+откачки|"
            r"бесплатная\s+консультация\s+и\s+замер|"
            r"в\s+день\s+обращения|"
            r"чаще\s+всего",
            re.IGNORECASE,
        )
        failures = []
        for path in targets:
            if forbidden.search(path.read_text(encoding="utf-8")):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_city_pages_make_no_fixed_or_typical_timing_promise(self):
        forbidden = re.compile(
            r"срок\s+от\s+1\s+дня|"
            r"(?:обычно|стандартный\s+монтаж)[^.<\n]{0,100}1[–-]2\s+дн",
            re.IGNORECASE,
        )
        failures = []
        for path in city_sources():
            if forbidden.search(path.read_text(encoding="utf-8")):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_target_pages_use_the_same_confirmed_engineer_visit_terms(self):
        targets = [
            SEPTIKI_PAGE,
            KANALIZACIYA_PAGE,
            PRICES_PAGE,
            *LLMS_FILES,
            *city_sources(),
        ]
        missing = []
        for path in targets:
            source = path.read_text(encoding="utf-8")
            if ENGINEER_TERMS not in source:
                missing.append(path.relative_to(REPO_ROOT).as_posix())
            self.assertNotRegex(
                source,
                r"Выезд инженера (?:стоит|— 3 000–6 000 ₽ в зависимости от района)",
                path.relative_to(REPO_ROOT).as_posix(),
            )
        self.assertEqual([], missing)

    def test_calculator_shows_confirmed_base_price_without_invented_math(self):
        source = SEPTIKI_PAGE.read_text(encoding="utf-8")
        for key, price in {
            "zb2": "140000",
            "zb3": "180000",
            "plastic": "160000",
            "drain": "60000",
        }.items():
            self.assertRegex(source, rf"{key}:\s*\{{[^}}]*basePrice:\s*{price}\b")

        for token in [
            "DISCOUNT_RATE",
            "PIPE_COST_PER_METER",
            "FREE_PIPE_METERS",
            "multiplier:",
            "extraCost:",
            "val-discount",
            "val-multiplier",
            "val-region",
            "val-pipe",
            "val-extra",
            "val-raw",
            "btn-price",
        ]:
            self.assertNotIn(token, source)

        self.assertIn("Предварительно от", source)
        self.assertIn("Точную стоимость инженер рассчитает после выезда", source)
        self.assertIn("els.formPrice.value = 'Предварительно от ' + fmt(type.basePrice);", source)
        for name in ["septic_type", "region", "distance", "people", "price"]:
            self.assertIn(f'name="{name}"', source)

    def test_septic_catalogs_use_only_confirmed_variant_prices(self):
        expected = {
            "ЖБ кольца (2 кольца)": "140 000 ₽",
            "ЖБ кольца (3 кольца)": "180 000 ₽",
            "Пластиковый септик Панда": "160 000 ₽",
            "Панда Лайт": "198 000 ₽",
            "Панда Аэро": "197 050 ₽",
            "Дренажный колодец": "60 000 ₽",
        }
        targets = [PRICES_PAGE, HTML_ROOT / "llms-full.txt", *city_sources()]
        failures = []
        for path in targets:
            source = path.read_text(encoding="utf-8")
            for label, price in expected.items():
                if label not in source or price not in source:
                    failures.append(
                        f"{path.relative_to(REPO_ROOT).as_posix()}: {label} = {price}"
                    )
        self.assertEqual([], failures)

    def test_autonomous_sewer_price_is_scoped_to_confirmed_septic_package(self):
        for path in [KANALIZACIYA_PAGE, PRICES_PAGE]:
            source = path.read_text(encoding="utf-8")
            self.assertNotRegex(source, r"80\s*000\s*[–-]\s*150\s*000\s*₽")
            self.assertIn("Автономная канализация с септиком из 2 ЖБ колец", source)
            self.assertIn("от 140 000 ₽", source)

    def test_llms_files_list_all_live_services_without_stale_contact_or_absolutes(self):
        for path in LLMS_FILES:
            source = path.read_text(encoding="utf-8")
            for slug in SERVICE_SLUGS:
                self.assertIn(f"/uslugi/{slug}/", source, path.name)
            self.assertNotIn("info@kepstroy.ru", source)
            self.assertNotRegex(source, r"Работаем\s+с\s+20(?:15|16)\s+года")
            self.assertNotRegex(source, r"Гарантия\s+на\s+(?:все\s+)?работы\s*[—-]\s*1\s+год", path.name)
            self.assertNotIn("Оплата после приёмки", source)
            self.assertNotIn("Заключение СЭС", source)
            self.assertNotRegex(source, r"монтаж[^\n]{0,40}от\s+1\s+рабочего\s+дня")

    def test_public_company_pages_do_not_publish_conflicting_foundation_years(self):
        targets = [HTML_ROOT / "index.html", HTML_ROOT / "o-nas" / "index.html", *LLMS_FILES]
        failures = []
        pattern = re.compile(r"Работаем\s+с\s+20(?:15|16)\s+года", re.IGNORECASE)
        for path in targets:
            if pattern.search(path.read_text(encoding="utf-8")):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_septic_json_ld_uses_paid_visit_and_neutral_document_wording(self):
        documents = json_ld_documents(SEPTIKI_PAGE)
        self.assertTrue(documents)
        source = SEPTIKI_PAGE.read_text(encoding="utf-8")
        self.assertIn("Консультация по телефону — бесплатно.", source)
        self.assertIn(ENGINEER_TERMS, source)
        self.assertNotIn("заключение СЭС", source.lower())
        self.assertNotIn("не возникнет проблем", source.lower())
        self.assertIn("Перечень документов уточняется и фиксируется в договоре.", source)

    def test_city_provider_schema_has_no_fake_local_office(self):
        failures = []
        for path in city_pages():
            for document in json_ld_documents(path):
                nodes = document.get("@graph", [document])
                for node in nodes:
                    if node.get("@type") != "Service":
                        continue
                    provider = node.get("provider", {})
                    served = provider.get("areaServed", {})
                    if (
                        "address" in provider
                        or provider.get("@type") == "LocalBusiness"
                        or served.get("name") != "Республика Крым"
                    ):
                        failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_city_schema_offer_uses_confirmed_septic_price_range(self):
        failures = []
        for path in city_sources():
            for document in json_ld_documents(path):
                nodes = document.get("@graph", [document])
                for node in nodes:
                    if node.get("@type") != "Service":
                        continue
                    offer = node.get("offers", {})
                    if offer.get("lowPrice") != "140000" or offer.get("highPrice") != "198000":
                        failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_city_sources_label_shared_photos_as_generic_crimea_examples(self):
        forbidden = re.compile(
            r"Выполненные\s+объекты|"
            r"Реальные\s+работы,\s+которые|"
            r"Кейс:|"
            r"Отзывы\s+клиентов\s+из|"
            r"review-card|"
            r"case-item|"
            r"\$\{(?:review|case)",
            re.IGNORECASE,
        )
        failures = []
        for path in city_sources():
            source = path.read_text(encoding="utf-8")
            if forbidden.search(source) or "Примеры оборудования и работ в Крыму" not in source:
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_city_generic_gallery_images_exist(self):
        failures = []
        for path in city_pages():
            source = path.read_text(encoding="utf-8")
            gallery = source[source.index("<!-- Generic work examples -->") :]
            gallery = gallery[: gallery.index("<!-- Delivery -->")]
            for image_src in re.findall(r'<img\s+[^>]*src="([^"]+)"', gallery):
                target = (path.parent / image_src).resolve()
                if not target.exists():
                    failures.append(
                        f"{path.relative_to(REPO_ROOT).as_posix()}: {image_src}"
                    )
        self.assertEqual([], failures)

    def test_unconfirmed_warranty_and_payment_absolutes_are_removed_from_targets(self):
        forbidden = re.compile(
            r"гаранти\w*(?:\s+на\s+[^.<\n]{0,40})?\s+1\s+год|"
            r"оплата\s+после\s+при[её]мки",
            re.IGNORECASE,
        )
        failures = []
        for path in [SEPTIKI_PAGE, KANALIZACIYA_PAGE, *city_sources()]:
            if forbidden.search(path.read_text(encoding="utf-8")):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)


if __name__ == "__main__":
    unittest.main()
