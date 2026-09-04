import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"
MAIN_JS = REPO_ROOT / "html" / "js" / "main.js"
MAIN_PAGE = HTML_ROOT / "index.html"
SEPTIKI_PAGE = REPO_ROOT / "html" / "uslugi" / "septiki" / "index.html"
THANK_YOU_PAGE = REPO_ROOT / "html" / "spasibo" / "index.html"
CITY_SEPTIK_TEMPLATE = REPO_ROOT / "generators" / "city-septik-template.html"


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
                self.assertTrue(targets["Заказать звонок"].startswith("tel:"))
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
