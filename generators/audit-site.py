#!/usr/bin/env python3
"""Систематический аудит консистентности сайта КэпСтрой."""

import json
import re
from pathlib import Path
from collections import defaultdict
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent.parent / "html"
PHONE = "+7 (978) 461-59-62"
PHONE_RAW = "+79784615962"

results = {
    "total_html": 0,
    "no_title": [],
    "no_description": [],
    "no_canonical": [],
    "no_metrika": [],
    "no_schema": [],
    "phone_missing": [],
    "placeholders": [],
    "broken_internal_links": [],
    "duplicate_titles": defaultdict(list),
    "duplicate_descriptions": defaultdict(list),
    "title_too_long": [],
    "description_too_long": [],
    "css_version_mismatch": defaultdict(list),
    "js_version_mismatch": defaultdict(list),
    "no_favicon": [],
    "invalid_schema_json": [],
    "visit_wording_variants": defaultdict(list),
}


def normalize_link(link, current_file):
    if link.startswith("http") or link.startswith("mailto:") or link.startswith("tel:") or link.startswith("#"):
        return None
    if link.startswith("/"):
        target = BASE / link.lstrip("/").split("?")[0].split("#")[0]
    else:
        target = (current_file.parent / link).resolve()
        target = Path(str(target).split("?")[0].split("#")[0])
    return target


def main():
    for path in sorted(BASE.rglob("*.html")):
        rel = str(path.relative_to(BASE)).replace("\\", "/")
        # Пропускаем служебные файлы
        if rel in {"yandex_42d19edda2426210.html", "404.html"}:
            continue
        results["total_html"] += 1
        text = path.read_text(encoding="utf-8")

        # Title
        m = re.search(r"<title>(.*?)</title>", text, re.DOTALL)
        title = m.group(1).strip() if m else None
        if not title:
            results["no_title"].append(rel)
        else:
            results["duplicate_titles"][title].append(rel)
            if len(title) > 60:
                results["title_too_long"].append((rel, len(title), title))

        # Description
        m = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]+)"', text)
        desc = m.group(1).strip() if m else None
        if not desc:
            results["no_description"].append(rel)
        else:
            results["duplicate_descriptions"][desc].append(rel)
            if len(desc) > 160:
                results["description_too_long"].append((rel, len(desc), desc))

        # Canonical
        if '<link rel="canonical"' not in text:
            results["no_canonical"].append(rel)

        # Metrika
        if "mc.yandex.ru/metrika" not in text:
            results["no_metrika"].append(rel)

        # Favicon
        if "favicon" not in text:
            results["no_favicon"].append(rel)

        # Schema.org
        if "application/ld+json" not in text:
            results["no_schema"].append(rel)
        else:
            for m in re.finditer(
                r'<script type="application/ld+json">(.*?)</script>',
                text,
                re.DOTALL,
            ):
                try:
                    json.loads(m.group(1).strip())
                except Exception as e:
                    results["invalid_schema_json"].append(f"{rel}: {e}")

        # Phone
        if PHONE not in text and PHONE_RAW not in text:
            results["phone_missing"].append(rel)

        # Placeholders
        if "${" in text:
            results["placeholders"].append(rel)

        # CSS/JS version
        for m in re.finditer(r'href="([^"]*css/style\.css[^"]*)"', text):
            version = m.group(1).split("?v=")[-1] if "?v=" in m.group(1) else "none"
            results["css_version_mismatch"][version].append(rel)
        for m in re.finditer(r'src="([^"]*js/main\.js[^"]*)"', text):
            version = m.group(1).split("?v=")[-1] if "?v=" in m.group(1) else "none"
            results["js_version_mismatch"][version].append(rel)

        # Visit wording
        for variant in re.findall(r"[Вв]ыезд[^<.]{0,140}", text):
            clean = " ".join(variant.split())
            if clean:
                results["visit_wording_variants"][clean].append(rel)

        # Broken internal links
        for link in re.findall(r'href=["\']([^"\']+)["\']', text):
            target = normalize_link(link, path)
            if target is None:
                continue
            if not target.exists():
                results["broken_internal_links"].append((rel, link))

    write_report()


