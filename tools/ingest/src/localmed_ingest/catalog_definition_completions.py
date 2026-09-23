"""Fill existing empty names from a bounded, source-verified medical catalog batch.

No model, general-purpose crawl, inferred synonym, identity merge or publication approval.
The ordinary completion collector independently refetches and verifies every selected sentence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup, Tag

from .clinic_definition_completions import (
    USER_AGENT,
    collect,
    fetch_public,
    load_projection,
    normalized_visible,
    verify_excerpt,
)
from .definition_gap_inventory import build_gap_inventory
from .definition_name_completions import apply_name_completions
from .definition_reference_pack import digest, encoded, normalized_name

CATALOG = "https://www.smclinic.ru/simptomy/"
SOURCES = [
    {
        "id": 1,
        "title": "СМ-Клиника — медицинские статьи о симптомах",
        "baseUrl": "https://www.smclinic.ru/",
        "sourceType": "medical-clinic",
        "authority": "secondary-medical",
        "releaseEligible": False,
    },
    {
        "id": 2,
        "title": "ИНВИТРО — медицинская библиотека",
        "baseUrl": "https://www.invitro.ru/",
        "sourceType": "medical-clinic",
        "authority": "secondary-medical",
        "releaseEligible": False,
    },
]
# Inspected pages; prefixes identify source text, never replace it with generated prose.
SEEDS = [
    ("Гипергидроз", "library/simptomy/25958/", "Гипергидрозом называют"),
    ("Тахипноэ", "library/simptomy/24895/", "Учащенное неглубокое дыхание (тахипноэ)"),
    ("Гипостенурия", "library/simptomy/39132/", "Гипостенурия"),
]


def catalog_links(raw: bytes) -> dict[str, str]:
    """Only exact titles on the inspected catalog and same-origin symptom article paths."""
    soup = BeautifulSoup(raw, "html.parser")
    matches: dict[str, set[str]] = {}
    for anchor in soup.find_all("a", href=True):
        if not isinstance(anchor, Tag):
            continue
        href = anchor.get("href")
        if not isinstance(href, str):
            continue
        parsed = urlsplit(urljoin(CATALOG, href))
        if (
            parsed.scheme != "https"
            or parsed.netloc != "www.smclinic.ru"
            or parsed.query
            or parsed.fragment
            or not re.fullmatch(r"/simptomy/[a-z0-9-]+/", parsed.path)
        ):
            continue
        title = normalized_name(anchor.get_text(" ", strip=True))
        if title:
            matches.setdefault(title, set()).add(parsed.path.lstrip("/"))
    return {title: next(iter(paths)) for title, paths in matches.items() if len(paths) == 1}


def select_sentence(raw: bytes, title: str, prefix: str | None = None) -> str | None:
    """A short complete, title-led definitional sentence; every heuristic result needs review."""
    soup = BeautifulSoup(raw, "html.parser")
    for node in soup.find_all(["script", "style", "noscript", "template"]):
        node.decompose()
    expected = normalized_name(prefix or title)
    for paragraph in soup.find_all("p"):
        if not isinstance(paragraph, Tag):
            continue
        visible = normalized_visible(paragraph.get_text(" ", strip=True))
        normalized = normalized_name(visible)
        if prefix is not None:
            if not normalized.startswith(expected):
                continue
            start = len(prefix)
        else:
            match = re.match(
                re.escape(expected) + r"(?:\s+\([^)]{1,120}\))?\s*[—–-]\s+",
                normalized,
            )
            if match is None:
                continue
            start = match.end()
        ending = re.search(r"[.!?](?=\s|$)", visible[start:])
        if ending is None:
            continue
        excerpt = visible[: start + ending.end()]
        if excerpt.count("(") != excerpt.count(")") or len(excerpt.split()) > 25:
            continue
        try:
            verify_excerpt(raw, excerpt)
        except ValueError:
            continue
        return excerpt
    return None


class PublicSourceReader:
    """Reuse the strict public host/redirect limits and respect each host's robots policy."""

    def __init__(self) -> None:
        self.robots: dict[str, RobotFileParser] = {}
        self.delays: dict[str, float] = {}

    def read(self, url: str) -> bytes:
        host = urlsplit(url).netloc
        if host not in self.robots:
            robots_url = f"https://{host}/robots.txt"
            status, raw, _ = fetch_public(robots_url)
            parser = RobotFileParser(robots_url)
            if status == 404:
                parser.parse([])
            elif status == 200:
                parser.parse(raw.decode("utf-8", errors="replace").splitlines())
            else:
                raise ValueError(f"robots.txt returned HTTP {status}")
            delay = parser.crawl_delay(USER_AGENT) or parser.crawl_delay("*") or 1
            if delay > 30:
                raise ValueError("Source crawl delay exceeds this bounded batch budget")
            self.robots[host] = parser
            self.delays[host] = float(max(1, delay))
        if not self.robots[host].can_fetch(USER_AGENT, url):
            raise ValueError("Source robots policy disallows this request")
        time.sleep(self.delays[host])
        status, raw, content_type = fetch_public(url)
        if status != 200 or "text/html" not in content_type.lower():
            raise ValueError(f"Unsupported source HTTP/content type: {status}")
        return raw


