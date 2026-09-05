#!/usr/bin/env python3
"""Генератор городских посадочных страниц «Септик под ключ» для КэпСтроя."""

import argparse
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from string import Template


TEMPLATE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_ROOT = TEMPLATE_DIR.parent / "html"
DATA_PATH = TEMPLATE_DIR / "city-septik-data.json"
TEMPLATE_PATH = TEMPLATE_DIR / "city-septik-template.html"

PHONE = "+79784615962"
PHONE_FORMATTED = "+7 (978) 461-59-62"
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class GeneratorError(ValueError):
    """Понятная пользователю ошибка входных данных или безопасного пути."""


def validate_cities(cities):
    """Проверяет slug до построения любых выходных путей."""
    seen = set()
    for city in cities:
        slug = city.get("slug")
        if not isinstance(slug, str) or not SLUG_PATTERN.fullmatch(slug):
            raise GeneratorError(f"Invalid city slug: {slug!r}")
        if slug in seen:
            raise GeneratorError(f"Duplicate city slug: {slug}")
        seen.add(slug)


def format_phone(phone: str) -> str:
    """Форматирует +7XXXXXXXXXX в +7 (XXX) XXX-XX-XX."""
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 11 and digits.startswith("7"):
        return f"+7 ({digits[1:4]}) {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"
    return phone


def build_neighbor_links(cities, current_slug):
    """Генерирует HTML-ссылки на соседние города (все, кроме текущего)."""
    links = []
    for city in cities:
        if city["slug"] == current_slug:
            continue
        links.append(
            f'        <a href="/krym/{city["slug"]}/septik-pod-kluch/" class="geo-item" style="text-decoration: none;">{city["city"]}</a>'
        )
    return "\n".join(links)


def build_footer_links(cities, current_slug, limit=12):
    """Генерирует ссылки для футера."""
    links = []
    for city in cities:
        if city["slug"] == current_slug:
            continue
        links.append(
            f'          <a href="/krym/{city["slug"]}/septik-pod-kluch/">{city["city"]}</a>'
        )
    return "\n".join(links[:limit])


def load_inputs(data_path=DATA_PATH, template_path=TEMPLATE_PATH):
    """Загружает данные и шаблон независимо от текущего рабочего каталога."""
    data = json.loads(Path(data_path).read_text(encoding="utf-8"))
    validate_cities(data["cities"])
    template = Template(Path(template_path).read_text(encoding="utf-8"))
    return data["cities"], template


def render_pages(data_path=DATA_PATH, template_path=TEMPLATE_PATH):
    """Возвращает ожидаемые страницы как отображение относительный путь → HTML."""
    cities, template = load_inputs(data_path, template_path)
    rendered = {}
    for city in cities:
        slug = city["slug"]
        context = {
            "city": city["city"],
            "city_genitive": city["city_genitive"],
            "city_dative": city["city_dative"],
            "city_prepositional": city["city_prepositional"],
            "slug": slug,
            "region": city.get("region", "Крым"),
            "soil_type": city["soil_type"],
            "frost_depth": city["frost_depth"],
            "districts": city["districts"],
            "phone": PHONE,
            "phone_formatted": PHONE_FORMATTED,
            "neighbor_links": build_neighbor_links(cities, slug),
            "footer_links": build_footer_links(cities, slug),
        }
        try:
            html = template.substitute(context)
        except KeyError as error:
            raise GeneratorError(
                f"Unknown template placeholder: {error.args[0]}"
            ) from error
        rendered[Path("krym") / slug / "septik-pod-kluch" / "index.html"] = html
    return rendered


def resolve_output_path(output_root, relative_path):
    """Разрешает target и отклоняет traversal и выход через symlink."""
    output_root = Path(output_root).resolve()
    relative_path = Path(relative_path)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise GeneratorError(f"Target escapes output root: {relative_path}")
    target = (output_root / relative_path).resolve(strict=False)
    try:
        target.relative_to(output_root)
    except ValueError as error:
        raise GeneratorError(f"Target escapes output root: {relative_path}") from error
    return target


def compare_outputs(rendered, output_root):
    """Возвращает пути отсутствующих или отличающихся файлов без записи."""
    output_root = Path(output_root)
    changed = []
    for relative_path, html in rendered.items():
        path = resolve_output_path(output_root, relative_path)
        if not path.exists():
            changed.append(relative_path)
            continue
        try:
            current = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            changed.append(relative_path)
            continue
        if current != html:
            changed.append(relative_path)
    return changed


def unexpected_outputs(rendered, output_root):
    """Находит только лишние файлы, принадлежащие этому генератору."""
    output_root = Path(output_root).resolve()
    expected = set(rendered)
    existing = {
        path.relative_to(output_root)
        for path in output_root.glob("krym/*/septik-pod-kluch/index.html")
        if path.is_file()
    }
    return sorted(existing - expected, key=lambda path: path.as_posix())


def atomic_write(path, html):
    """Атомарно заменяет один файл; batch rollback для набора файлов не обещается."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    target_mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
    temp_path = None
    try:
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
        )
        temp_path = Path(temp_name)
        with os.fdopen(descriptor, "wb") as temp_file:
            temp_file.write(html.encode("utf-8"))
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.chmod(temp_path, target_mode)
        os.replace(temp_path, path)
    except Exception:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise


def existing_directory(value):
    path = Path(value).resolve()
    if not path.is_dir():
        raise argparse.ArgumentTypeError("output root must be an existing directory")
    return path


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
    rendered = render_pages()
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
        print(f"All {len(rendered)} city septic pages are up to date.")
        return 0

    if unexpected:
        print("Write refused; remove unexpected owned outputs manually:")
        for path in unexpected:
            print(f"Unexpected: {path.as_posix()}")
        return 1

    for relative_path in changed:
        target = resolve_output_path(args.output_root, relative_path)
        atomic_write(target, rendered[relative_path])
        print(f"Updated: {relative_path.as_posix()}")
    print(f"Write complete: {len(changed)} changed, {len(rendered)} expected.")
    return 0


def main(argv=None):
    args = parse_args(argv)
    try:
        return execute(args)
    except GeneratorError as error:
        print(f"Generator error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
