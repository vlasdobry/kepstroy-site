import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
MAIN_JS = REPO_ROOT / "html" / "js" / "main.js"
STYLE_CSS = REPO_ROOT / "html" / "css" / "style.css"
BLOG_CSS = REPO_ROOT / "html" / "css" / "blog.css"
MAIN_PAGE = HTML_ROOT / "index.html"
SEPTIKI_PAGE = REPO_ROOT / "html" / "uslugi" / "septiki" / "index.html"
THANK_YOU_PAGE = REPO_ROOT / "html" / "spasibo" / "index.html"
CITY_SEPTIK_TEMPLATE = REPO_ROOT / "generators" / "city-septik-template.html"
BLOG_FAQ_PAGES = [
    HTML_ROOT / "blog" / slug / "index.html"
    for slug in (
        "kak-vybrat-septik-dlya-chastnogo-doma-v-krymu",
        "kanalizaciya-v-chastnom-dome-krym",
        "septik-dlya-dachi-krym",
        "septik-ili-vygrebnaya-yama-krym",
        "septik-simferopol",
        "skolko-stoit-septik-pod-klyuch-krym",
        "ustanovka-septika-krym",
        "vodosnabzhenie-chastnogo-doma-krym",
        "zhibi-ili-plastik-septik-krym",
    )
]


def city_septik_sources():
    pages = sorted((HTML_ROOT / "krym").glob("*/septik-pod-kluch/index.html"))
    if len(pages) != 12:
        raise AssertionError(f"Expected 12 generated city septic pages, found {len(pages)}")
    return [CITY_SEPTIK_TEMPLATE, *pages]


def opening_tag_with_class(source, class_name):
    for match in re.finditer(r"<(?P<tag>[a-z][a-z0-9]*)\b(?P<attrs>[^>]*)>", source, re.IGNORECASE):
        attrs = dict(
            (name.lower(), value)
            for name, _, value in re.findall(
                r"([\w:-]+)\s*=\s*(['\"])(.*?)\2",
                match.group("attrs"),
                re.DOTALL,
            )
        )
        if class_name in attrs.get("class", "").split():
            return match.group("tag").lower(), attrs
    raise AssertionError(f"Element with class {class_name!r} was not found")


def prominent_cta_targets(source):
    targets = {}
    for match in re.finditer(
        r"<a\b(?P<attrs>[^>]*)>(?P<label>.*?)</a>",
        source,
        re.DOTALL | re.IGNORECASE,
    ):
        attrs = dict(
            (name.lower(), value)
            for name, _, value in re.findall(
                r"([\w:-]+)\s*=\s*(['\"])(.*?)\2",
                match.group("attrs"),
                re.DOTALL,
            )
        )
        if "btn" not in attrs.get("class", "").split():
            continue
        label = " ".join(re.sub(r"<[^>]+>", "", match.group("label")).split())
        if label in {"Рассчитать стоимость", "Заказать звонок"}:
            targets[label] = attrs.get("href")
    return targets


def universal_submit_handler(source):
    match = re.search(
        r"document\.querySelectorAll\('form\[action=\"/submit\"\]'\)"
        r"\.forEach\(form => \{(?P<body>.*?)\n\}\);",
        source,
        re.DOTALL,
    )
    if not match:
        raise AssertionError("Universal /submit form handler was not found")
    return match.group("body")


