import importlib.util
import io
import shutil
import unittest
import uuid
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "audit_static_site", ROOT / "scripts" / "audit-static-site.py"
)
AUDIT = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(AUDIT)


class StaticAuditSafetyTests(unittest.TestCase):
    def setUp(self):
        self.original_repo_root = AUDIT.REPO_ROOT
        self.original_html_root = AUDIT.HTML_ROOT

    def tearDown(self):
        AUDIT.REPO_ROOT = self.original_repo_root
        AUDIT.HTML_ROOT = self.original_html_root

    def run_fixture(self, markup):
        base = ROOT / "tests" / "audit-tools.tmp"
        base.mkdir(exist_ok=True)
        root = base / uuid.uuid4().hex
        root.mkdir()
        def cleanup():
            shutil.rmtree(root)
            try:
                base.rmdir()
            except OSError:
                pass

        self.addCleanup(cleanup)
        html = root / "html"
        html.mkdir()
        (html / "index.html").write_text(
            '<link rel="canonical" href="https://kepstroy.ru/">' + markup,
            encoding="utf-8",
        )
        (html / "sitemap.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>https://kepstroy.ru/</loc></url></urlset>',
            encoding="utf-8",
        )
        (html / "robots.txt").write_text(
            "User-agent: *\nAllow: /\nSitemap: https://kepstroy.ru/sitemap.xml\n",
            encoding="utf-8",
        )
        AUDIT.REPO_ROOT = root
        AUDIT.HTML_ROOT = html
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result = AUDIT.main()
        return result, stdout.getvalue(), stderr.getvalue()

    def test_same_site_normalizes_host_case_and_default_ports(self):
        for url in (
            "https://KEPSTROY.RU/missing",
            "https://kepstroy.ru:443/missing",
            "http://kepstroy.ru/missing",
            "http://KEPSTROY.RU:80/missing",
        ):
            with self.subTest(url=url):
                self.assertTrue(AUDIT.is_same_site(url))

        self.assertFalse(AUDIT.is_same_site("https://kepstroy.ru:444/missing"))
        self.assertFalse(AUDIT.is_same_site("https://example.test/missing"))

    def test_same_site_case_and_default_port_missing_links_fail_real_crawl(self):
        for url in (
            "https://KEPSTROY.RU/missing",
            "https://kepstroy.ru:443/missing",
        ):
            with self.subTest(url=url):
                result, _, stderr = self.run_fixture(f'<a href="{url}">missing</a>')
                self.assertEqual(1, result)
                self.assertIn("missing href target", stderr)

    def test_write_endpoints_are_skipped_only_for_form_actions(self):
        for path in ("/submit", "/webhook"):
            with self.subTest(path=path):
                self.assertTrue(AUDIT.should_skip_non_resource("form", "action", path))
                self.assertFalse(AUDIT.should_skip_non_resource("a", "href", path))
                self.assertFalse(AUDIT.should_skip_non_resource("img", "src", path))

    def test_write_endpoint_scope_is_enforced_by_real_crawl(self):
        form_result, _, form_stderr = self.run_fixture(
            '<form action="/submit"></form><form action="/webhook"></form>'
        )
        self.assertEqual(0, form_result, form_stderr)

        link_result, _, link_stderr = self.run_fixture('<a href="/submit">bad link</a>')
        self.assertEqual(1, link_result)
        self.assertIn("missing href target '/submit'", link_stderr)


if __name__ == "__main__":
    unittest.main()
