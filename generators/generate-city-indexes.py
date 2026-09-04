#!/usr/bin/env python3
"""Генератор обзорных городских страниц /krym/{slug}/ для КэпСтроя."""

import json
from string import Template
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent / "html"
TEMPLATE_DIR = Path(__file__).resolve().parent
OUT_DIR = BASE_DIR

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


def main():
    data_path = TEMPLATE_DIR / "city-septik-data.json"
    template_path = TEMPLATE_DIR / "city-index-template.html"

    with data_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    cities = data["cities"]
    template = Template(template_path.read_text(encoding="utf-8"))

    generated = []
    for city in cities:
        slug = city["slug"]
        city_dir = OUT_DIR / "krym" / slug
        city_dir.mkdir(parents=True, exist_ok=True)

        context = {
            "city": city["city"],
            "city_genitive": city["city_genitive"],
            "city_dative": city["city_dative"],
            "city_prepositional": city["city_prepositional"],
            "slug": slug,
            "phone": PHONE,
            "phone_formatted": PHONE_FORMATTED,
            "neighbor_links": build_neighbor_links(cities, slug),
        }

        html = template.safe_substitute(context)
        out_path = city_dir / "index.html"
        out_path.write_text(html, encoding="utf-8")
        url = f"https://kepstroy.ru/krym/{slug}/"
        generated.append(url)
        print(f"Generated: {out_path}")

    print(f"\nTotal generated: {len(generated)} city index pages")


if __name__ == "__main__":
    main()
