#!/usr/bin/env python3
"""Безопасный генератор общей и городских страниц солнечных панелей."""

import argparse
import json
import math
import os
import re
import stat
import sys
import tempfile
from html import escape
from pathlib import Path
from string import Template


GENERATOR_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_ROOT = GENERATOR_DIR.parent / "html"
CITY_REGISTRY_PATH = GENERATOR_DIR / "city-septik-data.json"
CITY_CONTENT_PATH = GENERATOR_DIR / "solar-city-content.json"
OFFER_PATH = GENERATOR_DIR / "solar-page-data.json"
MAIN_TEMPLATE_PATH = GENERATOR_DIR / "solar-main-template.html"
CITY_TEMPLATE_PATH = GENERATOR_DIR / "solar-city-template.html"
MAIN_OUTPUT = Path("uslugi/solnechnye-paneli/index.html")
SOLAR_CSS_VERSION = "7"
SOLAR_JS_VERSION = "8"
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REQUIRED_OFFER_KEYS = {
    "product_name",
    "panel_power_w",
    "panel_power_kw",
    "panel_price_rub",
    "availability",
    "system_types",
}
NEIGHBOR_SLUGS = {
    "simferopol": ("bahchisaraj", "saki", "alushta", "dzhankoj"),
    "sevastopol": ("bahchisaraj", "saki", "jalta", "simferopol"),
    "jalta": ("alushta", "sevastopol", "bahchisaraj", "simferopol"),
    "evpatorija": ("saki", "simferopol", "dzhankoj", "bahchisaraj"),
    "kerch": ("feodosija", "sudak", "dzhankoj", "simferopol"),
    "feodosija": ("sudak", "kerch", "alushta", "simferopol"),
    "alushta": ("jalta", "sudak", "simferopol", "feodosija"),
    "sudak": ("feodosija", "alushta", "kerch", "simferopol"),
    "dzhankoj": ("armjansk", "simferopol", "evpatorija", "kerch"),
    "saki": ("evpatorija", "sevastopol", "simferopol", "bahchisaraj"),
    "bahchisaraj": ("sevastopol", "simferopol", "saki", "jalta"),
    "armjansk": ("dzhankoj", "evpatorija", "saki", "simferopol"),
}


class GeneratorError(ValueError):
    """Ошибка входных данных, шаблона или безопасного выходного пути."""


def normalize_lf(value):
    """Возвращает текст с едиными LF независимо от checkout и платформы."""
    return str(value).replace("\r\n", "\n").replace("\r", "\n")


def _load_json(path, label):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GeneratorError(f"Cannot load {label}: {error}") from error


def _load_template(path, label):
    try:
        return Template(normalize_lf(Path(path).read_text(encoding="utf-8")))
    except (OSError, UnicodeDecodeError) as error:
        raise GeneratorError(f"Cannot load {label}: {error}") from error


def load_inputs(
    city_registry_path=CITY_REGISTRY_PATH,
    city_content_path=CITY_CONTENT_PATH,
    offer_path=OFFER_PATH,
    main_template_path=MAIN_TEMPLATE_PATH,
    city_template_path=CITY_TEMPLATE_PATH,
):
    """Загружает, валидирует и возвращает все входы генератора."""
    registry = _load_json(city_registry_path, "city registry")
    if not isinstance(registry, dict) or not isinstance(registry.get("cities"), list):
        raise GeneratorError("City registry must contain a cities list")
    cities = registry["cities"]
    city_content = _load_json(city_content_path, "solar city content")
    offer = _load_json(offer_path, "solar offer")
    validate_inputs(cities, city_content, offer)
    return (
        cities,
        city_content,
        offer,
        _load_template(main_template_path, "solar main template"),
        _load_template(city_template_path, "solar city template"),
    )


