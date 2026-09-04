import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "html" / "js" / "main.js"
SEPTIKI_PAGE = REPO_ROOT / "html" / "uslugi" / "septiki" / "index.html"
THANK_YOU_PAGE = REPO_ROOT / "html" / "spasibo" / "index.html"


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


if __name__ == "__main__":
    unittest.main()
