import json
import re
import unittest
from html import unescape
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
SEPTIKI_PAGE = HTML_ROOT / "uslugi" / "septiki" / "index.html"
KANALIZACIYA_PAGE = HTML_ROOT / "uslugi" / "kanalizaciya" / "index.html"
PRICES_PAGE = HTML_ROOT / "tseny" / "index.html"
HOME_PAGE = HTML_ROOT / "index.html"
CITY_TEMPLATE = REPO_ROOT / "generators" / "city-septik-template.html"
CITY_INDEX_TEMPLATE = REPO_ROOT / "generators" / "city-index-template.html"
CITY_DATA = REPO_ROOT / "generators" / "city-septik-data.json"
LLMS_FILES = [HTML_ROOT / "llms.txt", HTML_ROOT / "llms-full.txt"]
CONFIRMATIONS_REPORT = (
    REPO_ROOT / "docs" / "reports" / "kepstroy.ru" / "andrey-confirmations-required.md"
)
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
CONFIRMED_SEPTIC_PRICES = {
    "ЖБ кольца (2 кольца)": "140 000 ₽",
    "ЖБ кольца (3 кольца)": "180 000 ₽",
    "Пластиковый септик Панда": "160 000 ₽",
    "Панда Лайт": "198 000 ₽",
    "Панда Аэро": "197 050 ₽",
    "Дренажный колодец": "60 000 ₽",
}


def city_pages():
    pages = sorted((HTML_ROOT / "krym").glob("*/septik-pod-kluch/index.html"))
    if len(pages) != 12:
        raise AssertionError(f"Expected exactly 12 city septic pages, found {len(pages)}")
    return pages


def city_sources():
    return [CITY_TEMPLATE, *city_pages()]


def city_index_pages():
    pages = sorted((HTML_ROOT / "krym").glob("*/index.html"))
    if len(pages) != 12:
        raise AssertionError(f"Expected exactly 12 city index pages, found {len(pages)}")
    return pages


def production_html():
    return sorted(HTML_ROOT.rglob("*.html"))


def public_claim_sources():
    return [*production_html(), CITY_TEMPLATE, CITY_INDEX_TEMPLATE, CITY_DATA]


def plain_text(source):
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", source)).split())


def html_table_rows(source):
    rows = []
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", source, re.DOTALL | re.IGNORECASE):
        cells = [
            plain_text(cell)
            for cell in re.findall(
                r"<t[dh]\b[^>]*>(.*?)</t[dh]>", row, re.DOTALL | re.IGNORECASE
            )
        ]
        if len(cells) >= 2:
            rows.append((cells[0], cells[1]))
    return rows