def validate_inputs(cities, city_content, offer):
    """Проверяет slug и согласованность входов до построения путей."""
    if not isinstance(cities, list) or len(cities) != 12:
        raise GeneratorError("City registry must contain exactly 12 cities")
    seen = set()
    for city in cities:
        if not isinstance(city, dict):
            raise GeneratorError("Each city must be an object")
        slug = city.get("slug")
        if not isinstance(slug, str) or not SLUG_PATTERN.fullmatch(slug):
            raise GeneratorError(f"Invalid city slug: {slug!r}")
        if slug in seen:
            raise GeneratorError(f"Duplicate city slug: {slug}")
        seen.add(slug)
        for field in ("city", "city_genitive", "city_prepositional"):
            if not isinstance(city.get(field), str) or not city[field].strip():
                raise GeneratorError(f"City {slug} has invalid {field}")

    if not isinstance(city_content, dict):
        raise GeneratorError("Solar city content must be an object keyed by slug")
    content_slugs = set(city_content)
    if content_slugs != seen:
        unknown = sorted(content_slugs - seen)
        missing = sorted(seen - content_slugs)
        raise GeneratorError(
            "Solar city content slugs must match city registry; "
            f"unknown={unknown}, missing={missing}"
        )
    for slug, content in city_content.items():
        if not isinstance(content, dict):
            raise GeneratorError(f"Solar city content for {slug} must be an object")
        if content.get("slug") != slug:
            raise GeneratorError(f"Solar city content {slug}.slug must match its key")
        for field in ("intro", "local_faq_question", "local_faq_answer"):
            if not isinstance(content.get(field), str) or not content[field].strip():
                raise GeneratorError(f"Solar city content {slug}.{field} must be text")
        for field, minimum in (("planning_paragraphs", 2), ("planning_points", 3)):
            values = content.get(field)
            if (
                not isinstance(values, list)
                or len(values) < minimum
                or not all(isinstance(value, str) and value.strip() for value in values)
            ):
                raise GeneratorError(
                    f"Solar city content {slug}.{field} must contain at least {minimum} texts"
                )

    validate_neighbor_map(cities, NEIGHBOR_SLUGS)

    if not isinstance(offer, dict) or set(offer) != REQUIRED_OFFER_KEYS:
        raise GeneratorError(
            "Solar offer must contain only the confirmed common offer fields"
        )
    if not isinstance(offer["product_name"], str) or not offer["product_name"].strip():
        raise GeneratorError("Solar offer product_name must be text")
    panel_power_w = offer["panel_power_w"]
    if (
        isinstance(panel_power_w, bool)
        or not isinstance(panel_power_w, int)
        or panel_power_w <= 0
    ):
        raise GeneratorError("Solar offer panel_power_w must be a positive integer")
    panel_power_kw = offer["panel_power_kw"]
    if (
        isinstance(panel_power_kw, bool)
        or not isinstance(panel_power_kw, (int, float))
        or not math.isfinite(panel_power_kw)
        or panel_power_kw <= 0
    ):
        raise GeneratorError("Solar offer panel_power_kw must be a positive finite number")
    if panel_power_kw != panel_power_w / 1000:
        raise GeneratorError("Solar offer panel_power_kw must match panel_power_w")
    panel_price_rub = offer["panel_price_rub"]
    if (
        isinstance(panel_price_rub, bool)
        or not isinstance(panel_price_rub, int)
        or panel_price_rub <= 0
    ):
        raise GeneratorError("Solar offer panel_price_rub must be a positive integer")
    if (
        not isinstance(offer["availability"], list)
        or len(offer["availability"]) != 2
        or not all(isinstance(value, str) and value for value in offer["availability"])
    ):
        raise GeneratorError("Solar offer availability must contain two labels")
    if (
        not isinstance(offer["system_types"], list)
        or len(offer["system_types"]) != 3
        or not all(isinstance(value, str) and value for value in offer["system_types"])
    ):
        raise GeneratorError("Solar offer system_types must contain three labels")


