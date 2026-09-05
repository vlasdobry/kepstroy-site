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
SITE_HOSTS = {"kepstroy.ru", "www.kepstroy.ru"}
SOCIAL_IMAGE_META = {"og:image", "og:image:url", "twitter:image", "twitter:image:src"}
SCHEMA_URL_KEYS = {
    "@id",
    "url",
    "image",
    "logo",
    "contenturl",
    "thumbnailurl",
    "embedurl",
    "sameas",
    "item",
    "target",
    "mainentityofpage",
    "urltemplate",
}


def structured_urls(value: object):
    if isinstance(value, dict):
        for key, child in value.items():
            normalized_key = key.lower()
            if normalized_key == "@context":
                continue
            if normalized_key in SCHEMA_URL_KEYS:
                yield from structured_url_values(child)
            else:
                yield from structured_urls(child)
    elif isinstance(value, list):
        for child in value:
            yield from structured_urls(child)


def structured_url_values(value: object):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for child in value:
            yield from structured_url_values(child)
    elif isinstance(value, dict):
        yield from structured_urls(value)


class Document(HTMLParser):
    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.references: list[tuple[str, str, str]] = []
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
        meta_kind = (values.get("property") or values.get("name") or "").lower()
        if tag == "meta" and meta_kind in SOCIAL_IMAGE_META and values.get("content"):
            self.references.append((tag, "content", values["content"]))
        if tag == "img":
            self.images += 1

        for attribute in ("href", "src", "action"):
            if values.get(attribute):
                self.references.append((tag, attribute, values[attribute]))
        if values.get("srcset"):
            for candidate in values["srcset"].split(","):
                url = candidate.strip().split()[0] if candidate.strip() else ""
                if url:
                    self.references.append((tag, "srcset", url))

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
    decoded_path = unquote(url_path)
    clean = decoded_path.lstrip("/")
    target = (HTML_ROOT / clean).resolve()
    if url_path.endswith("/") or target.is_dir():
        target = target / "index.html"
    portfolio_prefix = "/images/portfolio/"
    if not target.exists() and decoded_path.startswith(portfolio_prefix):
        portfolio_tail = decoded_path[len(portfolio_prefix):]
        target = (REPO_ROOT / "images" / "portfolio" / portfolio_tail).resolve()
    return target


def is_same_site(url: str) -> bool:
    parsed = urlparse(url)
    if (parsed.hostname or "").lower() not in SITE_HOSTS:
        return False
    if parsed.scheme.lower() not in {"http", "https"}:
        return False
    try:
        port = parsed.port
    except ValueError:
        return False
    default_port = 443 if parsed.scheme.lower() == "https" else 80
    return port in {None, default_port}


def should_skip_non_resource(tag: str, attribute: str, url_path: str) -> bool:
    return (
        tag.lower() == "form"
        and attribute.lower() == "action"
        and url_path in NON_RESOURCE_ENDPOINTS
    )


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
                parsed_payload = json.loads(payload)
            except json.JSONDecodeError as exc:
                errors.append(f"{url}: invalid JSON-LD #{index}: {exc}")
            else:
                doc.references.extend(
                    ("script", "json-ld", value)
                    for value in structured_urls(parsed_payload)
                )

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
        "json_ld_references": 0,
        "social_image_references": 0,
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

        for tag, attribute, raw in doc.references:
            counters["references"] += 1
            if tag == "script" and attribute == "json-ld":
                counters["json_ld_references"] += 1
            elif tag == "meta" and attribute == "content":
                counters["social_image_references"] += 1
            parsed_raw = urlparse(raw)
            if parsed_raw.scheme in {"mailto", "tel", "data", "javascript"}:
                counters["external_references"] += 1
                continue

            absolute = urlparse(urljoin(SITE_ORIGIN + url, raw))
            if absolute.scheme in {"http", "https"} and not is_same_site(absolute.geturl()):
                counters["external_references"] += 1
                continue
            if should_skip_non_resource(tag, attribute, absolute.path):
                counters["internal_references"] += 1
                continue

            counters["internal_references"] += 1
            target = target_for_path(absolute.path)
            allowed_roots = (
                HTML_ROOT.resolve(),
                (REPO_ROOT / "images" / "portfolio").resolve(),
            )
            reference_label = (
                f"{tag} {attribute}"
                if attribute in {"content", "json-ld"}
                else attribute
            )
            if not any(target == root or root in target.parents for root in allowed_roots):
                errors.append(f"{url}: {reference_label} escapes site roots: {raw!r}")
                continue
            if not target.exists():
                errors.append(f"{url}: missing {reference_label} target {raw!r}")
                continue

            if absolute.fragment and attribute != "json-ld":
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