def run(root: Path, batch: str, limit: int) -> dict[str, object]:
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,79}", batch) or not 1 <= limit <= 60:
        raise ValueError("Invalid batch identity or page budget")
    output = root / f"content/definition-drafts/catalog-completions-{batch}.json"
    report_path = root / f"docs/research/catalog-completions-{batch}.json"
    if output.exists() or report_path.exists():
        raise ValueError("A completed batch is immutable; choose a new batch identity")
    projection = load_projection(root)
    before = build_gap_inventory(projection)
    ready = {
        normalized_name(entry.title): entry.title
        for entry in projection.entries.values()
        if entry.coverage == "needs-definition"
    }
    for row in before["rows"]:
        if row["status"] != "ready-for-source-research":
            ready.pop(row["normalizedTitle"], None)
    reader = PublicSourceReader()
    discovery: list[dict[str, object]] = []
    selections: list[tuple[str, int, str, str | None]] = []
    catalog_receipt: str | None = None
    for title, path, prefix in SEEDS:
        if normalized_name(title) in ready:
            selections.append((ready[normalized_name(title)], 2, path, prefix))
    try:
        raw_catalog = reader.read(CATALOG)
        catalog_receipt = hashlib.sha256(raw_catalog).hexdigest()
        seeded = {normalized_name(row[0]) for row in selections}
        for name, path in sorted(catalog_links(raw_catalog).items()):
            if name in ready and name not in seeded:
                selections.append((ready[name], 1, path, None))
    except (OSError, ValueError) as exc:
        discovery.append({"url": CATALOG, "status": "catalog-pending", "reason": str(exc)[:240]})
    fills: list[dict[str, object]] = []
    for title, source, path, prefix in selections[:limit]:
        url = str(SOURCES[source - 1]["baseUrl"]) + path
        outcome: dict[str, object] = {"title": title, "url": url}
        discovery.append(outcome)
        try:
            raw = reader.read(url)
            excerpt = select_sentence(raw, title, prefix)
            if excerpt is None:
                outcome["status"] = "no-short-explicit-definition"
                continue
            fills.append({
                "id": f"catalog.candidate.{len(fills) + 1}",
                "targetTitle": title,
                "source": source,
                "path": path,
                "excerpt": excerpt,
                "locator": "Title-led complete paragraph sentence; bounded catalog selection v1",
                "author": None,
                "modified": None,
            })
            outcome["status"] = "selected-for-independent-refetch"
        except (OSError, ValueError) as exc:
            outcome.update({"status": "source-pending", "reason": str(exc)[:240]})
    authoring = {
        "version": 1,
        "textKind": "source-excerpt",
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "sources": SOURCES,
        "fills": fills,
    }
    with tempfile.TemporaryDirectory(prefix="minimed-definition-batch-") as temporary:
        path = Path(temporary) / "selected.json"
        path.write_text(encoded(authoring), encoding="utf-8")
        bundle, acquisition = collect(root, path)
    accepted = int(acquisition["accepted"])
    if accepted:
        bundle["catalog"]["id"] = f"catalog-completions-{batch}"
        raw = (encoded(bundle) + "\n").encode("utf-8")
        apply_name_completions(projection, bundle, hashlib.sha256(raw).hexdigest())
        manifest_path = root / "content/definition-drafts/completion-inputs.json"
        manifest = json.loads(manifest_path.read_bytes())
        if len(manifest["inputs"]) >= 16:
            raise ValueError("Completion manifest input budget exhausted")
        manifest["inputs"].append({
            "path": output.relative_to(root).as_posix(),
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        })
        output.write_bytes(raw)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        reloaded = load_projection(root)
        if len(reloaded.entries) != len(projection.entries):
            raise AssertionError("Gap filling changed the source identity count")
        after = build_gap_inventory(reloaded)
    else:
        after = before
    report = {
        "batch": batch,
        "catalogUrl": CATALOG,
        "catalogSha256": catalog_receipt,
        "pageBudget": limit,
        "discoveredEligiblePages": len(selections),
        "selectedPages": len(selections[:limit]),
        "discovery": discovery,
        "discoveryStatus": dict(Counter(str(row["status"]) for row in discovery)),
        "acquisition": acquisition,
        "before": {key: value for key, value in before.items() if key != "rows"},
        "after": {key: value for key, value in after.items() if key != "rows"},
        "boundary": (
            "Automatic syntactic selection is not clinical review. Source sentences are refetched "
            "and checked verbatim; no title-only sense merge, generated medical prose, treatment "
            "recommendation or redistribution approval. Whole source pages are not committed."
        ),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--batch", required=True)
    parser.add_argument("--limit", type=int, default=40)
    args = parser.parse_args()
    report = run(args.root.resolve(strict=True), args.batch, args.limit)
    print(json.dumps(report, ensure_ascii=False))
    if not report["acquisition"]["accepted"]:
        raise SystemExit("No definitions accepted; source deferrals were recorded")


if __name__ == "__main__":
    main()
