"""Public MSD Russian professional contents: titles/locations only, not medical text.

Only page-embedded navigation metadata and the declared topic sitemap are inspected.
A complete URL/name inventory is not a complete definition corpus or reuse permission.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import time
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

from .definition_reference_pack import encoded, normalized_name, obj, seq, text

HOST = "https://www.msdmanuals.com"
INDEX = "/ru/professional/health-topics"
MAX_BYTES = 16 * 1024 * 1024
FORMAT = "minimed-msd-topic-inventory-v1"


def public_path(value: object) -> str:
    raw = text(value, 4096)
    # urlsplit silently drops tab/newline characters, so reject control characters first.
    if any(ord(char) < 32 or ord(char) == 127 for char in raw):
        raise ValueError("Unsafe or non-Russian catalog path")
    parsed = urlsplit(raw)
    if (parsed.scheme or parsed.netloc) and (
        parsed.scheme != "https" or parsed.netloc != "www.msdmanuals.com"
    ):
        raise ValueError("MSD metadata points outside the inspected origin")
    if parsed.query or parsed.fragment:
        raise ValueError("Unexpected query/fragment in topic identity")
    path = unquote(parsed.path)
    if path.startswith("/professional/"):
        path = "/ru" + path
    if (
        not path.startswith("/ru/")
        or "\\" in path
        or "//" in path
        or any(part in {".", ".."} for part in path.split("/"))
        or any(ord(char) < 32 for char in path)
        or "%" in path
    ):
        raise ValueError("Unsafe or non-Russian catalog path")
    return path


class NextData(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.active = False
        self.count = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__":
            self.active = True
            self.count += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.active = False

    def handle_data(self, data: str) -> None:
        if self.active:
            self.parts.append(data)


def component_props(raw: bytes) -> dict[str, object]:
    if len(raw) > MAX_BYTES:
        raise ValueError("Catalog page exceeds byte budget")
    parser = NextData()
    parser.feed(raw.decode("utf-8"))
    if parser.count != 1:
        raise ValueError("Missing/ambiguous public page metadata")
    root = obj(json.loads("".join(parser.parts)))
    pp = obj(obj(root.get("props")).get("pageProps"))
    if pp.get("locale") != "ru":
        raise ValueError("Unexpected source language")
    return obj(pp.get("componentProps"))


class TitleText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in {"i", "em", "b", "strong", "sub", "sup", "span", "br"}:
            raise ValueError("Unexpected markup in a topic title")
        if tag == "br":
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def title_text(value: object) -> tuple[str, str]:
    original = text(value, 2048)
    parser = TitleText()
    parser.feed(original)
    title = " ".join("".join(parser.parts).replace("\ufeff", "").split())
    if not title or len(title) > 1024:
        raise ValueError("Missing or oversized source title")
    return title, original


def index_sections(raw: bytes) -> list[dict[str, str]]:
    selections: list[list[dict[str, str]]] = []
    for value in component_props(raw).values():
        comp = obj(value)
        data = comp.get("data")
        if not isinstance(data, list) or not data:
            continue
        if not all(isinstance(row, dict) and "titlecomputed_t" in row for row in data):
            continue
        rows = []
        for value in seq(data, 64):
            row = obj(value)
            path = public_path(row.get("relativeurlcomputed_s"))
            if len(path.strip("/").split("/")) != 3:
                raise ValueError("Expected a specialty index, not a topic request")
            title, _ = title_text(row.get("titlecomputed_t"))
            rows.append({"id": text(row.get("uniqueid_t"), 128), "title": title, "path": path})
        selections.append(rows)
    if len(selections) != 1 or not selections[0]:
        raise ValueError("Missing/ambiguous specialty navigation")
    if len({row["path"] for row in selections[0]}) != len(selections[0]):
        raise ValueError("Duplicate specialty navigation")
    return selections[0]


def section_topics(raw: bytes, section: dict[str, str]) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    found = 0
    for value in component_props(raw).values():
        comp = obj(value)
        if "fields" not in comp:
            continue
        item = obj(obj(obj(comp["fields"]).get("data", {})).get("item", {}))
        if "SectionChildrens" not in item:
            continue
        found += 1
        container = obj(item["SectionChildrens"])
        if obj(container.get("pageInfo", {})).get("hasNextPage"):
            raise ValueError("Source section is paginated; cannot claim complete collection")
        for chapter_value in seq(container.get("results"), 256):
            chapter = obj(chapter_value)
            chapter_title, _ = title_text(obj(chapter["ChapterName"]).get("value"))
            chapter_path = public_path(obj(chapter["ChapterUrl"]).get("path"))
            children = obj(chapter["ChapterChildren"])
            if obj(children.get("pageInfo", {})).get("hasNextPage"):
                raise ValueError("Source chapter is paginated")
            for topic_value in seq(children.get("results"), 1000):
                row = obj(topic_value)
                identifier = text(row.get("id"), 64).replace("-", "").lower()
                if not re.fullmatch(r"[a-f0-9]{32}", identifier):
                    raise ValueError("Invalid source topic identity")
                title, original = title_text(obj(row["TopicName"]).get("value"))
                path = public_path(obj(row["TopicUrl"]).get("path"))
                if not path.startswith("/ru/professional/") or len(path.split("/")) < 6:
                    raise ValueError("Not a professional topic location")
                # Explicit allowlist: Summary/InThisTopic/Description are never persisted.
                result.append(
                    {
                        "id": "msd.topic." + identifier,
                        "title": title,
                        "sourceTitle": original,
                        "path": path,
                        "sectionPath": section["path"],
                        "chapterTitle": chapter_title,
                        "chapterPath": chapter_path,
                    }
                )
    if found != 1 or not result:
        raise ValueError("Missing/ambiguous topic navigation")
    return result


def sitemap_locations(raw: bytes, kind: str) -> list[str]:
    if raw[:2] == b"\x1f\x8b":
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("Unsafe or oversized sitemap")
    root = ElementTree.fromstring(raw)
    if root.tag.rsplit("}", 1)[-1] != kind:
        raise ValueError("Unexpected sitemap document")
    paths = []
    for row in root:
        nodes = row.findall("{*}loc")
        if len(nodes) != 1 or not nodes[0].text:
            raise ValueError("Invalid sitemap location")
        paths.append(public_path(nodes[0].text))
    if not paths or len(paths) > 20000 or len(set(paths)) != len(paths):
        raise ValueError("Empty, duplicated or oversized sitemap")
    return paths


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self, req: Request, fp: object, code: int, msg: str, headers: object, newurl: str
    ) -> None:
        raise ValueError("MSD catalog redirect requires explicit inspection")


class PublicCatalogClient:
    def __init__(self) -> None:
        self.last_request = 0.0
        self.bytes = 0
        self.receipts: list[dict[str, object]] = []
        self.rules: list[re.Pattern[str]] = []
        self.delay = 5.1
        self.opener = build_opener(NoRedirect())
        raw = self.get("/robots.txt", bootstrap=True)
        robots = raw.decode("utf-8")
        active = False
        for line in robots.splitlines():
            key, _, value = line.partition(":")
            value = value.split("#", 1)[0].strip()
            if key.lower() == "user-agent":
                active = value == "*"
            elif active and key.lower() == "disallow" and value:
                pattern = re.escape(value).replace(r"\*", ".*").replace(r"\$", "$")
                self.rules.append(re.compile(pattern))
            elif active and key.lower() == "crawl-delay":
                delay = float(value)
                if not 0 <= delay <= 60:
                    raise ValueError("Unusable source crawl delay")
                self.delay = max(self.delay, delay)
        if not self.rules:
            raise ValueError("Source robots policy was not recognized")

    def get(self, path: str, *, bootstrap: bool = False) -> bytes:
        if not bootstrap:
            path = public_path(path)
            if any(rule.search(path) for rule in self.rules):
                raise ValueError("Robots exclusion: " + path)
            is_section = path.startswith("/ru/professional/") and len(path.split("/")) == 4
            is_sitemap = path == "/ru/sitemap.xml" or (
                path.startswith("/ru/sitemaps/professional-topic")
                and re.fullmatch(r"/ru/sitemaps/professional-topic[^/]*\.xml(?:\.gz)?", path)
            )
            if not is_section and not is_sitemap:
                raise ValueError("Only public index pages are fetched, not articles/APIs")
        if len(self.receipts) >= 70 or self.bytes >= 160 * 1024 * 1024:
            raise ValueError("Catalog acquisition budget exceeded")
        time.sleep(max(0.0, self.delay - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        request = Request(
            HOST + quote(path, safe="/-._~"),
            headers={
                "User-Agent": "MiniMedCatalogResearch/0.1 (+https://github.com/T-Damer/MiniMed)",
                "Accept-Encoding": "identity",
            },
        )
        try:
            with self.opener.open(request, timeout=60) as response:
                raw = response.read(MAX_BYTES + 1)
        except HTTPError as error:
            raise RuntimeError(f"MSD index request stopped: HTTP {error.code}") from None
        if len(raw) > MAX_BYTES:
            raise ValueError("Source metadata response too large")
        self.bytes += len(raw)
        self.receipts.append(
            {"path": path, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        )
        return raw


def collect_catalog() -> dict[str, object]:
    client = PublicCatalogClient()
    sections = index_sections(client.get(INDEX))
    references: list[dict[str, object]] = []
    sections_report = []
    for section in sections:
        raw = client.get(section["path"])
        topics = section_topics(raw, section)
        receipt = hashlib.sha256(raw).hexdigest()
        for row in topics:
            row["indexSha256"] = receipt
        references.extend(topics)
        sections_report.append({**section, "topicReferences": len(topics), "sha256": receipt})
        print("Catalogued section:", section["title"], len(topics), flush=True)
    children = sitemap_locations(client.get("/ru/sitemap.xml"), "sitemapindex")
    topic_maps = [path for path in children if path.startswith("/ru/sitemaps/professional-topic")]
    if not topic_maps:
        raise ValueError("Professional topic sitemap was not declared")
    sitemap: set[str] = set()
    for path in topic_maps:
        sitemap.update(sitemap_locations(client.get(path), "urlset"))
    titles: dict[str, str] = {}
    for row in references:
        identifier, title = str(row["id"]), str(row["title"])
        if identifier in titles and titles[identifier] != title:
            raise ValueError("A source identity has conflicting titles; review before importing")
        titles[identifier] = title
    locations = {str(row["path"]) for row in references}
    return {
        "format": FORMAT,
        "collectedAt": datetime.now(UTC).isoformat(),
        "scope": "ru/professional public topic navigation",
        "sections": sections_report,
        "references": references,
        "receipts": client.receipts,
        "sitemapTopicPaths": sorted(sitemap),
        "sitemapOnlyPaths": sorted(sitemap - locations),
        "navigationOnlyPaths": sorted(locations - sitemap),
        "uniqueSourceTopics": len(titles),
        "uniqueTopicPaths": len(locations),
        "normalizedTitles": len({normalized_name(title) for title in titles.values()}),
        "topicReferences": len(references),
        "articleBodiesFetched": 0,
        "definitionsAcquired": 0,
        "boundary": (
            "Topic/title index only; not all in-article terms, medical definitions, "
            "clinical review or content reuse permission."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Use a new immutable metadata output")
    result = collect_catalog()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as handle:
        handle.write(encoded(result) + "\n")
    print(
        json.dumps(
            {
                key: value
                for key, value in result.items()
                if key
                not in {
                    "references",
                    "receipts",
                    "sitemapTopicPaths",
                    "sections",
                }
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