def write_report():
    report_path = Path(__file__).resolve().parent / "audit-report.md"
    lines = []
    lines.append("# Аудит консистентности сайта КэпСтрой")
    lines.append("")
    lines.append(f"**Всего HTML-файлов проверено:** {results['total_html']}")
    lines.append(f"**Дата:** {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    sections = [
        ("## 1. Нет title", results["no_title"]),
        ("## 2. Нет description", results["no_description"]),
        ("## 3. Нет canonical", results["no_canonical"]),
        ("## 4. Нет Яндекс.Метрики", results["no_metrika"]),
        ("## 5. Нет favicon", results["no_favicon"]),
        ("## 6. Нет Schema.org JSON-LD", results["no_schema"]),
        ("## 7. Некорректный JSON в Schema.org", results["invalid_schema_json"]),
        ("## 8. Нет телефона на странице", results["phone_missing"]),
        ("## 9. Остались плейсхолдеры", results["placeholders"]),
    ]

    for header, items in sections:
        lines.append(header)
        if items:
            for item in items:
                lines.append(f"- {item}")
        else:
            lines.append("- Проблем не обнаружено")
        lines.append("")

    lines.append("## 10. Title > 60 символов")
    if results["title_too_long"]:
        for rel, length, title in results["title_too_long"]:
            lines.append(f"- `[{length}] {rel}`: {title}")
    else:
        lines.append("- Проблем не обнаружено")
    lines.append("")

    lines.append("## 11. Description > 160 символов")
    if results["description_too_long"]:
        for rel, length, desc in results["description_too_long"]:
            lines.append(f"- `[{length}] {rel}`: {desc[:90]}...")
    else:
        lines.append("- Проблем не обнаружено")
    lines.append("")

    lines.append("## 12. Дубли title")
    dup_titles = {k: v for k, v in results["duplicate_titles"].items() if len(v) > 1}
    if dup_titles:
        for title, files in dup_titles.items():
            lines.append(f"- '{title[:70]}...' — {len(files)} файлов:")
            for f in files:
                lines.append(f"  - {f}")
    else:
        lines.append("- Дублей не обнаружено")
    lines.append("")

    lines.append("## 13. Дубли description")
    dup_descs = {k: v for k, v in results["duplicate_descriptions"].items() if len(v) > 1}
    if dup_descs:
        for desc, files in dup_descs.items():
            lines.append(f"- '{desc[:70]}...' — {len(files)} файлов:")
            for f in files[:5]:
                lines.append(f"  - {f}")
    else:
        lines.append("- Дублей не обнаружено")
    lines.append("")

    lines.append("## 14. Версии CSS (style.css)")
    for version, files in results["css_version_mismatch"].items():
        lines.append(f"- `?v={version}` — {len(files)} файлов")
        for f in files[:3]:
            lines.append(f"  - {f}")
    lines.append("")

    lines.append("## 15. Версии JS (main.js)")
    for version, files in results["js_version_mismatch"].items():
        lines.append(f"- `?v={version}` — {len(files)} файлов")
        for f in files[:3]:
            lines.append(f"  - {f}")
    lines.append("")

    lines.append("## 16. Потенциально сломанные внутренние ссылки")
    if results["broken_internal_links"]:
        for rel, link in results["broken_internal_links"][:50]:
            lines.append(f"- `{rel}` -> `{link}`")
    else:
        lines.append("- Проблем не обнаружено")
    lines.append("")

    lines.append("## 17. Варианты формулировок про выезд инженера")
    sorted_variants = sorted(
        results["visit_wording_variants"].items(),
        key=lambda x: -len(x[1]),
    )
    for variant, files in sorted_variants:
        if len(variant) > 10:
            unique_files = list(dict.fromkeys(files))[:5]
            lines.append(f"- ({len(files)}x) {variant}")
            for f in unique_files:
                lines.append(f"  - {f}")
    lines.append("")

    lines.append("## 18. Рекомендации")
    lines.append("- Поддерживать согласованные cache-busting версии CSS/JS в HTML и шаблонах.")
    lines.append("- Не включать служебные страницы call и spasibo в sitemap; сохранять для них noindex.")
    lines.append("- Укоротить title/description в блог-статьях, где > лимита.")
    lines.append("- Добавить Schema.org на страницы услуг (`/uslugi/*`) и информационные страницы.")
    lines.append("- Проверить и унифицировать формулировки про выезд инженера.")
    lines.append("")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report saved to {report_path}")


if __name__ == "__main__":
    main()