def validate_neighbor_map(cities, neighbor_map):
    """Проверяет ограниченный детерминированный граф перелинковки городов."""
    if not isinstance(cities, list):
        raise GeneratorError("City registry for neighbor map must be a list")
    city_slugs = set()
    for city in cities:
        if not isinstance(city, dict):
            raise GeneratorError("Each city for neighbor map must be an object")
        slug = city.get("slug")
        if not isinstance(slug, str) or not SLUG_PATTERN.fullmatch(slug):
            raise GeneratorError("Each city for neighbor map must have a valid slug")
        city_slugs.add(slug)
    if not isinstance(neighbor_map, dict):
        raise GeneratorError("Neighbor map must be an object")
    if set(neighbor_map) != city_slugs:
        raise GeneratorError("Neighbor map must exactly match city registry")
    for slug, neighbors in neighbor_map.items():
        if not isinstance(neighbors, (list, tuple)) or not neighbors:
            raise GeneratorError(f"Neighbor map {slug} must contain links")
        if len(neighbors) > 4:
            raise GeneratorError(f"Neighbor map {slug} must contain no more than four links")
        if not all(
            isinstance(neighbor, str) and SLUG_PATTERN.fullmatch(neighbor)
            for neighbor in neighbors
        ):
            raise GeneratorError(f"Neighbor map {slug} must contain valid slugs")
        if len(neighbors) != len(set(neighbors)):
            raise GeneratorError(f"Neighbor map {slug} must not contain duplicates")
        if slug in neighbors:
            raise GeneratorError(f"Neighbor map {slug} must not contain a self link")
        unknown = sorted(set(neighbors) - city_slugs)
        if unknown:
            raise GeneratorError(f"Neighbor map {slug} has unknown targets: {unknown}")


def _format_number(value):
    return f"{value:,}".replace(",", " ")


def _plural_system_types(system_types):
    plural = []
    for value in system_types:
        lowered = value.lower()
        plural.append(lowered[:-2] + "ые" if lowered.endswith("ая") else lowered)
    return ", ".join(plural[:-1]) + " и " + plural[-1]


