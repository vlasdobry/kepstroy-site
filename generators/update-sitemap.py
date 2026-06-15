#!/usr/bin/env python3
"""Обновляет sitemap.xml, добавляя городские страницы КэпСтроя."""

import json
import re
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent / "html"
TEMPLATE_DIR = Path(__file__).resolve().parent
SITEMAP_PATH = BASE_DIR / "sitemap.xml"
DATA_PATH = TEMPLATE_DIR / "city-septik-data.json"

TODAY = datetime.now().strftime("%Y-%m-%d")


def main():
    with DATA_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    cities = data["cities"]

    sitemap = SITEMAP_PATH.read_text(encoding="utf-8")

    # Удаляем старые записи по городским URL, кроме самого /krym/
    pattern = re.compile(
        r"\s*<url>\s*<loc>https://kepstroy\.ru/krym/[^<]*</loc>.*?</url>",
        re.DOTALL,
    )
    sitemap = pattern.sub("", sitemap)

    new_urls = []
    # Региональный хаб
    new_urls.append(
        f"""  <url>
    <loc>https://kepstroy.ru/krym/</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>"""
    )
    for city in cities:
        slug = city["slug"]
        # Городская страница
        new_urls.append(
            f"""  <url>
    <loc>https://kepstroy.ru/krym/{slug}/</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>"""
        )
        # Страница септика
        new_urls.append(
            f"""  <url>
    <loc>https://kepstroy.ru/krym/{slug}/septik-pod-kluch/</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>"""
        )

    # Вспомогательные файлы для GEO и AI-агентов
    new_urls.append(
        f"""  <url>
    <loc>https://kepstroy.ru/llms.txt</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>"""
    )
    new_urls.append(
        f"""  <url>
    <loc>https://kepstroy.ru/llms-full.txt</loc>
    <lastmod>{TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>"""
    )

    new_block = "\n".join(new_urls) + "\n"
    sitemap = sitemap.replace("</urlset>", new_block + "</urlset>")

    SITEMAP_PATH.write_text(sitemap, encoding="utf-8")
    print(f"Updated {SITEMAP_PATH}")
    print(f"Added {len(new_urls)} URLs (regional hub + {len(cities)} cities + {len(cities)} service pages)")


if __name__ == "__main__":
    main()
