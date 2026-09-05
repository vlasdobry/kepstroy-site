#!/usr/bin/env python3
"""Pre-deploy validation for kepstroy.ru static site.

Run locally from repo root:
    python scripts/validate.py

Checks:
- JSON-LD blocks are valid JSON
- All local href/src/srcset/action links resolve to existing files
- Static assets referenced from HTML exist
- sitemap.xml is valid XML and all URLs exist
- nginx.conf has required root/location configuration
- Each page has the consent-gated Metrika loader, Person schema, email, canonical,
  title, and description
- No page embeds a direct Metrika tag or noscript tracking pixel
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

from readiness_checks import check_traffic_readiness

REPO_ROOT = Path(__file__).resolve().parent.parent
HTML_ROOT = REPO_ROOT / "html"
NGINX_CONF = REPO_ROOT / "nginx.conf"
SITEMAP = HTML_ROOT / "sitemap.xml"

EXCLUDED_PAGES = {"404.html", "yandex_42d19edda2426210.html"}


def iter_html():
    for path in HTML_ROOT.rglob("*.html"):
        rel = path.relative_to(HTML_ROOT).as_posix()
        if rel in EXCLUDED_PAGES:
            continue
        yield path, rel


def check_jsonld(errors):
    for path, rel in iter_html():
        text = path.read_text(encoding="utf-8")
        scripts = re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.DOTALL)
        for i, script in enumerate(scripts, 1):
            try:
                json.loads(script)
            except json.JSONDecodeError as e:
                errors.append(f"{rel}: JSON-LD script #{i} invalid: {e}")


EXCLUDED_LINKS = {"/submit", "/webhook"}


def resolve_link(link, page_path):
    """Resolve a link relative to an HTML file and return absolute filesystem path.

    Some assets (e.g. portfolio images) are copied into the image from
    REPO_ROOT/images/portfolio/ rather than living under html/. We accept those.
    """
    if not link or link.startswith(("http://", "https://", "mailto:", "tel:", "data:", "#")):
        return None
    if link in EXCLUDED_LINKS:
        return None
    link = link.split("?")[0].split("#")[0]
    if link.startswith("/"):
        target = HTML_ROOT / link.lstrip("/")
    else:
        target = (page_path.parent / link).resolve()
    # Fallback for assets copied by Dockerfile from REPO_ROOT/images/
    if not target.exists() and target.is_relative_to(HTML_ROOT / "images"):
        alt = REPO_ROOT / target.relative_to(HTML_ROOT)
        if alt.exists():
            return alt
    return target


def check_local_links(errors):
    for path, rel in iter_html():
        text = path.read_text(encoding="utf-8")
        links = set()
        for m in re.finditer(r'(?:href|src|action)="([^"]+)"', text):
            links.add(m.group(1))
        for m in re.finditer(r'srcset="([^"]+)"', text):
            for part in m.group(1).split(","):
                url = part.strip().split(" ")[0]
                links.add(url)
        for link in links:
            target = resolve_link(link, path)
            if target is None:
                continue
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                errors.append(f"{rel}: broken link '{link}' -> {target.relative_to(REPO_ROOT).as_posix()}")


def check_static_assets(errors):
    """Ensure CSS/JS files referenced from HTML exist."""
    for path, rel in iter_html():
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"', text):
            target = resolve_link(m.group(1), path)
            if target and not target.exists():
                errors.append(f"{rel}: missing CSS {m.group(1)}")
        for m in re.finditer(r'<script[^>]*src="([^"]+)"', text):
            target = resolve_link(m.group(1), path)
            if target and not target.exists():
                errors.append(f"{rel}: missing JS {m.group(1)}")


def check_sitemap(errors):
    if not SITEMAP.exists():
        errors.append("sitemap.xml not found")
        return
    try:
        tree = ET.parse(SITEMAP)
    except ET.ParseError as e:
        errors.append(f"sitemap.xml parse error: {e}")
        return
    urls = [loc.text for loc in tree.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    seen = set()
    for url in urls:
        if url in seen:
            errors.append(f"sitemap.xml: duplicate URL {url}")
        seen.add(url)
        if "/llms" in url:
            errors.append(f"sitemap.xml: llms URL should not be here: {url}")
        parsed = urlparse(url)
        if parsed.netloc != "kepstroy.ru":
            continue
        path = parsed.path.lstrip("/")
        target = HTML_ROOT / path
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            errors.append(f"sitemap.xml: URL points to missing file {url}")


def check_nginx_config(errors):
    if not NGINX_CONF.exists():
        errors.append("nginx.conf not found")
        return
    text = NGINX_CONF.read_text(encoding="utf-8")
    if "root /usr/share/nginx/html" not in text:
        errors.append("nginx.conf: missing 'root /usr/share/nginx/html'")
    if "location / {" not in text:
        errors.append("nginx.conf: missing 'location / {'")
    if "try_files $uri $uri/ =404" not in text:
        errors.append("nginx.conf: missing try_files in location /")
    if r"location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|webp|avif)$" not in text:
        errors.append("nginx.conf: missing static files location")


def check_required_seo(errors):
    for path, rel in iter_html():
        text = path.read_text(encoding="utf-8")
        if '"@type": "Person"' not in text:
            errors.append(f"{rel}: missing Person schema")
        if "info@kepstroy.ru" in text:
            errors.append(f"{rel}: stale email info@kepstroy.ru found")
        if "<link rel=\"canonical\"" not in text:
            errors.append(f"{rel}: missing canonical link")
        if "<title>" not in text or "</title>" not in text:
            errors.append(f"{rel}: missing title tag")
        if '<meta name="description"' not in text:
            errors.append(f"{rel}: missing meta description")


def check_metrica_consent(errors):
    loader = '<script src="/js/analytics-consent.js?v=1"></script>'
    for path, rel in iter_html():
        text = path.read_text(encoding="utf-8")
        if text.count(loader) != 1:
            errors.append(f"{rel}: expected one consent-gated Yandex.Metrika loader")
        if "mc.yandex.ru/metrika/tag.js" in text:
            errors.append(f"{rel}: direct Yandex.Metrika tag bypasses consent")
        if "mc.yandex.ru/watch/109754800" in text:
            errors.append(f"{rel}: noscript Yandex.Metrika pixel bypasses consent")


def main():
    errors = []
    check_jsonld(errors)
    check_local_links(errors)
    check_static_assets(errors)
    check_sitemap(errors)
    check_nginx_config(errors)
    check_required_seo(errors)
    check_metrica_consent(errors)
    check_traffic_readiness(REPO_ROOT, errors)

    if errors:
        print("VALIDATION FAILED", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)
    else:
        print("All pre-deploy checks passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