def slice_between(source, start, end):
    return source[source.index(start) : source.index(end, source.index(start))]


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

    def test_city_delivery_is_quoted_only_after_the_object_address_is_known(self):
        failures = []
        forbidden = re.compile(
            r"\$\{delivery\}|"
            r"доставк[^.<\n]{0,100}(?:бесплат|от\s+\d[\d\s]*\s*₽)",
            re.IGNORECASE,
        )
        expected = "Стоимость доставки рассчитывается после уточнения адреса объекта."
        for path in city_sources():
            source = path.read_text(encoding="utf-8")
            if expected not in source or forbidden.search(source):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_homepage_has_no_unconfirmed_response_or_estimate_timing(self):
        source = HOME_PAGE.read_text(encoding="utf-8")
        forbidden = re.compile(
            r"(?:консультац|смет|расч[её]т|перезвон|свяж|выезд)"
            r"[^.<\n]{0,80}(?:сегодня|в\s+(?:тот\s+же\s+)?день"
            r"(?:\s+(?:обращения|звонка|заявки))?)|"
            r"(?:сегодня|в\s+тот\s+же\s+день)[^.<\n]{0,50}"
            r"(?:консультац|смет|расч[её]т|перезвон|свяж|выезд)|"
            r"обычно\s+в\s+течение\s+1[–-]2\s+дней|"
            r"(?:смет|расч[её]т|консультац|перезвон|свяж)"
            r"[^.<\n]{0,80}(?:5|10[–-]15|15|30)\s+минут|"
            r"работ[^.<\n]{0,60}(?:за|от)\s*(?:1|1[–-]3)\s+"
            r"(?:рабоч\w+\s+)?дн",
            re.IGNORECASE,
        )
        self.assertNotRegex(source, forbidden)
        self.assertIn("Свяжемся для уточнения задачи.", source)
        self.assertIn("Срок согласуем после осмотра участка.", source)
        self.assertIn("Работаем по всему Крыму", source)
        self.assertIn(ENGINEER_TERMS, source)

    def test_all_public_sources_avoid_exact_service_and_callback_timings(self):
        service_timing = re.compile(
            r"(?:монтаж|установ\w*|смонтир\w*|сдела\w*|"
            r"работ(?:ы|а|у|ами|ах)?)\b[^.!?]{0,100}"
            r"(?:за\s+|от\s+|занима\w*\s+)?"
            r"(?:\d+(?:[,.]\d+)?|один)(?:[–-]\d+)?\s+"
            r"(?:рабоч\w+\s+)?(?:час\w*|д(?:ень|ня|ней)|недел\w*)|"
            r"(?:\d+(?:[,.]\d+)?|один)(?:[–-]\d+)?\s+"
            r"(?:рабоч\w+\s+)?(?:час\w*|д(?:ень|ня|ней)|недел\w*)"
            r"[^.!?]{0,80}(?:монтаж|срок\s+работ)",
            re.IGNORECASE,
        )
        callback_timing = re.compile(
            r"(?:перезвон|свяж|ответ|звон|рассчита|смет|консультац)"
            r"[^.!?]{0,100}(?:5|10[–-]15|15|30)\s+минут|"
            r"(?:5|10[–-]15|15|30)\s+минут[^.!?]{0,100}"
            r"(?:перезвон|свяж|ответ|звон|рассчита|смет|консультац)",
            re.IGNORECASE,
        )
        failures = []
        for path in public_claim_sources():
            source = path.read_text(encoding="utf-8")
            text = plain_text(source) if path.suffix == ".html" else source
            if (
                service_timing.search(text)
                or callback_timing.search(text)
                or re.search(r"в\s+день\s+заявки", text, re.IGNORECASE)
            ):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_unverified_company_absolutes_are_absent_sitewide(self):
        forbidden = re.compile(
            r"(?:100|200)\+\s+(?:(?:реализованн\w+|выполненн\w+)\s+)?(?:объект|проект)|"
            r"(?:10\+|более\s+10)\s+лет|"
            r"гаранти\w*[^.!?<\n]{0,70}(?:1\s+год|12\s+месяц)|"
            r"(?:1\s+год|12\s+месяц)[^.!?<\n]{0,70}гаранти\w*|"
            r"нет\s+обязательной\s+предоплат|"
            r"оплат\w*[^.!?<\n]{0,80}(?:после\s+(?:при[её]мк|результат)|"
            r"по\s+факт|поэтап)|"
            r"доводим\s+до\s+результата\s+любое",
            re.IGNORECASE,
        )
        failures = []
        for path in public_claim_sources():
            source = path.read_text(encoding="utf-8")
            text = plain_text(source) if path.suffix == ".html" else source
            text = text.replace(ENGINEER_TERMS, "")
            if forbidden.search(text):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_drilling_is_not_presented_as_a_confirmed_company_service(self):
        offering_pages = [
            HOME_PAGE,
            PRICES_PAGE,
            HTML_ROOT / "uslugi" / "vodosnabzhenie" / "index.html",
            HTML_ROOT / "krym" / "index.html",
            *city_index_pages(),
            CITY_INDEX_TEMPLATE,
            *LLMS_FILES,
        ]
        failures = []
        for path in offering_pages:
            if re.search(r"бурен|скважин", path.read_text(encoding="utf-8"), re.I):
                failures.append(path.relative_to(REPO_ROOT).as_posix())

        water_article = (
            HTML_ROOT / "blog" / "vodosnabzhenie-chastnogo-doma-krym" / "index.html"
        ).read_text(encoding="utf-8")
        self.assertNotRegex(
            water_article,
            r"чаще\s+всего\s+бурим|от\s+проекта\s+и\s+бурения|"
            r'href="/uslugi/vodosnabzhenie/"[^>]*>скважин',
        )
        self.assertEqual([], failures)

    def test_unconfirmed_non_septic_price_tables_use_neutral_estimates(self):
        targets = [
            KANALIZACIYA_PAGE,
            PRICES_PAGE,
            HTML_ROOT / "uslugi" / "vodosnabzhenie" / "index.html",
            HTML_ROOT / "uslugi" / "zabory" / "index.html",
            HTML_ROOT / "uslugi" / "elektrosnabzhenie" / "index.html",
        ]
        keywords = re.compile(
            r"прокладка\s+труб|центральн\w+\s+сет|насосн|разводка\s+труб|"
            r"профнастил|штакетник|рабица|деревянный\s+забор|"
            r"технических\s+условий|трубостойк|сетевой\s+компани",
            re.IGNORECASE,
        )
        failures = []
        for path in targets:
            for label, price in html_table_rows(path.read_text(encoding="utf-8")):
                if keywords.search(label) and "₽" in price:
                    failures.append(
                        f"{path.relative_to(REPO_ROOT).as_posix()}: {label} = {price}"
                    )
        self.assertEqual([], failures)

        for path in [HOME_PAGE, CITY_INDEX_TEMPLATE, *city_index_pages()]:
            source = path.read_text(encoding="utf-8")
            for title in ["Канализация", "Водоснабжение", "Заборы", "Электроснабжение"]:
                cards = re.findall(
                    rf'class="service-tile__title">[^<]*{title}[^<]*<.*?'
                    rf'class="service-tile__price">([^<]+)',
                    source,
                    re.DOTALL | re.IGNORECASE,
                )
                for value in cards:
                    self.assertNotRegex(value, r"\d", f"{path}: {title} = {value}")

    def test_unconfirmed_non_septic_tariffs_are_not_published_as_exact_offers(self):
        subject = (
            r"(?:центральн\w*\s+(?:канализац\w*|сет\w*)|"
            r"(?:прокладк\w*|трасс\w*|канализационн\w*)"
            r"[^\n]{0,40}труб\w*|"
            r"насос\w*|"
            r"(?:подключен\w*|монтаж\w*)\s+(?:к\s+)?"
            r"(?:водопровод\w*|водоснабжен\w*|электроснабжен\w*|электросет\w*)|"
            r"(?:монтаж\w*|строительств\w*)\s+забор\w*)"
        )
        exact_price = r"\d[\d\s]*(?:[–-]\d[\d\s]*)?\s*₽"
        forbidden = re.compile(
            rf"(?:{subject})[^\n]*{exact_price}|"
            rf"{exact_price}[^\n]*(?:{subject})",
            re.IGNORECASE,
        )
        failures = []
        for path in public_claim_sources():
            text = path.read_text(encoding="utf-8").replace(ENGINEER_TERMS, "")
            if forbidden.search(text):
                failures.append(path.relative_to(REPO_ROOT).as_posix())
        self.assertEqual([], failures)

    def test_main_and_septic_galleries_do_not_claim_unverified_completed_cases(self):
        targets = {
            HOME_PAGE: ("<!-- Cases (Before/After) -->", "<!-- Call CTA Block"),
            SEPTIKI_PAGE: ("<!-- Примеры оборудования -->", "<!-- Форма заявки -->"),
        }
        cities = r"Симферопол|Севастопол|Ялт|Евпатори|Фиолент"
        for path, markers in targets.items():
            section = slice_between(path.read_text(encoding="utf-8"), *markers)
            self.assertIn("Примеры оборудования и этапов работ по Крыму", section)
            self.assertNotRegex(
                section,
                rf"Выполненн\w+\s+работ|реализац\w+\s+объект|{cities}|"
                r"case-stat|case-card__meta",
                path.as_posix(),
            )
            self.assertGreaterEqual(
                len(re.findall(r"images/[^'\"<]+\.(?:jpg|webp|png)", section)),
                4,
                path.as_posix(),
            )

        home = HOME_PAGE.read_text(encoding="utf-8")
        self.assertNotIn('id="reviews"', home)
        self.assertNotRegex(home, r"Авито\s+и\s+Яндекс\.Карт")
        for path in [HOME_PAGE, SEPTIKI_PAGE]:
            source = path.read_text(encoding="utf-8")
            self.assertNotIn("review-card", source, path.as_posix())
            self.assertNotIn('aria-label="5 из 5 звезд"', source, path.as_posix())

    def test_main_workflow_has_no_fixed_price_or_post_acceptance_payment_promise(self):
        source = HOME_PAGE.read_text(encoding="utf-8")
        workflow = slice_between(
            source, '<section id="workflow"', '<section id="real-works"'
        )
        forbidden = re.compile(
            r"(?:фиксир\w*[^.<]{0,40}цен\w*|цен\w*[^.<]{0,40}фиксир\w*)|"
            r"(?:оплат\w*[^.<]{0,80}(?:при[её]м|провер)|"
            r"(?:при[её]м|провер)[^.<]{0,80}оплат\w*)",
            re.IGNORECASE,
        )
        self.assertNotRegex(workflow, forbidden)
        self.assertIn("После осмотра согласуем состав работ и смету.", workflow)
        self.assertIn("Сдача объекта", workflow)
        self.assertIn(
            "Проверяем результат и передаём объект заказчику.", workflow
        )

    def test_listed_blog_service_timelines_are_non_contractual_and_not_exact(self):
        targets = {
            HTML_ROOT / "blog" / "podklyuchenie-gaza-krym-2026" / "index.html": (
                "Средний срок",
                "20 рабочих дней",
                "30 дней",
                "пару месяцев",
            ),
            HTML_ROOT / "blog" / "vodosnabzhenie-chastnogo-doma-krym" / "index.html": (
                "1–5 дней",
                "2–7 дней",
                "1–3 месяца",
            ),
            HTML_ROOT / "blog" / "ustanovka-septika-krym" / "index.html": (
                "<td>1 день</td>",
                "<td>2 дня</td>",
                "<td>3 дня и более</td>",
                "Первый день обычно",
            ),
        }
        for path, forbidden in targets.items():
            source = path.read_text(encoding="utf-8")
            for claim in forbidden:
                self.assertNotIn(claim, source, path.as_posix())
            self.assertRegex(source, r"Срок[^.<]{0,100}(?:услов|соглас|сетев)")

    def test_listed_price_and_guarantee_promises_are_contract_scoped(self):
        targets = [
            HOME_PAGE,
            HTML_ROOT / "llms-full.txt",
            HTML_ROOT / "o-nas" / "index.html",
            PRICES_PAGE,
        ]
        forbidden = re.compile(
            r"фиксированн\w+\s+цен|без\s+скрыт\w+\s+платеж|"
            r"смета\s+не\s+измен",
            re.IGNORECASE,
        )
        for path in targets:
            self.assertNotRegex(path.read_text(encoding="utf-8"), forbidden, path.name)

        water = (HTML_ROOT / "uslugi" / "vodosnabzhenie" / "index.html").read_text(
            encoding="utf-8"
        )
        self.assertNotRegex(water, r"да[её]м\s+гаранти", "vodosnabzhenie")
        self.assertIn("Условия гарантии фиксируются в договоре", water)

    def test_city_data_contains_no_unverified_case_review_or_delivery_claims(self):
        cities = json.loads(CITY_DATA.read_text(encoding="utf-8"))["cities"]
        forbidden_keys = {
            "delivery",
            "case_title",
            "case_text",
            "case_price",
            "case_duration",
            "case_residents",
            "case_distance",
            "reviews",
        }
        failures = [city["slug"] for city in cities if forbidden_keys & city.keys()]
        self.assertEqual([], failures)

    def test_city_visit_copy_uses_movement_grammar_and_neutral_faq_logic(self):
        data = json.loads(CITY_DATA.read_text(encoding="utf-8"))["cities"]
        template = CITY_TEMPLATE.read_text(encoding="utf-8")
        self.assertNotIn("Выезд в ${city_dative}", template)
        self.assertIn("выезда на объект в городе ${city_dative}", template)
        self.assertIn("Дату выезда согласуем по телефону.", template)
        self.assertIn("Срок работ определим после осмотра участка", template)
        pages_by_slug = {path.parents[1].name: path for path in city_pages()}
        for city in data:
            path = pages_by_slug[city["slug"]]
            source = path.read_text(encoding="utf-8")
            self.assertNotIn(f"Выезд в {city['city_dative']}", source)
            self.assertIn(f"выезда на объект в городе {city['city_dative']}", source)
            self.assertIn("Дату выезда согласуем по телефону.", source)
            self.assertIn("Срок работ определим после осмотра участка", source)

    def test_calculator_static_recommendation_matches_neutral_js_copy(self):
        source = SEPTIKI_PAGE.read_text(encoding="utf-8")
        static_match = re.search(
            r'id="people-recommendation"[^>]*>([^<]+)</p>', source
        )
        self.assertIsNotNone(static_match)
        static_copy = static_match.group(1).strip()
        js_copies = re.findall(
            r"'(?:1-2|3-4|5-6|7\+)':\s*'([^']+)'", source
        )
        self.assertEqual(4, len(js_copies))
        self.assertEqual({static_copy}, set(js_copies))
        self.assertEqual(
            "Выбор показывает базовый ориентир. Подходящую модель и итоговую "
            "стоимость инженер подтвердит после осмотра участка.",
            static_copy,
        )

    def test_llms_water_supply_does_not_claim_unconfirmed_drilling(self):
        for path in LLMS_FILES:
            source = path.read_text(encoding="utf-8")
            self.assertNotRegex(source, r"бурен|скважин", path.name)
            self.assertIn("/uslugi/vodosnabzhenie/", source, path.name)
            self.assertRegex(source, r"Подключение[^.\n]{0,60}сет", path.name)

    def test_owner_confirmation_registry_tracks_all_deferred_claims(self):
        self.assertTrue(CONFIRMATIONS_REPORT.exists())
        source = CONFIRMATIONS_REPORT.read_text(encoding="utf-8")
        required = [
            "бурение",
            "год основания",
            "200+",
            "гарантия",
            "оплата",
            "срок монтажа",
            "цены и сроки кейсов по септикам",
            "СЭС",
            "центральная канализация",
            "прокладка труб",
            "насос",
            "забор",
            "электроснабжение",
        ]
        missing = [item for item in required if item.lower() not in source.lower()]
        self.assertEqual([], missing)

    def test_target_pages_use_the_same_confirmed_engineer_visit_terms(self):
        targets = [
            SEPTIKI_PAGE,
            KANALIZACIYA_PAGE,
            PRICES_PAGE,
            *LLMS_FILES,
            *city_sources(),
            CITY_INDEX_TEMPLATE,
            *city_index_pages(),
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
        expected = {
            "zb2": "140000",
            "zb3": "180000",
            "plastic": "160000",
            "drain": "60000",
        }
        config = slice_between(source, "const SEPTIC_TYPES = {", "};")
        actual = dict(
            re.findall(
                r"(\w+):\s*\{[^}]*basePrice:\s*(\d+)\b",
                config,
                re.DOTALL,
            )
        )
        self.assertEqual(expected, actual)

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

    def test_calculator_dom_references_resolve_and_removed_ids_stay_removed(self):
        source = SEPTIKI_PAGE.read_text(encoding="utf-8")
        calculator = slice_between(
            source, "// ========== CALCULATOR ==========", "// Modal"
        )
        referenced_ids = set(re.findall(r"document\.getElementById\('([^']+)'\)", calculator))
        document_ids = set(re.findall(r'\bid="([^"]+)"', source))
        self.assertTrue(referenced_ids)
        self.assertEqual(set(), referenced_ids - document_ids)
        for stale_id in [
            "val-discount",
            "val-multiplier",
            "val-region",
            "val-pipe",
            "val-extra",
            "val-raw",
            "btn-price",
        ]:
            self.assertNotIn(stale_id, referenced_ids)
            self.assertNotIn(stale_id, document_ids)
        self.assertRegex(calculator, r"parseInt\([^)]*,\s*10\)\s*\|\|\s*5")

    def test_septic_catalogs_use_only_confirmed_variant_prices(self):
        html_targets = [PRICES_PAGE, *city_sources()]
        failures = []
        for path in html_targets:
            source = path.read_text(encoding="utf-8")
            if path == PRICES_PAGE:
                section = slice_between(source, ">Септики</h3>", ">Канализация</h3>")
            else:
                section = slice_between(source, "Цены на установку септика", "<!-- Generic work examples -->")
            actual = {
                label: price
                for label, price in html_table_rows(section)
                if "₽" in price
            }
            if actual != CONFIRMED_SEPTIC_PRICES:
                failures.append(
                    f"{path.relative_to(REPO_ROOT).as_posix()}: {actual}"
                )

        llms = (HTML_ROOT / "llms-full.txt").read_text(encoding="utf-8")
        llms_section = slice_between(llms, "Типы септиков:", "Особенности монтажа")
        llms_pairs = dict(
            re.findall(r"\*\*([^*]+)\*\*\s+—\s+([\d ]+₽)", llms_section)
        )
        if llms_pairs != CONFIRMED_SEPTIC_PRICES:
            failures.append(f"html/llms-full.txt: {llms_pairs}")
        self.assertEqual([], failures)

    def test_city_indexes_use_confirmed_septic_price_and_crimea_organization(self):
        data = json.loads(CITY_DATA.read_text(encoding="utf-8"))["cities"]
        template = CITY_INDEX_TEMPLATE.read_text(encoding="utf-8")
        sources = [(CITY_INDEX_TEMPLATE, template)]
        pages = {path.parent.name: path for path in city_index_pages()}
        for city in data:
            page = pages[city["slug"]]
            sources.append((page, page.read_text(encoding="utf-8")))

        for path, source in sources:
            match = re.search(
                r'class="service-tile__title">Септик под ключ</div>.*?'
                r'class="service-tile__price">([^<]+)</div>',
                source,
                re.DOTALL,
            )
            self.assertIsNotNone(match, path.as_posix())
            self.assertEqual("от 140 000 ₽", match.group(1).strip(), path.as_posix())
            self.assertNotIn('"@type": "LocalBusiness"', source, path.as_posix())
            self.assertNotIn('"addressLocality"', source, path.as_posix())
            self.assertIn('"@type": "Organization"', source, path.as_posix())
            self.assertRegex(
                source,
                r'"areaServed"\s*:\s*\{[^}]*"Республика Крым"',
                path.as_posix(),
            )

        self.assertIn("в городе ${city}", template)
        self.assertIn("Выезд на объект согласуем заранее", template)
        for city in data:
            source = pages[city["slug"]].read_text(encoding="utf-8")
            self.assertIn(f"в городе {city['city']}", source)
            self.assertIn("Выезд на объект согласуем заранее", source)

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
