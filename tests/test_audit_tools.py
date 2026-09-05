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

    def run_fixture(self, markup, repo_files=None):
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
        for relative, content in (repo_files or {}).items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
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
            "https://WWW.KEPSTROY.RU/missing",
            "https://www.kepstroy.ru:443/missing",
            "http://kepstroy.ru/missing",
            "http://KEPSTROY.RU:80/missing",
            "http://www.kepstroy.ru:80/missing",
        ):
            with self.subTest(url=url):
                self.assertTrue(AUDIT.is_same_site(url))

        self.assertFalse(AUDIT.is_same_site("https://kepstroy.ru:444/missing"))
        self.assertFalse(AUDIT.is_same_site("https://example.test/missing"))

    def test_same_site_case_and_default_port_missing_links_fail_real_crawl(self):
        for url in (
            "https://KEPSTROY.RU/missing",
            "https://kepstroy.ru:443/missing",
            "https://WWW.KEPSTROY.RU/missing",
            "https://www.kepstroy.ru:443/missing",
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

    def test_social_and_json_ld_local_urls_are_crawled_without_external_false_positives(self):
        external_markup = (
            '<meta property="og:image" content="https://cdn.example.test/og.jpg">'
            '<meta name="twitter:image" content="data:image/png;base64,AAAA">'
            '<script type="application/ld+json">'
            '{"@context":"images/not-a-reference.json","name":"https://kepstroy.ru/missing-name",'
            '"description":"images/missing-description.jpg",'
            '"@id":"urn:uuid:1234","logo":"ftp://files.example.test/logo.svg",'
            '"image":"https://cdn.example.test/schema.jpg",'
            '"sameAs":["https://social.example.test/company","//cdn.example.test/profile",'
            '"data:text/plain,ignored"]}'
            '</script>'
            '<script type="application/ld+json">'
            '{"@context":{"term":{"@id":"images/context-object-only.json"}},"name":"ok"}'
            '</script>'
            '<script type="application/ld+json">'
            '{"@context":["https://schema.org",'
            '{"term":{"@id":"images/context-list-only.json"}}],"name":"ok"}'
            '</script>'
        )
        external_result, _, external_stderr = self.run_fixture(external_markup)
        self.assertEqual(0, external_result, external_stderr)

        for markup, expected in (
            (
                '<meta property="og:image" content="https://WWW.KEPSTROY.RU/missing-og.jpg">',
                "missing meta content target",
            ),
            (
                '<meta name="twitter:image" content="/missing-twitter.jpg">',
                "missing meta content target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","image":"https://kepstroy.ru/missing-schema.jpg"}'
                '</script>',
                "missing script json-ld target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","image":"images/missing-direct.jpg"}'
                '</script>',
                "missing script json-ld target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","image":{"url":"images/missing-relative.jpg"}}'
                '</script>',
                "missing script json-ld target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","sameAs":["images/missing-list.jpg"]}'
                '</script>',
                "missing script json-ld target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","item":"images/missing-item.jpg"}'
                '</script>',
                "missing script json-ld target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","target":"images/missing-target.jpg"}'
                '</script>',
                "missing script json-ld target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org",'
                '"mainEntityOfPage":"images/missing-main-entity.html"}'
                '</script>',
                "missing script json-ld target",
            ),
            (
                '<script type="application/ld+json">'
                '{"@context":"https://schema.org","target":{"@type":"EntryPoint",'
                '"urlTemplate":"search/missing?q={search_term_string}"}}'
                '</script>',
                "missing script json-ld target",
            ),
        ):
            with self.subTest(expected=expected):
                result, _, stderr = self.run_fixture(markup)
                self.assertEqual(1, result)
                self.assertIn(expected, stderr)

    def test_only_portfolio_uses_the_repository_images_fallback(self):
        non_portfolio_result, _, non_portfolio_stderr = self.run_fixture(
            '<img src="/images/photo.webp">',
            {"images/photo.webp": b"not published by Dockerfile"},
        )
        self.assertEqual(1, non_portfolio_result)
        self.assertIn("missing src target", non_portfolio_stderr)

        traversal_result, _, traversal_stderr = self.run_fixture(
            '<img src="/images/portfolio/%2e%2e/photo.webp">',
            {"images/photo.webp": b"outside Docker portfolio COPY"},
        )
        self.assertEqual(1, traversal_result)
        self.assertIn("escapes site roots", traversal_stderr)

        portfolio_result, _, portfolio_stderr = self.run_fixture(
            '<img src="/images/portfolio/photo.webp">',
            {"images/portfolio/photo.webp": b"published portfolio"},
        )
        self.assertEqual(0, portfolio_result, portfolio_stderr)


class AuditReportReproductionTests(unittest.TestCase):
    def test_native_reproduction_commands_use_the_fail_fast_wrapper(self):
        report = (ROOT / "docs" / "reports" / "kepstroy.ru" / "site-audit-fixes-2026-09-04.md").read_text(encoding="utf-8")
        powershell = report.split("```powershell", 1)[1].split("```", 1)[0]
        self.assertIn("function Invoke-Checked", powershell)
        self.assertNotIn("--test-isolation", powershell)
        for command in (
            "python -m unittest discover",
            "npm ci",
            "npm audit --omit=dev",
            "node --test tests/test_audit_browser_safety.cjs",
            "python scripts/validate.py",
            "python scripts/audit-static-site.py",
            "node scripts/audit-full-site-browser.cjs",
            "git diff --check main...HEAD",
            "git status --short",
        ):
            with self.subTest(command=command):
                matching_lines = [line.strip() for line in powershell.splitlines() if command in line]
                self.assertTrue(matching_lines, command)
                self.assertTrue(all(line.startswith("Invoke-Checked") for line in matching_lines), matching_lines)


if __name__ == "__main__":
    unittest.main()
