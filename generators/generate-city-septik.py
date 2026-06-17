#!/usr/bin/env python3
"""Генератор городских посадочных страниц «Септик под ключ» для КэпСтроя."""

import json
import os
from string import Template
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent / "html"
TEMPLATE_DIR = Path(__file__).resolve().parent
OUT_DIR = BASE_DIR

PHONE = "+79784615962"
PHONE_FORMATTED = "+7 (978) 461-59-62"


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


def main():
    data_path = TEMPLATE_DIR / "city-septik-data.json"
    template_path = TEMPLATE_DIR / "city-septik-template.html"

    with data_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    cities = data["cities"]
    template = Template(template_path.read_text(encoding="utf-8"))

    generated = []
    for city in cities:
        slug = city["slug"]
        city_dir = OUT_DIR / "krym" / slug / "septik-pod-kluch"
        city_dir.mkdir(parents=True, exist_ok=True)

        reviews = city.get("reviews", [])
        review_map = {}
        for i, review in enumerate(reviews[:3], start=1):
            review_map[f"review{i}_text"] = review.get("text", "")
            review_map[f"review{i}_name"] = review.get("name", "")
            review_map[f"review{i}_location"] = review.get("location", "")

        context = {
            "city": city["city"],
            "city_genitive": city["city_genitive"],
            "city_dative": city["city_dative"],
            "slug": slug,
            "region": city.get("region", "Крым"),
            "soil_type": city["soil_type"],
            "frost_depth": city["frost_depth"],
            "districts": city["districts"],
            "delivery": city["delivery"],
            "case_title": city["case_title"],
            "case_text": city["case_text"],
            "case_price": city["case_price"],
            "case_duration": city["case_duration"],
            "case_residents": city["case_residents"],
            "case_distance": city["case_distance"],
            "phone": PHONE,
            "phone_formatted": PHONE_FORMATTED,
            "neighbor_links": build_neighbor_links(cities, slug),
            "footer_links": build_footer_links(cities, slug),
            **review_map,
        }

        html = template.safe_substitute(context)
        out_path = city_dir / "index.html"
        out_path.write_text(html, encoding="utf-8")
        url = f"https://kepstroy.ru/krym/{slug}/septik-pod-kluch/"
        generated.append(url)
        print(f"Generated: {out_path}")

    print(f"\nTotal generated: {len(generated)} city pages")
    for url in generated:
        print(url)


if __name__ == "__main__":
    main()
