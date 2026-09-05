#!/usr/bin/env python3
"""Offline structural crawler for the deployed ``html/`` source tree.

The crawler deliberately performs no network requests. Links to kepstroy.ru are
resolved back into the local tree; third-party links are counted and skipped.
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse


REPO_ROOT = Path(__file__).resolve().parent.parent
HTML_ROOT = REPO_ROOT / "html"
SITE_ORIGIN = "https://kepstroy.ru"
YANDEX_VERIFICATION = "yandex_42d19edda2426210.html"
NON_RESOURCE_ENDPOINTS = {"/submit", "/webhook"}


class Document(HTMLParser):
    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.references: list[tuple[str, str]] = []
        self.canonicals: list[str] = []
        self.robots: list[str] = []
        self.images = 0
        self.json_ld: list[str] = []
        self._json_ld_chunks: list[str] | None = None
        self.feed(source)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        if values.get("id"):
            self.ids.append(values["id"])

        if tag == "link" and "canonical" in values.get("rel", "").lower().split():
            self.canonicals.append(values.get("href", ""))
        if tag == "meta" and values.get("name", "").lower() == "robots":
            self.robots.append(values.get("content", ""))
        if tag == "img":
            self.images += 1

        for attribute in ("href", "src", "action"):
            if values.get(attribute):
                self.references.append((attribute, values[attribute]))
        if values.get("srcset"):
            for candidate in values["srcset"].split(","):
                url = candidate.strip().split()[0] if candidate.strip() else ""
                if url:
                    self.references.append(("srcset", url))

        if tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._json_ld_chunks = []

    def handle_data(self, data: str) -> None:
        if self._json_ld_chunks is not None:
            self._json_ld_chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._json_ld_chunks is not None:
            self.json_ld.append("".join(self._json_ld_chunks))
            self._json_ld_chunks = None


def page_url(path: Path) -> str:
    rel = path.relative_to(HTML_ROOT).as_posix()
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    return "/" + rel


def target_for_path(url_path: str) -> Path:
    clean = unquote(url_path).lstrip("/")
    target = (HTML_ROOT / clean).resolve()
    if url_path.endswith("/") or target.is_dir():
        target = target / "index.html"
    if not target.exists() and url_path.startswith("/images/"):
        target = (REPO_ROOT / clean).resolve()
    return target


def main() -> int:
    errors: list[str] = []
    pages = sorted(
        path
        for path in HTML_ROOT.rglob("*.html")
        if path.name != YANDEX_VERIFICATION
    )
    documents: dict[str, tuple[Path, Document]] = {}

    for path in pages:
        doc = Document(path.read_text(encoding="utf-8"))
        url = page_url(path)
        documents[url] = (path, doc)
        duplicates = sorted({value for value in doc.ids if doc.ids.count(value) > 1})
        if duplicates:
            errors.append(f"{url}: duplicate ids: {', '.join(duplicates)}")
        for index, payload in enumerate(doc.json_ld, 1):
            try:
                json.loads(payload)
            except json.JSONDecodeError as exc:
                errors.append(f"{url}: invalid JSON-LD #{index}: {exc}")

    counters = {
        "html_pages": len(pages),
        "indexable_pages": 0,
        "noindex_pages": 0,
        "error_pages": 0,
        "references": 0,
        "internal_references": 0,
        "external_references": 0,
        "fragment_references": 0,
        "images": 0,
        "json_ld_blocks": 0,
        "canonicals": 0,
        "sitemap_urls": 0,
        "robots_user_agents": 0,
    }
    indexable_canonicals: set[str] = set()

    for url, (path, doc) in documents.items():
        counters["images"] += doc.images
        counters["json_ld_blocks"] += len(doc.json_ld)
        is_error = url == "/404.html"
        is_noindex = any("noindex" in value.lower() for value in doc.robots)
        if is_error:
            counters["error_pages"] += 1
        elif is_noindex:
            counters["noindex_pages"] += 1
        else:
            counters["indexable_pages"] += 1
            expected = SITE_ORIGIN + url
            if doc.canonicals != [expected]:
                errors.append(
                    f"{url}: canonical must be exactly {expected!r}, got {doc.canonicals!r}"
                )
            else:
                indexable_canonicals.add(expected)
                counters["canonicals"] += 1

        for attribute, raw in doc.references:
            counters["references"] += 1
            parsed_raw = urlparse(raw)
            if parsed_raw.scheme in {"mailto", "tel", "data", "javascript"}:
                counters["external_references"] += 1
                continue

            absolute = urlparse(urljoin(SITE_ORIGIN + url, raw))
            if absolute.netloc and absolute.netloc != "kepstroy.ru":
                counters["external_references"] += 1
                continue
            if absolute.path in NON_RESOURCE_ENDPOINTS:
                counters["internal_references"] += 1
                continue

            counters["internal_references"] += 1
            target = target_for_path(absolute.path)
            allowed_roots = (HTML_ROOT.resolve(), (REPO_ROOT / "images").resolve())
            if not any(target == root or root in target.parents for root in allowed_roots):
                errors.append(f"{url}: {attribute} escapes site roots: {raw!r}")
                continue
            if not target.exists():
                errors.append(f"{url}: missing {attribute} target {raw!r}")
                continue

            if absolute.fragment:
                counters["fragment_references"] += 1
                target_url = page_url(target) if target.suffix.lower() == ".html" else ""
                target_doc = documents.get(target_url)
                if target_doc is None or absolute.fragment not in target_doc[1].ids:
                    errors.append(f"{url}: missing fragment target {raw!r}")

    sitemap_path = HTML_ROOT / "sitemap.xml"
    try:
        tree = ET.parse(sitemap_path)
        sitemap_urls = [
            node.text or ""
            for node in tree.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
        ]
    except (OSError, ET.ParseError) as exc:
        errors.append(f"sitemap.xml: {exc}")
        sitemap_urls = []
    counters["sitemap_urls"] = len(sitemap_urls)
    if len(sitemap_urls) != len(set(sitemap_urls)):
        errors.append("sitemap.xml: duplicate URLs")
    if set(sitemap_urls) != indexable_canonicals:
        missing = sorted(indexable_canonicals - set(sitemap_urls))
        extra = sorted(set(sitemap_urls) - indexable_canonicals)
        errors.append(f"sitemap.xml mismatch: missing={missing}, extra={extra}")

    robots_path = HTML_ROOT / "robots.txt"
    try:
        robots_lines = [
            line.strip()
            for line in robots_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
    except OSError as exc:
        errors.append(f"robots.txt: {exc}")
        robots_lines = []
    counters["robots_user_agents"] = sum(
        line.lower().startswith("user-agent:") for line in robots_lines
    )
    if "Sitemap: https://kepstroy.ru/sitemap.xml" not in robots_lines:
        errors.append("robots.txt: canonical sitemap declaration is missing")
    if not any(line.lower() == "user-agent: *" for line in robots_lines):
        errors.append("robots.txt: default User-agent is missing")

    if errors:
        print("STATIC CRAWL FAILED", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print("STATIC CRAWL OK")
    for key, value in counters.items():
        print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
