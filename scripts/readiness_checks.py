"""Business-critical pre-deploy checks for traffic attribution and lead capture."""
import re
import xml.etree.ElementTree as ET
from pathlib import Path


UTILITY_URLS = {
    "https://kepstroy.ru/call/",
    "https://kepstroy.ru/lead-magnet/",
    "https://kepstroy.ru/spasibo/",
}


def _production_pages(html_root: Path):
    for path in html_root.rglob("*.html"):
        relative = path.relative_to(html_root).as_posix()
        if relative in {"404.html", "yandex_42d19edda2426210.html"}:
            continue
        yield path, relative, path.read_text(encoding="utf-8")


def check_traffic_readiness(repo_root: Path, errors: list[str]):
    html_root = repo_root / "html"
    sitemap = html_root / "sitemap.xml"

    if (html_root / "lead-magnet" / "index.html").exists():
        errors.append("lead-magnet: nonexistent PDF offer is still published")

    root = ET.parse(sitemap).getroot()
    urls = {node.text for node in root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")}
    for url in sorted(UTILITY_URLS.intersection(urls)):
        errors.append(f"sitemap.xml: utility URL must not be indexed: {url}")

    visit_pattern = re.compile(
        r"бесплатн(?:ый|ого|ом|о)?\s+выезд|"
        r"выезд\s+(?:инженера|специалиста)[^<\n]{0,80}(?:бесплат|(?<!\d)0\s*₽)|"
        r"выедем[^<\n]{0,60}бесплат",
        re.IGNORECASE,
    )
    warranty_pattern = re.compile(
        r"гаранти[^<\n]{0,50}2\s+год|2\s+года[^<\n]{0,50}гаранти",
        re.IGNORECASE,
    )

    for path, relative, text in _production_pages(html_root):
        is_noindex = re.search(
            r'<meta\s+name="robots"\s+content="[^"]*noindex',
            text,
            re.IGNORECASE,
        )
        if not is_noindex and "/js/tracking.js" not in text:
            errors.append(f"{relative}: missing attribution tracking script")

        for index, form in enumerate(re.findall(r"<form\b.*?</form>", text, re.DOTALL | re.IGNORECASE), 1):
            if 'action="/submit"' not in form:
                continue
            for token in (
                'name="form_source"',
                'value="kepstroy"',
                'name="website"',
                'name="company"',
                'name="consent"',
            ):
                if token not in form:
                    errors.append(f"{relative}: form #{index} missing {token}")

        if visit_pattern.search(text):
            errors.append(f"{relative}: engineer visit terms contradict 3,000–6,000 ₽ refund policy")
        if warranty_pattern.search(text):
            errors.append(f"{relative}: installation warranty contradicts confirmed one-year term")

    source_paths = (
        repo_root / "generators" / "city-septik-template.html",
        repo_root / "generators" / "city-index-template.html",
        repo_root / "generators" / "city-septik-data.json",
    )
    forbidden_tokens = (
        "Топас",
        "Тверь",
        "Выезд инженера — 0 ₽",
        "септика в ${city_dative} начинается от 60 000 ₽",
        '<div class="service-tile__price">от 60 000 ₽</div>',
    )
    for path in source_paths:
        text = path.read_text(encoding="utf-8")
        for token in forbidden_tokens:
            if token in text:
                errors.append(f"{path.relative_to(repo_root).as_posix()}: stale generator token {token!r}")