class FrontendFormContractsTests(unittest.TestCase):
    def test_mobile_navigation_has_no_gap_before_desktop_navigation(self):
        css = STYLE_CSS.read_text(encoding="utf-8")

        self.assertRegex(
            css,
            r"@media\s*\(min-width:\s*1024px\)\s*\{"
            r"(?:(?!@media)[\s\S])*?\.nav-main\s*\{\s*display:\s*flex;\s*\}"
            r"(?:(?!@media)[\s\S])*?\.menu-toggle\s*\{\s*display:\s*none;\s*\}",
        )
        self.assertNotRegex(
            css,
            r"@media\s*\(min-width:\s*769px\)\s*\{"
            r"(?:(?!@media)[\s\S])*?\.menu-toggle\s*\{\s*display:\s*none;\s*\}",
        )

    def test_menu_buttons_expose_the_controlled_menu_and_closed_state(self):
        for path in (MAIN_PAGE, SEPTIKI_PAGE):
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                page = path.read_text(encoding="utf-8")
                _, attrs = opening_tag_with_class(page, "menu-toggle")

                self.assertEqual("button", attrs.get("type"))
                self.assertEqual("false", attrs.get("aria-expanded"))
                controlled_id = attrs.get("aria-controls")
                self.assertIsNotNone(controlled_id)
                self.assertRegex(
                    page,
                    rf'<div\b[^>]*\bid=["\']{re.escape(controlled_id)}["\'][^>]*\bclass=["\'][^"\']*\bmobile-menu\b',
                )

    def test_blog_faq_questions_are_semantic_buttons_with_linked_answers(self):
        for path in BLOG_FAQ_PAGES:
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                page = path.read_text(encoding="utf-8")
                self.assertNotRegex(page, r'<p\b[^>]*class=["\']blog-faq__question["\']')
                items = re.findall(
                    r'<div class="blog-faq__item">(?P<body>.*?)</div>',
                    page,
                    re.DOTALL,
                )
                self.assertGreater(len(items), 0)
                for item in items:
                    button = re.search(
                        r'<button\b(?P<attrs>[^>]*)>',
                        item,
                    )
                    self.assertIsNotNone(button)
                    attrs = dict(
                        (name.lower(), value)
                        for name, _, value in re.findall(
                            r"([\w:-]+)\s*=\s*(['\"])(.*?)\2", button.group("attrs")
                        )
                    )
                    self.assertIn("blog-faq__question", attrs.get("class", "").split())
                    self.assertEqual("button", attrs.get("type"))
                    self.assertEqual("false", attrs.get("aria-expanded"))
                    answer_id = attrs.get("aria-controls")
                    self.assertIsNotNone(answer_id)
                    self.assertRegex(
                        item,
                        rf'<p\b[^>]*class="blog-faq__answer"[^>]*\bid="{re.escape(answer_id)}"',
                    )

    def test_primary_form_controls_have_programmatic_labels(self):
        expected = {
            MAIN_PAGE: {
                "home-cta-name": "Ваше имя",
                "home-cta-phone": "Телефон",
                "home-cta-service": "Тип работ",
                "home-modal-phone": "Телефон",
            },
            SEPTIKI_PAGE: {
                "calc-people": "Количество проживающих",
                "calc-region": "Район установки",
                "calc-distance": "Расстояние до дома",
                "calc-name": "Ваше имя",
                "calc-phone": "Телефон",
                "septic-name": "Ваше имя",
                "septic-phone": "Телефон",
                "septic-modal-name": "Ваше имя",
                "septic-modal-phone": "Телефон",
            },
        }

        for path, controls in expected.items():
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                page = path.read_text(encoding="utf-8")
                for control_id, label_text in controls.items():
                    self.assertRegex(
                        page,
                        rf'<(?:input|select)\b[^>]*\bid=["\']{re.escape(control_id)}["\']',
                    )
                    match = re.search(
                        rf'<label\b[^>]*\bfor=["\']{re.escape(control_id)}["\'][^>]*>(?P<label>.*?)</label>',
                        page,
                        re.DOTALL,
                    )
                    self.assertIsNotNone(match, f"Missing label for #{control_id}")
                    actual = " ".join(re.sub(r"<[^>]+>", "", match.group("label")).split())
                    self.assertEqual(label_text, actual)

    def test_main_and_septic_modals_expose_dialog_semantics(self):
        for path in (MAIN_PAGE, SEPTIKI_PAGE):
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                page = path.read_text(encoding="utf-8")
                _, attrs = opening_tag_with_class(page, "modal")
                self.assertEqual("dialog", attrs.get("role"))
                self.assertEqual("true", attrs.get("aria-modal"))
                title_id = attrs.get("aria-labelledby")
                self.assertIsNotNone(title_id)
                self.assertRegex(
                    page,
                    rf'<h3\b[^>]*\bid=["\']{re.escape(title_id)}["\'][^>]*class=["\']modal__title["\']',
                )

    def test_blog_tables_are_locally_scrollable(self):
        css = BLOG_CSS.read_text(encoding="utf-8")
        table_rule = re.search(r"\.blog-article\s+table\s*\{(?P<body>.*?)\}", css, re.DOTALL)
        self.assertIsNotNone(table_rule)
        declarations = table_rule.group("body")
        self.assertRegex(declarations, r"\bdisplay:\s*block\s*;")
        self.assertRegex(declarations, r"\bmax-width:\s*100%\s*;")
        self.assertRegex(declarations, r"\boverflow-x:\s*auto\s*;")

    def test_callback_anchor_accounts_for_the_sticky_header(self):
        css = STYLE_CSS.read_text(encoding="utf-8")
        self.assertRegex(
            css,
            r"#callback\s*\{[^}]*\bscroll-margin-top:\s*(?:[5-9]|\d{2,})rem\s*;[^}]*\}",
        )

    def test_calc_form_has_only_the_universal_submit_owner(self):
        page = SEPTIKI_PAGE.read_text(encoding="utf-8")
        main_js = MAIN_JS.read_text(encoding="utf-8")
        calc_script = page[page.index("const els = {") : page.index("// Init")]
        handler = universal_submit_handler(main_js)

        self.assertNotRegex(
            calc_script,
            r"calcForm\.addEventListener\(['\"]submit['\"]",
        )
        self.assertEqual(
            1,
            main_js.count("document.querySelectorAll('form[action=\"/submit\"]')"),
        )
        self.assertEqual(1, handler.count("form.addEventListener('submit'"))
        self.assertEqual(1, handler.count("fetch('/submit'"))

    def test_universal_handler_locks_form_before_waiting_for_tracking(self):
        handler = universal_submit_handler(MAIN_JS.read_text(encoding="utf-8"))

        tokens = [
            "if (form.dataset.submitting === 'true') return;",
            "form.dataset.submitting = 'true';",
            "submitBtn.disabled = true;",
            "await appendTrackingData(formData);",
        ]
        for token in tokens:
            self.assertIn(token, handler)

        guard, mark_submitting, disable_button, wait_for_tracking = map(handler.index, tokens)

        self.assertLess(guard, mark_submitting)
        self.assertLess(mark_submitting, wait_for_tracking)
        self.assertLess(disable_button, wait_for_tracking)
        self.assertLess(handler.index("try {"), wait_for_tracking)
        self.assertLess(wait_for_tracking, handler.index("catch (error)"))

    def test_universal_handler_releases_guard_and_restores_button_on_error(self):
        handler = universal_submit_handler(MAIN_JS.read_text(encoding="utf-8"))
        catch_body = handler[handler.index("catch (error)") :]

        self.assertIn("delete form.dataset.submitting;", catch_body)
        self.assertIn("submitBtn.disabled = false;", catch_body)
        self.assertIn("submitBtn.innerHTML = originalHtml;", catch_body)

    def test_thank_you_page_does_not_emit_form_submit_goal(self):
        page = THANK_YOU_PAGE.read_text(encoding="utf-8")
        handler = universal_submit_handler(MAIN_JS.read_text(encoding="utf-8"))

        self.assertNotIn("'reachGoal', 'form_submit'", page)
        self.assertLess(
            handler.index("if (response.ok)"),
            handler.index("trackGoal('form_submit')"),
        )

    def test_main_header_callback_opens_the_existing_modal(self):
        page = MAIN_PAGE.read_text(encoding="utf-8")
        tag, attrs = opening_tag_with_class(page, "header__callback")

        self.assertEqual("button", tag)
        self.assertEqual("button", attrs.get("type"))
        self.assertEqual("openModal()", attrs.get("onclick"))
        self.assertNotIn("href", attrs)
        self.assertIn('id="modalOverlay"', page)
        self.assertRegex(
            page,
            r"function\s+openModal\(\)\s*\{[^}]*getElementById\(['\"]modalOverlay['\"]\)",
        )

    def test_city_ctas_link_to_an_existing_callback_target(self):
        for path in city_septik_sources():
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                page = path.read_text(encoding="utf-8")
                self.assertNotIn('id="modalOverlay"', page)
                self.assertNotIn('onclick="openModal()"', page)

                targets = prominent_cta_targets(page)
                self.assertEqual(
                    {"Рассчитать стоимость", "Заказать звонок"},
                    set(targets),
                )
                self.assertEqual("#callback", targets["Рассчитать стоимость"])
                expected_tel = (
                    "tel:${phone}"
                    if path == CITY_SEPTIK_TEMPLATE
                    else "tel:+79784615962"
                )
                self.assertEqual(expected_tel, targets["Заказать звонок"])
                ids = set(re.findall(r'\bid=["\']([^"\']+)["\']', page))
                for target in targets.values():
                    self.assertIsNotNone(target)
                    self.assertTrue(
                        target.startswith("tel:")
                        or (target.startswith("#") and target[1:] in ids),
                        f"CTA target {target!r} does not exist in {path}",
                    )

    def test_all_same_page_fragment_links_resolve(self):
        broken = []
        for path in HTML_ROOT.rglob("*.html"):
            page = path.read_text(encoding="utf-8")
            ids = set(re.findall(r'\bid=["\']([^"\']+)["\']', page))
            for fragment in re.findall(r'\bhref=["\']#([^"\']+)["\']', page):
                if fragment not in ids:
                    broken.append(
                        f"{path.relative_to(HTML_ROOT).as_posix()}: #{fragment}"
                    )
        self.assertEqual([], broken)


if __name__ == "__main__":
    unittest.main()