def _json_script_string(value):
    """Возвращает JSON string fragment, безопасный внутри HTML script element."""
    if not isinstance(value, str):
        raise GeneratorError("JSON-LD dynamic value must be text")
    encoded = json.dumps(value, ensure_ascii=False)[1:-1]
    return (
        encoded.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _common_context(offer):
    availability_lower = " и ".join(value.lower() for value in offer["availability"])
    availability_sentence = availability_lower[:1].upper() + availability_lower[1:]
    product_brand = offer["product_name"].split(maxsplit=1)[0]
    system_types_plural = _plural_system_types(offer["system_types"])
    return {
        "solar_css_version": SOLAR_CSS_VERSION,
        "solar_js_version": SOLAR_JS_VERSION,
        "product_name": escape(offer["product_name"]),
        "product_name_schema": _json_script_string(offer["product_name"]),
        "product_brand": escape(product_brand),
        "product_brand_schema": _json_script_string(product_brand),
        "panel_power_w": str(offer["panel_power_w"]),
        "panel_price_rub": str(offer["panel_price_rub"]),
        "panel_price_formatted": _format_number(offer["panel_price_rub"]),
        "availability_lower": escape(availability_lower),
        "availability_lower_schema": _json_script_string(availability_lower),
        "availability_sentence": escape(availability_sentence),
        "system_type_1": escape(offer["system_types"][0]),
        "system_type_2": escape(offer["system_types"][1]),
        "system_type_3": escape(offer["system_types"][2]),
        "system_types_plural": escape(system_types_plural),
        "system_types_plural_schema": _json_script_string(system_types_plural),
    }


def _substitute(template, context):
    try:
        return normalize_lf(template.substitute(context))
    except KeyError as error:
        raise GeneratorError(
            f"Unknown template placeholder: {error.args[0]}"
        ) from error
    except ValueError as error:
        raise GeneratorError(f"Invalid template placeholder: {error}") from error


def _render_city_grid(cities):
    links = "".join(
        f'<a href="/krym/{escape(city["slug"])}/solnechnye-paneli/">'
        f'{escape(city["city"])}</a>'
        for city in cities
    )
    return (
        '\n    <section class="solar-section solar-city-directory" '
        'aria-labelledby="solar-city-directory-title">\n'
        '      <div class="container">\n'
        '        <div class="solar-heading">'
        '<h2 id="solar-city-directory-title">Солнечные панели и электростанции по городам Крыма</h2>'
        '<p>Выберите город, чтобы открыть локальную страницу услуги. Доставку и монтаж выполняем по всему Крыму.</p>'
        '</div>\n'
        f'        <nav class="solar-city-grid" aria-label="Солнечные панели по городам Крыма">{links}</nav>\n'
        '      </div>\n'
        '    </section>\n'
    )


def _render_neighbor_links(slug, cities_by_slug):
    return "".join(
        f'<a href="/krym/{escape(neighbor_slug)}/solnechnye-paneli/">'
        f'{escape(cities_by_slug[neighbor_slug]["city"])}</a>'
        for neighbor_slug in NEIGHBOR_SLUGS[slug]
    )


def render_pages(
    cities=None,
    city_content=None,
    offer=None,
    main_template=None,
    city_template=None,
):
    """Возвращает все 13 принадлежащих генератору страниц в памяти."""
    inputs = (cities, city_content, offer, main_template, city_template)
    if all(value is None for value in inputs):
        cities, city_content, offer, main_template, city_template = load_inputs()
    elif any(value is None for value in inputs):
        raise GeneratorError("render_pages requires either all inputs or none")
    validate_inputs(cities, city_content, offer)
    common = _common_context(offer)
    cities_by_slug = {city["slug"]: city for city in cities}
    rendered = {
        MAIN_OUTPUT: _substitute(
            main_template, {**common, "city_grid": _render_city_grid(cities)}
        )
    }
    for city in cities:
        slug = city["slug"]
        content = city_content[slug]
        city_name = city["city"]
        context = {
            **common,
            "slug": slug,
            "city": escape(city_name),
            "city_genitive": escape(city["city_genitive"]),
            "city_prepositional": escape(city["city_prepositional"]),
            "city_schema": _json_script_string(city_name),
            "city_prepositional_schema": _json_script_string(
                city["city_prepositional"]
            ),
            "intro": escape(content["intro"]),
            "planning_paragraphs_html": "".join(
                f"<p>{escape(paragraph)}</p>"
                for paragraph in content["planning_paragraphs"]
            ),
            "planning_points_html": "".join(
                f"<li>{escape(point)}</li>"
                for point in content["planning_points"]
            ),
            "local_faq_question": escape(content["local_faq_question"]),
            "local_faq_answer": escape(content["local_faq_answer"]),
            "local_faq_question_schema": _json_script_string(
                content["local_faq_question"]
            ),
            "local_faq_answer_schema": _json_script_string(
                content["local_faq_answer"]
            ),
            "neighbor_links": _render_neighbor_links(slug, cities_by_slug),
        }
        relative_path = Path("krym") / slug / "solnechnye-paneli" / "index.html"
        rendered[relative_path] = _substitute(city_template, context)
    if len(rendered) != 13:
        raise GeneratorError("Solar generator must render exactly 13 pages")
    return rendered


def _is_symlink_or_junction(path):
    path = Path(path)
    return path.is_symlink() or (
        hasattr(path, "is_junction") and path.is_junction()
    )


def _lexical_absolute(path):
    path = Path(path)
    if ".." in path.parts:
        raise GeneratorError(f"Target escapes output root: {path}")
    return path if path.is_absolute() else Path.cwd() / path


def _reject_symlink_components(path):
    """Не разрешает ссылку ни в target, ни в существующих родителях."""
    absolute = _lexical_absolute(path)
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if _is_symlink_or_junction(current):
            raise GeneratorError(f"Output path contains a symlink: {current}")
    return absolute


def _safe_output_root(output_root):
    raw = _reject_symlink_components(output_root)
    if not raw.is_dir():
        raise GeneratorError("Output root must be an existing directory")
    return raw.resolve()


def _resolve_output_path(output_root, relative_path):
    root = _safe_output_root(output_root)
    relative_path = Path(relative_path)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise GeneratorError(f"Target escapes output root: {relative_path}")
    target = _reject_symlink_components(root / relative_path)
    resolved_target = target.resolve(strict=False)
    try:
        resolved_target.relative_to(root)
    except ValueError as error:
        raise GeneratorError(f"Target escapes output root: {relative_path}") from error
    return target


def compare_outputs(rendered, output_root):
    """Возвращает missing/drift paths; CRLF и LF считаются одинаковыми."""
    changed = []
    for relative_path, expected in rendered.items():
        target = _resolve_output_path(output_root, relative_path)
        if not target.is_file():
            changed.append(relative_path)
            continue
        try:
            current = normalize_lf(target.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            changed.append(relative_path)
            continue
        if current != normalize_lf(expected):
            changed.append(relative_path)
    return changed


def unexpected_outputs(rendered, output_root):
    """Возвращает только лишние HTML, принадлежащие solar-генератору."""
    root = _safe_output_root(output_root)
    expected = set(rendered)
    existing = set()
    patterns = (
        "uslugi/solnechnye-paneli/index.html",
        "krym/*/solnechnye-paneli/index.html",
    )
    for pattern in patterns:
        for candidate in root.glob(pattern):
            if candidate.is_file():
                relative_path = candidate.relative_to(root)
                _resolve_output_path(root, relative_path)
                existing.add(relative_path)
    return sorted(existing - expected, key=lambda path: path.as_posix())


def atomic_write(path, html):
    """Атомарно пишет LF UTF-8, сохраняя mode существующего файла."""
    path = _reject_symlink_components(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _reject_symlink_components(path)
    target_mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
    temp_path = None
    try:
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
        )
        temp_path = Path(temp_name)
        with os.fdopen(descriptor, "wb") as temp_file:
            temp_file.write(normalize_lf(html).encode("utf-8"))
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.chmod(temp_path, target_mode)
        os.replace(temp_path, path)
    except Exception:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise


def existing_directory(value):
    try:
        return _safe_output_root(value)
    except GeneratorError as error:
        raise argparse.ArgumentTypeError(str(error).lower()) from error


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_const", const="check", dest="mode")
    mode.add_argument("--write", action="store_const", const="write", dest="mode")
    parser.set_defaults(mode="check")
    parser.add_argument(
        "--output-root",
        type=existing_directory,
        default=DEFAULT_OUTPUT_ROOT.resolve(),
        help=argparse.SUPPRESS,
    )
    return parser.parse_args(argv)


def execute(args):
    rendered = render_pages(*load_inputs())
    changed = compare_outputs(rendered, args.output_root)
    unexpected = unexpected_outputs(rendered, args.output_root)
    if args.mode == "check":
        if changed or unexpected:
            print(
                "Generator drift detected: "
                f"{len(changed)} changed or missing, {len(unexpected)} unexpected."
            )
            for path in changed:
                print(path.as_posix())
            for path in unexpected:
                print(f"Unexpected: {path.as_posix()}")
            return 1
        print(f"All {len(rendered)} solar pages are up to date.")
        return 0

    if unexpected:
        print("Write refused; remove unexpected owned outputs manually:")
        for path in unexpected:
            print(f"Unexpected: {path.as_posix()}")
        return 1
    for relative_path in changed:
        target = _resolve_output_path(args.output_root, relative_path)
        atomic_write(target, rendered[relative_path])
        print(f"Updated: {relative_path.as_posix()}")
    print(f"Write complete: {len(changed)} changed, {len(rendered)} expected.")
    return 0


def main(argv=None):
    try:
        return execute(parse_args(argv))
    except GeneratorError as error:
        print(f"Generator error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
