#!/usr/bin/env python3
"""Генератор обзорных городских страниц /krym/{slug}/ для КэпСтроя."""

import argparse
import json
import os
import tempfile
from pathlib import Path
from string import Template


TEMPLATE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_ROOT = TEMPLATE_DIR.parent / "html"
DATA_PATH = TEMPLATE_DIR / "city-septik-data.json"
TEMPLATE_PATH = TEMPLATE_DIR / "city-index-template.html"

PHONE = "+79784615962"
PHONE_FORMATTED = "+7 (978) 461-59-62"


def build_neighbor_links(cities, current_slug, limit=8):
    """Генерирует HTML-ссылки на соседние города."""
    links = []
    for city in cities:
        if city["slug"] == current_slug:
            continue
        links.append(
            f'        <a href="/krym/{city["slug"]}/" class="geo-item" style="text-decoration: none;">{city["city"]}</a>'
        )
    return "\n".join(links[:limit])


def load_inputs(data_path=DATA_PATH, template_path=TEMPLATE_PATH):
    """Загружает данные и шаблон независимо от текущего рабочего каталога."""
    data = json.loads(Path(data_path).read_text(encoding="utf-8"))
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
            "phone": PHONE,
            "phone_formatted": PHONE_FORMATTED,
            "neighbor_links": build_neighbor_links(cities, slug),
            "schema_spacing": "  ",
        }
        html = template.safe_substitute(context).replace("\n", os.linesep)
        rendered[Path("krym") / slug / "index.html"] = html
    return rendered


def compare_outputs(rendered, output_root):
    """Возвращает пути отсутствующих или отличающихся файлов без записи."""
    output_root = Path(output_root)
    changed = []
    for relative_path, html in rendered.items():
        path = output_root / relative_path
        if not path.exists() or path.read_bytes() != html.encode("utf-8"):
            changed.append(relative_path)
    return changed


def atomic_write(path, html):
    """Атомарно заменяет один HTML-файл, не оставляя временный файл при ошибке."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
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


def main(argv=None):
    args = parse_args(argv)
    rendered = render_pages()
    changed = compare_outputs(rendered, args.output_root)

    if args.mode == "check":
        if changed:
            print(f"Generator drift detected in {len(changed)} path(s):")
            for path in changed:
                print(path.as_posix())
            return 1
        print(f"All {len(rendered)} city index pages are up to date.")
        return 0

    for relative_path in changed:
        atomic_write(args.output_root / relative_path, rendered[relative_path])
        print(f"Updated: {relative_path.as_posix()}")
    print(f"Write complete: {len(changed)} changed, {len(rendered)} expected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
