"""Business-critical pre-deploy checks for traffic attribution and lead capture."""
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


UTILITY_URLS = {
    "https://kepstroy.ru/call/",
    "https://kepstroy.ru/lead-magnet/",
    "https://kepstroy.ru/spasibo/",
}

SOLAR_CITY_SLUGS = {
    "alushta",
    "armjansk",
    "bahchisaraj",
    "dzhankoj",
    "evpatorija",
    "feodosija",
    "jalta",
    "kerch",
    "saki",
    "sevastopol",
    "simferopol",
    "sudak",
}

SOLAR_QUANTITY = (
    r"(?:\d+(?:[,.]\d+)?|один|одна|одно|одну|два|две|три|четыре|пять|"
    r"шесть|семь|восемь|девять|десять)"
)
SOLAR_DURATION = (
    r"(?:час(?:а|ов)?|д(?:ень|ня|ней)|сут(?:ки|ок)|недел(?:я|и|ь)|"
    r"месяц(?:а|ев)?|год(?:а|ов)?|лет)"
)
SOLAR_ENERGY_UNIT = (
    r"(?:[км]Вт[·⋅•*./\s-]*ч|(?:кило|мега)ватт(?:а|ов)?[-\s]*час(?:а|ов)?)"
)
SOLAR_MONTH = (
    r"(?:январ[ья]|феврал[ья]|марта|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|"
    r"августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])"
)

SOLAR_FORBIDDEN_CLAIMS = (
    r"КПД.{0,30}24[,.]6",
    r"окупаем",
    r"15-летн.{0,30}гарант",
    r"30-летн.{0,30}гарант",
    r"(?:гарант[^.!?]{0,30}|на\s+)(?:15|30)\s+лет",
    rf"гарант\w*[^.!?]{{0,60}}{SOLAR_QUANTITY}\s+{SOLAR_DURATION}",
    rf"\d[\d\s]*(?:[,.]\d+)?\s*{SOLAR_ENERGY_UNIT}",
    rf"(?:поставк\w*|доставк\w*)[^.!?]{{0,50}}\b(?:[0-3]?\d)\s+{SOLAR_MONTH}\b",
    r"(?:поставк\w*|доставк\w*)[^.!?]{0,50}\b"
    r"(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])"
    r"(?:[./-](?:\d{2}|\d{4}))?\b",
    rf"(?:монтаж\w*|установ\w*|достав\w*|поставк\w*)[^.!?]{{0,60}}"
    rf"(?:за|в\s+течение|срок\w*)?\s*{SOLAR_QUANTITY}\s+{SOLAR_DURATION}",
    r"бесплатн[^.!?]{0,40}(?:достав|монтаж|установ)|(?:достав|монтаж|установ)[^.!?]{0,40}бесплатн",
    r"полн(?:ая|ое|ый|ую|остью)\s+(?:энерго)?независим\w*",
)


def _visible_text(source: str) -> str:
    source = re.sub(
        r"<script\b.*?</script>|<style\b.*?</style>",
        " ",
        source,
        flags=re.IGNORECASE | re.DOTALL,
    )
    source = re.sub(r"<[^>]+>", " ", source)
    return " ".join(source.split())


def _check_solar_offer(path: Path, relative: str, errors: list[str]):
    source = path.read_text(encoding="utf-8")
    visible = _visible_text(source)
    for claim in SOLAR_FORBIDDEN_CLAIMS:
        if re.search(claim, visible, re.IGNORECASE):
            errors.append(f"{relative}: unconfirmed solar claim")
            break

    panel_price_pattern = re.compile(
        r"(?:цена|стоимость)\s+(?:одной\s+)?панел[^.]{0,45}20\s*000\s*₽|"
        r"20\s*000\s*₽[^.]{0,45}(?:цена|стоимость)\s+(?:одной\s+)?панел",
        re.IGNORECASE,
    )
    separate_cost_pattern = re.compile(
        r"(?:монтаж|инвертор|аккумулятор|комплектующ)[^.]{0,120}"
        r"(?:рассчитыва|оплачива|стоимост)[^.]{0,80}(?:отдельно|индивидуально)",
        re.IGNORECASE,
    )
    if not panel_price_pattern.search(visible):
        errors.append(f"{relative}: panel price must be labeled as panel-only")
    if not separate_cost_pattern.search(visible):
        errors.append(
            f"{relative}: installation and components must be priced separately"
        )


def _check_solar_city_pages(repo_root: Path, errors: list[str]):
    html_root = repo_root / "html"
    city_data_path = repo_root / "generators" / "city-septik-data.json"
    if not city_data_path.exists():
        errors.append("solar-city: city registry is missing")
        return

    try:
        cities = json.loads(city_data_path.read_text(encoding="utf-8"))["cities"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        errors.append(f"solar-city: invalid city registry: {exc}")
        return

    registry = {city.get("slug") for city in cities if isinstance(city, dict)}
    if registry != SOLAR_CITY_SLUGS:
        errors.append(
            "solar-city: city registry must exactly match the approved 12 slugs; "
            f"missing={sorted(SOLAR_CITY_SLUGS - registry)}, "
            f"extra={sorted(registry - SOLAR_CITY_SLUGS)}"
        )

    outputs = {
        path.parent.parent.name
        for path in (html_root / "krym").glob("*/solnechnye-paneli/index.html")
    }
    if outputs != SOLAR_CITY_SLUGS:
        errors.append(
            "solar-city: generated output set must exactly match the approved 12 slugs; "
            f"missing={sorted(SOLAR_CITY_SLUGS - outputs)}, "
            f"extra={sorted(outputs - SOLAR_CITY_SLUGS)}"
        )

    city_by_slug = {
        city["slug"]: city
        for city in cities
        if isinstance(city, dict) and city.get("slug") in SOLAR_CITY_SLUGS
    }
    for slug in sorted(SOLAR_CITY_SLUGS):
        relative = f"krym/{slug}/solnechnye-paneli/index.html"
        path = html_root / relative
        if not path.exists():
            errors.append(f"{relative}: missing solar city page")
            continue

        source = path.read_text(encoding="utf-8")
        canonical = f"https://kepstroy.ru/krym/{slug}/solnechnye-paneli/"
        canonicals = re.findall(
            r'<link\s+rel="canonical"\s+href="([^"]+)"', source, re.IGNORECASE
        )
        if canonicals != [canonical]:
            errors.append(f"{relative}: solar city canonical must be {canonical}")

        _check_solar_offer(path, relative, errors)

        city = city_by_slug.get(slug)
        city_name = city.get("city") if city else None
        submit_forms = re.findall(
            r'<form\b[^>]*action="/submit"[^>]*>.*?</form>',
            source,
            re.IGNORECASE | re.DOTALL,
        )
        city_pattern = re.compile(
            rf'name="(?:city|locality)"[^>]+value="{re.escape(city_name or "")}"'
        )
        if not submit_forms or not any(city_pattern.search(form) for form in submit_forms):
            errors.append(f"{relative}: lead form must preserve city {city_name!r}")

    generator = repo_root / "generators" / "generate-solar-pages.py"
    if not generator.exists():
        errors.append("solar-city: generator drift check is missing")
        return

    result = subprocess.run(
        [sys.executable, str(generator), "--check"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        suffix = f": {detail[0]}" if detail else ""
        errors.append(f"solar-city: generated pages have manual drift{suffix}")


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

    solar_page = html_root / "uslugi" / "solnechnye-paneli" / "index.html"
    if solar_page.exists():
        _check_solar_offer(
            solar_page, "uslugi/solnechnye-paneli/index.html", errors
        )

    _check_solar_city_pages(repo_root, errors)
