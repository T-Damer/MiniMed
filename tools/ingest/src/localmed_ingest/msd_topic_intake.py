"""Discover MSD topic URLs and fill explicitly matched empty names with source definitions.

Sitemaps inventory pages, not medical concepts. URL slugs are never clinical names.
The live pass is explicit, sequential, robots-aware and bounded; preparation is offline.
Full articles are neither committed nor included in a knowledge package.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import time
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

HOST = "www.msdmanuals.com"
ORIGIN = "https://" + HOST
AGENT = "MiniMedSourceInventory/1.0 (+https://github.com/T-Damer/MiniMed)"
MAX_BYTES = 32 * 1024 * 1024
NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def checksum(value: bytes | str) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def checked_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != HOST
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or parsed.fragment
        or "\\" in value
        or any(ord(c) < 32 for c in value)
    ):
        raise ValueError("MSD intake requires an unambiguous same-origin HTTPS URL")
    path = unquote(parsed.path)
    if any(part in {".", ".."} for part in path.split("/")) or "%" in path:
        raise ValueError("Ambiguous MSD source path")
    return urlunsplit(("https", HOST, quote(path, safe="/-._~"), parsed.query, ""))


def topic_url(value: str) -> bool:
    parts = unquote(urlsplit(checked_url(value)).path).strip("/").split("/")
    return (
        len(parts) >= 5
        and parts[0] in {"ru", "ru-ru"}
        and parts[1] in {"professional", "home"}
        and parts[2]
        not in {
            "multimedia",
            "news",
            "authors",
            "resourcespages",
            "pages-with-widgets",
            "monograph",
        }
    )


class Robots:
    def __init__(self, body: str) -> None:
        self.delay = 5.0
        self.rules: list[tuple[bool, str]] = []
        self.sitemaps: list[str] = []
        agents: list[str] = []
        directives = False
        for line in body.splitlines():
            field, separator, value = line.split("#", 1)[0].partition(":")
            if not separator:
                continue
            key, value = field.strip().lower(), value.strip()
            if key == "sitemap":
                self.sitemaps.append(checked_url(value))
            elif key == "user-agent":
                if directives:
                    agents = []
                    directives = False
                agents.append(value.lower())
            else:
                directives = True
                if "*" not in agents:
                    continue
                if key == "crawl-delay":
                    self.delay = max(5.0, float(value))
                elif key in {"allow", "disallow"} and value:
                    self.rules.append((key == "allow", value))
        if self.delay > 60:
            raise ValueError("Source crawl delay is outside this bounded pass")

    def allowed(self, value: str) -> bool:
        parsed = urlsplit(checked_url(value))
        path = unquote(parsed.path) + ("?" + parsed.query if parsed.query else "")
        matched: list[tuple[int, bool]] = []
        for allow, rule in self.rules:
            end = rule.endswith("$")
            escaped = re.escape(unquote(rule[:-1] if end else rule)).replace(r"\*", ".*")
            if re.match("^" + escaped + ("$" if end else ""), path):
                matched.append((len(rule.replace("*", "")), allow))
        return max(matched, default=(0, True))[1]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


class Fetcher:
    def __init__(self) -> None:
        self.policy: Robots | None = None
        self.previous = 0.0
        self.requests = 0
        self.receipts: list[dict[str, object]] = []
        self.opener = build_opener(NoRedirect())

    def get(self, value: str) -> tuple[bytes, str]:
        url = checked_url(value)
        for _ in range(6):
            if self.policy is not None and not self.policy.allowed(url):
                raise ValueError("Robots policy disallows this source path")
            delay = self.policy.delay if self.policy else 5.0
            time.sleep(max(0.0, delay - (time.monotonic() - self.previous)))
            self.previous = time.monotonic()
            self.requests += 1
            try:
                request = Request(url, headers={"User-Agent": AGENT, "Accept-Encoding": "identity"})
                with self.opener.open(request, timeout=35) as response:
                    body = response.read(MAX_BYTES + 1)
                    if len(body) > MAX_BYTES:
                        raise ValueError("Source response exceeds byte budget")
                    self.receipts.append({"url": url, "bytes": len(body), "sha256": checksum(body)})
                    return body, url
            except HTTPError as exc:
                if exc.code not in {301, 302, 303, 307, 308}:
                    raise
                location = exc.headers.get("Location")
                if not location:
                    raise ValueError("Redirect without a location") from exc
                url = checked_url(urljoin(url, location))
        raise ValueError("Source redirect budget exhausted")


def sitemap_locations(raw: bytes, *, index: bool) -> list[str]:
    if raw.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
            raw = compressed.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES or re.search(rb"<!\s*(?:DOCTYPE|ENTITY)", raw, re.I):
        raise ValueError("Unsafe or oversized sitemap")
    root = ET.fromstring(raw.decode("utf-8-sig"))
    if root.tag != NS + ("sitemapindex" if index else "urlset"):
        raise ValueError("Unexpected sitemap root")
    selector = (NS + "sitemap" if index else NS + "url") + "/" + NS + "loc"
    locations = [checked_url(node.text or "") for node in root.findall(selector)]
    if not locations or len(locations) > 50000:
        raise ValueError("Unexpected sitemap location count")
    return sorted(set(locations))


def topic_sitemap_children(raw: bytes, root_url: str) -> list[str]:
    """Inspected index roots differ: ru has home+professional; ru-ru professional only."""
    route = urlsplit(checked_url(root_url)).path
    if route == "/ru/sitemap.xml":
        expected = {
            ORIGIN + "/ru/sitemaps/" + name + "-topic.xml.gz" for name in ("home", "professional")
        }
    elif route == "/ru-ru/sitemap.xml":
        expected = {ORIGIN + "/ru-ru/sitemaps/professional-topic.xml.gz"}
    else:
        raise ValueError("Unknown Russian source index")
    children = [
        url
        for url in sitemap_locations(raw, index=True)
        if re.search(r"/(?:professional|home)-topic\.xml(?:\.gz)?$", url)
    ]
    if set(children) != expected:
        raise ValueError("Topic sitemap set changed; inspect before continuing")
    return children


class TopicParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool, str | None]] = []
        self.parts: dict[str, list[str]] = defaultdict(list)
        self.metadata: dict[str, str] = {}
        self.canonical: str | None = None
        self.counts: dict[str, int] = defaultdict(int)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        hidden = (
            any(row[1] for row in self.stack)
            or tag in {"script", "style", "noscript"}
            or "hidden" in values
            or values.get("aria-hidden") == "true"
            or values.get("data-nosnippet") is not None
            or "display:none" in (values.get("style") or "").replace(" ", "")
        )
        if tag == "meta":
            key = values.get("name") or values.get("property")
            if key and values.get("content"):
                self.metadata[key.lower()] = str(values["content"])
        if tag == "link" and values.get("rel") == "canonical":
            self.canonical = values.get("href")
        key = None
        if not hidden:
            if tag == "h1" and values.get("id") == "topicHeaderTitle":
                key = "title"
            elif tag == "p" and values.get("data-testid") == "topicDefinition":
                key = "definition"
            elif "TopicHead_topic__revision" in (values.get("class") or ""):
                key = "revision"
            if key:
                self.counts[key] += 1
        if tag not in {
            "meta",
            "link",
            "img",
            "input",
            "br",
            "hr",
            "source",
            "wbr",
            "area",
            "base",
            "embed",
            "param",
            "track",
        }:
            self.stack.append((tag, hidden, key))

    def handle_endtag(self, tag: str) -> None:
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                return

    def handle_data(self, data: str) -> None:
        if any(row[1] for row in self.stack):
            return
        for key in {row[2] for row in self.stack if row[2]}:
            if key is not None:
                self.parts[key].append(data)

    def text(self, key: str) -> str:
        return re.sub(r"\s+", " ", "".join(self.parts[key])).strip()


def first_definition(paragraph: str, title: str) -> str | None:
    if not paragraph or len(paragraph) > 20000 or len(title) > 256:
        return None

    def fold(value: str) -> str:
        return re.sub(r"\s+", " ", value.casefold().replace("ё", "е")).strip()

    if not fold(paragraph).startswith(fold(title)) or re.match(
        r"^(?:обзор|как|введение|подход|оценка)\b", fold(title)
    ):
        return None
    level = 0
    for index, character in enumerate(paragraph):
        level += character == "("
        level -= character == ")"
        if level < 0:
            return None
        if (
            character != "."
            or level
            or (index + 1 < len(paragraph) and not paragraph[index + 1].isspace())
        ):
            continue
        token = re.search(r"[\w]+$", paragraph[:index])
        if token and (len(token[0]) <= 2 or token[0].isdigit()):
            continue
        sentence = paragraph[: index + 1]
        if not re.search(
            r"\s[–—-]\s|\s(?:это|является|представляет|характеризуется|характеризуются|означает)\s",
            sentence,
        ):
            return None
        if len(sentence.split()) <= 25 and "…" not in sentence and "..." not in sentence:
            return sentence
        return None
    return None


def parse_topic(raw: bytes, requested: str, retrieved_at: str) -> dict[str, object]:
    if len(raw) > MAX_BYTES or not topic_url(requested):
        raise ValueError("Invalid source topic input")
    parser = TopicParser()
    parser.feed(raw.decode("utf-8-sig"))
    if parser.counts["title"] != 1 or parser.counts["definition"] != 1:
        raise ValueError("Topic heading/definition is missing or ambiguous")
    title, paragraph = parser.text("title"), parser.text("definition")
    canonical = checked_url(parser.canonical or parser.metadata.get("og:url", ""))
    if not topic_url(canonical):
        raise ValueError("Canonical source is not a medical topic")

    def route(value: str) -> str:
        return unquote(urlsplit(value).path).replace("/ru-ru/", "/ru/", 1).rstrip("/")

    if route(canonical) != route(requested):
        raise ValueError("Source canonical identity differs from the requested topic")
    topic_id = parser.metadata.get("vasontid", "")
    if not re.fullmatch(r"v\d+_ru", topic_id):
        raise ValueError("Missing Russian MSD source identity")
    sentence = first_definition(paragraph, title)
    return {
        "title": title,
        "url": canonical,
        "topicId": topic_id,
        "definition": sentence,
        "revisionLabel": parser.text("revision")[:512],
        "authorIds": parser.metadata.get("og:author"),
        "sourceVerification": {
            "method": "visible-paragraph-exact-v1",
            "responseSha256": checksum(raw),
            "paragraphSha256": checksum(paragraph),
            "excerptSha256": checksum(sentence) if sentence else None,
            "start": 0,
            "end": len(sentence) if sentence else None,
            "retrievedAt": retrieved_at,
            "normalization": "HTML entities and whitespace only",
        },
    }


def collect(root: Path, output: Path, maximum_pages: int) -> dict[str, object]:
    from .definition_name_completions import apply_name_completions, read_completion_manifest
    from .definition_name_inventory import add_name_inventory, read_name_manifest
    from .definition_reference_pack import Projection, encoded, normalized_name
    from .definition_reference_scope import definition_scope
    from .definition_source_manifest import read_source_manifest

    if output.exists() or not 1 <= maximum_pages <= 80:
        raise ValueError("Use a fresh output directory and a 1..80 page budget")
    output.mkdir(parents=True)
    p = Projection()
    inputs, _ = read_source_manifest(root, root / "content/definition-drafts/source-inputs.json")
    for path in inputs:
        raw = path.read_bytes()
        p.add(json.loads(raw), checksum(raw))
    selected, _ = definition_scope(p.entries)
    p.entries = {key: row for key, row in p.entries.items() if key in selected}
    for path in read_name_manifest(root):
        raw = path.read_bytes()
        add_name_inventory(p, json.loads(raw), checksum(raw))
    for path in read_completion_manifest(root):
        raw = path.read_bytes()
        apply_name_completions(p, json.loads(raw), checksum(raw))
    pending: dict[str, list[str]] = defaultdict(list)
    defined = {
        normalized_name(name)
        for row in p.entries.values()
        if row.coverage != "needs-definition"
        for name in row.names
    }
    for identifier, row in p.entries.items():
        if row.coverage == "needs-definition" and normalized_name(row.title) not in defined:
            pending[normalized_name(row.title)].append(identifier)
    fetcher = Fetcher()
    robots, _ = fetcher.get(ORIGIN + "/robots.txt")
    fetcher.policy = Robots(robots.decode("utf-8-sig"))
    roots = [
        url
        for url in fetcher.policy.sitemaps
        if unquote(urlsplit(url).path) in {"/ru/sitemap.xml", "/ru-ru/sitemap.xml"}
    ]
    if len(roots) != 2:
        raise ValueError("Expected both advertised Russian sitemap roots")
    inventories: dict[str, list[str]] = {}
    for sitemap_root in sorted(roots):
        body, _ = fetcher.get(sitemap_root)
        for child in topic_sitemap_children(body, sitemap_root):
            body, _ = fetcher.get(child)
            inventories[child] = sitemap_locations(body, index=False)
    urls = sorted({url for values in inventories.values() for url in values if topic_url(url)})
    (output / "topics.json").write_text(
        encoded(
            {
                "format": "minimed-msd-topic-inventory-v1",
                "retrievedAt": datetime.now(UTC).isoformat(),
                "sitemaps": inventories,
                "topicUrls": urls,
                "completeForAdvertisedTopicSitemaps": True,
                "medicalConceptCompleteness": False,
                "titleSource": "not-inferred-from-slugs",
            }
        )
        + "\n"
    )
    # A slug schedules inspection only. Identity must be confirmed by the visible page title.
    buckets: dict[str, deque[str]] = {}
    route_seen: set[str] = set()
    for url in sorted(urls, key=checksum):
        parts = unquote(urlsplit(url).path).strip("/").split("/")
        key = normalized_name(parts[-1].replace("-", " "))
        route = "/".join(parts[1:])
        if parts[1] != "professional" or len(pending.get(key, [])) != 1 or route in route_seen:
            continue
        route_seen.add(route)
        buckets.setdefault(parts[2], deque()).append(url)
    schedule: list[str] = []
    while any(buckets.values()) and len(schedule) < maximum_pages:
        for bucket in sorted(buckets):
            if buckets[bucket] and len(schedule) < maximum_pages:
                schedule.append(buckets[bucket].popleft())
    blocks: list[dict[str, object]] = []
    terms: list[dict[str, object]] = []
    targets: list[dict[str, object]] = []
    decisions: list[dict[str, object]] = []
    completed: set[str] = set()
    quoted_pages: set[str] = set()
    for url in schedule:
        try:
            raw, final_url = fetcher.get(url)
            page = parse_topic(raw, final_url, datetime.now(UTC).isoformat())
            normalized = normalized_name(str(page["title"]))
            choices = pending.get(normalized, [])
            if (
                not page["definition"]
                or len(choices) != 1
                or choices[0] in completed
                or str(page["topicId"]) in quoted_pages
            ):
                decisions.append(
                    {
                        "url": url,
                        "title": page["title"],
                        "status": "requires-excerpt-or-identity-review",
                    }
                )
                continue
            identifier = choices[0]
            old = p.entries[identifier]
            block_id = len(blocks) + 1
            text = str(page["definition"])
            blocks.append(
                {
                    "id": block_id,
                    "source": 1,
                    "text": text,
                    "textSha256": checksum(text),
                    "path": unquote(urlsplit(str(page["url"])).path).lstrip("/"),
                    "locator": f"{page['topicId']}; topicDefinition; first complete sentence",
                    "sourceVerification": page["sourceVerification"],
                    "sourceTopicId": page["topicId"],
                    "sourceRevisionLabel": page["revisionLabel"],
                    "sourceAuthorIds": page["authorIds"],
                    "reviewStatus": "requires-review",
                    "fullPageSnapshotStored": False,
                }
            )
            terms.append(
                {
                    "id": identifier,
                    "title": old.title,
                    "kind": old.kind,
                    "aliases": [],
                    "coverage": "definition",
                    "blockIds": [block_id],
                }
            )
            targets.append(
                {"id": identifier, "expectedTitle": old.title, "discoveryReceipt": old.receipt}
            )
            decisions.append(
                {
                    "url": url,
                    "id": identifier,
                    "title": old.title,
                    "status": "source-definition-candidate",
                }
            )
            completed.add(identifier)
            quoted_pages.add(str(page["topicId"]))
        except HTTPError as exc:
            if exc.code in {401, 403, 429}:
                raise RuntimeError(
                    "Source access/rate limit requires stopping, not bypassing"
                ) from exc
            decisions.append({"url": url, "status": "http-error", "code": exc.code})
        except (ValueError, UnicodeError) as exc:
            decisions.append(
                {"url": url, "status": "source-shape-requires-review", "reason": str(exc)}
            )
    catalog = {
        "version": 3,
        "id": "msd-gap-definitions-2026.09.23",
        "textKind": "source-excerpt",
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "sources": [
            {
                "id": 1,
                "title": "Справочник MSD — профессиональная версия",
                "baseUrl": ORIGIN + "/",
                "sourceType": "professional-medical-reference",
                "authority": "third-party",
                "releaseEligible": False,
                "rightsStatus": "requires-review",
                "language": "ru",
            }
        ],
        "blocks": blocks,
        "terms": terms,
    }
    payload = {"format": "minimed-name-completions-v1", "catalog": catalog, "targets": targets}
    if targets:
        apply_name_completions(p, payload, checksum(encoded(payload)))
        (output / "completions.json").write_text(encoded(payload) + "\n")
    report = {
        "topicSitemaps": len(inventories),
        "uniqueTopicUrls": len(urls),
        "professionalUrls": sum("/professional/" in url for url in urls),
        "homeUrls": sum("/home/" in url for url in urls),
        "pagesScheduled": len(schedule),
        "definitionsPrepared": len(terms),
        "requests": fetcher.requests,
        "crawlDelaySeconds": fetcher.policy.delay,
        "robotsSha256": checksum(robots),
        "httpReceipts": fetcher.receipts,
        "decisions": decisions,
        "boundaries": (
            "Complete advertised topic URL inventory, not a complete term/definition dictionary. "
            "Only bounded missing-name completions; URL slugs never become concept titles. "
            "Source sentences require medical/rights review. No article bodies stored, "
            "clinical promotion or automatic same-as links."
        ),
    }
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, default=60)
    args = parser.parse_args()
    result = collect(args.root.resolve(), args.output, args.max_pages)
    fields = (
        "topicSitemaps",
        "uniqueTopicUrls",
        "pagesScheduled",
        "definitionsPrepared",
        "requests",
    )
    print(json.dumps({key: result[key] for key in fields}))


if __name__ == "__main__":
    main()
