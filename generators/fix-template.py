#!/usr/bin/env python3
"""Исправляет падежи городов в шаблоне city-septik-template.html."""

from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = TEMPLATE_DIR / "city-septik-template.html"

html = TEMPLATE_PATH.read_text(encoding="utf-8")

# 1. Везде, где речь о "в городе", заменяем ${city} на ${city_dative}
# (city_dative в данных на самом деле содержит предложный падеж)
html = html.replace("${city}", "${city_dative}")

# 2. Восстанавливаем именительный падеж там, где нужно название города
html = html.replace('"addressLocality": "${city_dative}"', '"addressLocality": "${city}"')
html = html.replace('"name": "${city_dative}"', '"name": "${city}"')

# 3. Исправляем грунт: "Работаем с ${soil_type}" → "Работаем с любыми грунтами: ${soil_type}"
html = html.replace("Работаем с ${soil_type},", "Работаем с любыми грунтами: ${soil_type}.")

# 4. "рядом с городом" вместо "рядом с ${city_dative}"
html = html.replace("рядом с ${city_dative}", "рядом с городом ${city}")

# 5. Исправляем alt-атрибуты
html = html.replace('alt="Септик под ключ ${city_dative}"', 'alt="Септик под ключ в ${city_dative}"')
html = html.replace('alt="Установка автономной канализации ${city_dative}"', 'alt="Установка автономной канализации в ${city_dative}"')

TEMPLATE_PATH.write_text(html, encoding="utf-8")
print("Template fixed.")
