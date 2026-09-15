import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = REPO_ROOT / "html"

EXPECTED_SERVICE_LINKS = {
    "/uslugi/septiki/",
    "/uslugi/kanalizaciya/",
    "/uslugi/zabory/",
    "/uslugi/vodosnabzhenie/",
    "/uslugi/gazosnabzhenie/",
    "/uslugi/elektrosnabzhenie/",
    "/uslugi/generatory/",
    "/uslugi/solnechnye-paneli/",
    "/uslugi/yuridicheskoe-soprovozhdenie-podklyuchenij/",
}

PRIMARY_PHONE = "+79784615962"
SECONDARY_PHONE = "+79788213968"


def is_verification_page(source):
    body = re.search(r"<body[^>]*>(?P<body>.*?)</body>", source, re.DOTALL | re.IGNORECASE)
    if not body:
        return False
    body_text = re.sub(r"<[^>]+>", "", body.group("body")).strip()
    return bool(re.fullmatch(r"Verification:\s*[a-f0-9]+", body_text, re.IGNORECASE))


def footer_sources():
    sources = []
    for path in sorted(HTML_ROOT.rglob("*.html")):
        source = path.read_text(encoding="utf-8")
        if not is_verification_page(source) and re.search(r"<footer\b", source, re.IGNORECASE):
            sources.append((path, source))
    for path in sorted((REPO_ROOT / "generators").glob("*-template.html")):
        sources.append((path, path.read_text(encoding="utf-8")))
    return sources


def service_footer_links(source):
    footer_match = re.search(r"<footer\b.*?</footer>", source, re.DOTALL | re.IGNORECASE)
    if not footer_match:
        return None

    footer = footer_match.group(0)
    labelled_nav = re.search(
        r'<nav\b[^>]*aria-label=["\']Услуги["\'][^>]*>(?P<content>.*?)</nav>',
        footer,
        re.DOTALL | re.IGNORECASE,
    )
    if labelled_nav:
        return re.findall(
            r'<a\b[^>]*href=["\']([^"\']+)["\']',
            labelled_nav.group("content"),
            re.IGNORECASE,
        )

    heading = re.search(r"<h4\b[^>]*>\s*Услуги\s*</h4>", footer, re.IGNORECASE)
    if not heading:
        return None
    next_heading = re.search(r"<h4\b", footer[heading.end():], re.IGNORECASE)
    block_end = heading.end() + next_heading.start() if next_heading else len(footer)
    block = footer[heading.end():block_end]
    return re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\']', block, re.IGNORECASE)


class FooterServicesTests(unittest.TestCase):
    def test_every_public_footer_lists_all_live_services_once(self):
        sources = footer_sources()
        self.assertGreaterEqual(len(sources), 54)

        for path, source in sources:
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                links = service_footer_links(source)
                self.assertIsNotNone(links, "footer must contain an Услуги section")
                self.assertEqual(len(links), len(set(links)), "service links must not repeat")
                self.assertSetEqual(EXPECTED_SERVICE_LINKS, set(links))
                self.assertNotIn("septiki_dead", source)

    def test_every_footer_service_target_exists(self):
        for href in EXPECTED_SERVICE_LINKS:
            with self.subTest(href=href):
                target = HTML_ROOT / href.removeprefix("/") / "index.html"
                self.assertTrue(target.is_file(), f"missing footer target: {target}")

    def test_every_public_footer_lists_both_clickable_phone_numbers_once(self):
        sources = footer_sources()
        self.assertGreaterEqual(len(sources), 69)

        for path, source in sources:
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                footer = re.search(
                    r"<footer\b.*?</footer>", source, re.DOTALL | re.IGNORECASE
                )
                self.assertIsNotNone(footer)
                footer_html = footer.group(0)
                primary_hrefs = footer_html.count(f'href="tel:{PRIMARY_PHONE}"')
                secondary_hrefs = footer_html.count(f'href="tel:{SECONDARY_PHONE}"')
                if path.parent == REPO_ROOT / "generators":
                    primary_hrefs += footer_html.count('href="tel:${phone}"')
                    secondary_hrefs += footer_html.count(
                        'href="tel:${secondary_phone}"'
                    )
                self.assertEqual(
                    1,
                    primary_hrefs,
                    "primary phone must appear once in the footer",
                )
                self.assertEqual(
                    1,
                    secondary_hrefs,
                    "secondary phone must appear once in the footer",
                )

    def test_secondary_phone_is_not_added_to_headers_or_mobile_menus(self):
        for path in sorted(HTML_ROOT.rglob("*.html")):
            source = path.read_text(encoding="utf-8")
            restricted_blocks = [
                *re.findall(r"<header\b.*?</header>", source, re.DOTALL | re.IGNORECASE),
                *re.findall(
                    r'<nav\b[^>]*class=["\'][^"\']*mobile-menu[^"\']*["\'][^>]*>.*?</nav>',
                    source,
                    re.DOTALL | re.IGNORECASE,
                ),
            ]
            with self.subTest(path=path.relative_to(REPO_ROOT).as_posix()):
                self.assertTrue(
                    all(f"tel:{SECONDARY_PHONE}" not in block for block in restricted_blocks)
                )

    def test_contacts_page_lists_secondary_phone_in_main_content(self):
        source = (HTML_ROOT / "kontakty" / "index.html").read_text(encoding="utf-8")
        page_content = source.split("<footer", maxsplit=1)[0]
        self.assertIn(f'href="tel:{SECONDARY_PHONE}"', page_content)
        self.assertIn("+7 (978) 821-39-68", page_content)

    def test_generator_flex_footer_keeps_phone_numbers_in_one_column(self):
        page = (HTML_ROOT / "uslugi" / "generatory" / "index.html").read_text(
            encoding="utf-8"
        )
        phone_group = re.search(
            r'<div class="power-footer__phones">(?P<content>.*?)</div>',
            page,
            re.DOTALL,
        )
        self.assertIsNotNone(phone_group)
        self.assertIn(f'tel:{PRIMARY_PHONE}', phone_group.group("content"))
        self.assertIn(f'tel:{SECONDARY_PHONE}', phone_group.group("content"))
        self.assertIn('href="/css/generatory.css?v=2"', page)

        stylesheet = (HTML_ROOT / "css" / "generatory.css").read_text(
            encoding="utf-8"
        )
        self.assertIn(".power-footer__phones", stylesheet)


if __name__ == "__main__":
    unittest.main()
