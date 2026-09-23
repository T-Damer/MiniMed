"""Acquire explicitly selected short definitions, not articles or a general web crawl."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import time
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup, Tag

from .definition_name_completions import FORMAT, apply_name_completions
from .definition_name_inventory import add_name_inventory, read_name_manifest
from .definition_reference_pack import (
    MAX_INPUT_BYTES,
    Projection,
    digest,
    encoded,
    normalized_name,
    number,
    obj,
    seq,
    source_path,
    text,
)
from .definition_reference_scope import definition_scope
from .definition_source_manifest import read_source_manifest
from .definition_source_policy import require_active_definition_source

HOSTS = {
    "www.invitro.ru",
    "www.smclinic.ru",
    "ivanovo.smclinic.ru",
    "www.dermatology.ru",
    "medvestnik.by",
    "wbdent.ru",
    "stom-dental.ru",
    "www.k31.ru",
    "clinic-complex.ru",
    "www.krasotaimedicina.ru",
}
USER_AGENT = "MiniMedReferenceBot/1.0 (+https://github.com/T-Damer/MiniMed)"
MAX_PAGE_BYTES = 2 * 1024 * 1024


def normalized_visible(value: str) -> str:
    return " ".join(value.split())


def verify_excerpt(raw: bytes, excerpt: str, author: str | None = None) -> dict[str, object]:
    """Retain only the selected text. Hashes/offsets refer to whitespace-normalized HTML text."""
    if len(raw) > MAX_PAGE_BYTES or not excerpt or len(excerpt.split()) > 25:
        raise ValueError("Page/excerpt budget exceeded")
    if normalized_visible(excerpt) != excerpt or not excerpt.endswith((".", "!", "?")):
        raise ValueError("Expected a complete, explicitly selected sentence")
    soup = BeautifulSoup(raw, "html.parser")
    for node in soup.find_all(["script", "style", "noscript", "template"]):
        node.decompose()
    header = soup.find("h1")
    if not isinstance(header, Tag) or not header.get_text(strip=True):
        raise ValueError("Medical article heading is missing")
    visible = normalized_visible(soup.get_text(" ", strip=True))
    if author is not None and normalized_visible(author) not in visible:
        raise ValueError("Expected article author is absent")
    candidates: set[str] = set()
    for node in soup.find_all(["p", "li", "div", "section", "article"]):
        if not isinstance(node, Tag):
            continue
        paragraph = normalized_visible(node.get_text(" ", strip=True))
        if len(paragraph) <= 8192 and paragraph.count(excerpt) == 1:
            candidates.add(paragraph)
    if not candidates:
        raise ValueError("Exact selected definition is absent from visible source paragraphs")
    paragraph = min(candidates, key=lambda value: (len(value), value))
    start = paragraph.index(excerpt)
    return {
        "method": "visible-paragraph-exact-v1",
        "normalization": "whitespace-only",
        "responseSha256": hashlib.sha256(raw).hexdigest(),
        "paragraphSha256": digest(paragraph),
        "excerptSha256": digest(excerpt),
        "start": start,
        "end": start + len(excerpt),
        "articleTitle": normalized_visible(header.get_text(" ", strip=True)),
        "retrievedAt": datetime.now(UTC).isoformat(),
        "author": author,
    }


def fetch_public(url: str) -> tuple[int, bytes, str]:
    """No credentials, cookies, proxy environment, arbitrary hosts or cross-origin redirects."""
    for _ in range(4):
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in HOSTS
            or parsed.username
            or parsed.password
            or parsed.port
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("URL is outside the inspected source allowlist")
        host = parsed.hostname
        if host is None:
            raise ValueError("Missing source host")
        connection = http.client.HTTPSConnection(host, timeout=20)
        try:
            connection.request("GET", parsed.path or "/", headers={"User-Agent": USER_AGENT})
            response = connection.getresponse()
            raw = response.read(MAX_PAGE_BYTES + 1)
            if len(raw) > MAX_PAGE_BYTES:
                raise ValueError("Source response exceeds byte budget")
            if response.status in {301, 302, 303, 307, 308}:
                destination = urljoin(url, response.getheader("Location") or "")
                if (
                    urlsplit(destination).netloc != parsed.netloc
                    or destination == url
                    or urlsplit(destination).path.rstrip("/") != parsed.path.rstrip("/")
                ):
                    raise ValueError("Source redirects outside its exact authority")
                url = destination
                continue
            return response.status, raw, response.getheader("Content-Type") or ""
        finally:
            connection.close()
    raise ValueError("Source redirect budget exceeded")


def load_projection(root: Path) -> Projection:
    inputs, _ = read_source_manifest(root, root / "content/definition-drafts/source-inputs.json")
    projection = Projection()
    for path in inputs:
        raw = path.read_bytes()
        payload = obj(json.loads(raw))
        require_active_definition_source(payload)
        projection.add(payload, hashlib.sha256(raw).hexdigest())
    selected, _ = definition_scope(projection.entries)
    projection.entries = {key: val for key, val in projection.entries.items() if key in selected}
    for path in read_name_manifest(root):
        raw = path.read_bytes()
        add_name_inventory(projection, json.loads(raw), hashlib.sha256(raw).hexdigest())
    # Include earlier accepted completions, if any, rather than refilling the same name.
    from .definition_name_completions import read_completion_manifest

    for path in read_completion_manifest(root):
        raw = path.read_bytes()
        apply_name_completions(projection, json.loads(raw), hashlib.sha256(raw).hexdigest())
    return projection


def collect(root: Path, authoring: Path) -> tuple[dict[str, object], dict[str, object]]:
    if authoring.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("Candidate input exceeds budget")
    raw_authoring = authoring.read_bytes()
    authored = obj(json.loads(raw_authoring))
    if (
        authored.get("version") != 1
        or authored.get("textKind") != "source-excerpt"
        or authored.get("reviewStatus") != "requires-review"
        or authored.get("publicationState") != "local-dev"
    ):
        raise ValueError("Invalid clinic-definition authoring contract")
    sources: dict[int, dict[str, object]] = {}
    for value in seq(authored.get("sources"), 16):
        source = obj(value)
        local_id = number(source.get("id"))
        if local_id in sources or source.get("releaseEligible") is not False:
            raise ValueError("Duplicate or publishable source")
        source_path(source, "")
        if urlsplit(text(source["baseUrl"])).hostname not in HOSTS:
            raise ValueError("Uninspected source host")
        sources[local_id] = source
    require_active_definition_source({"sources": list(sources.values()), "terms": []})
    projection = load_projection(root)
    names: dict[str, list[str]] = {}
    defined: set[str] = set()
    for entry in projection.entries.values():
        key = normalized_name(entry.title)
        if entry.coverage == "needs-definition":
            names.setdefault(key, []).append(entry.id)
        elif entry.coverage in {"definition", "explicit-definition"}:
            defined.add(key)
    terms: list[dict[str, object]] = []
    blocks: list[dict[str, object]] = []
    targets: list[dict[str, object]] = []
    outcomes: list[dict[str, object]] = []
    robots: dict[str, RobotFileParser] = {}
    seen: set[str] = set()
    used_sources: set[int] = set()
    quoted_per_url: Counter[str] = Counter()
    for value in seq(authored.get("fills"), 100):
        candidate = obj(value)
        candidate_id = text(candidate["id"], 80)
        title = text(candidate["targetTitle"])
        key = normalized_name(title)
        if candidate_id in seen:
            raise ValueError("Duplicate candidate identity")
        seen.add(candidate_id)
        outcome: dict[str, object] = {"id": candidate_id, "title": title}
        outcomes.append(outcome)
        if key in defined:
            outcome["status"] = "already-has-definition"
            continue
        matched = names.get(key, [])
        if len(matched) != 1:
            outcome["status"] = "missing-or-ambiguous-name"
            continue
        target = projection.entries[matched[0]]
        source_id = number(candidate["source"])
        descriptor = sources[source_id]
        relative = source_path(descriptor, candidate["path"])
        url = urljoin(text(descriptor["baseUrl"]), relative)
        excerpt = text(candidate["excerpt"], 4096)
        if quoted_per_url[url] + len(excerpt.split()) > 25:
            raise ValueError("Combined excerpt budget for a source page exceeded")
        author = None if candidate.get("author") is None else text(candidate["author"], 256)
        modified = None if candidate.get("modified") is None else text(candidate["modified"], 10)
        if modified is not None:
            date.fromisoformat(modified)
        outcome["url"] = url
        try:
            host = urlsplit(url).netloc
            if host not in robots:
                robots_url = f"https://{host}/robots.txt"
                status, data, _ = fetch_public(robots_url)
                parser = RobotFileParser(robots_url)
                if status == 404:
                    parser.parse([])
                elif status == 200:
                    parser.parse(data.decode("utf-8", errors="replace").splitlines())
                else:
                    raise ValueError(f"robots.txt returned HTTP {status}")
                robots[host] = parser
            if not robots[host].can_fetch(USER_AGENT, url):
                raise ValueError("Source robots policy disallows this request")
            time.sleep(1)
            status, raw, content_type = fetch_public(url)
            if status != 200 or "text/html" not in content_type.lower():
                raise ValueError(f"Source returned unsupported HTTP/content type: {status}")
            proof = verify_excerpt(raw, excerpt, author)
            proof["sourceModifiedAtResearch"] = modified
            proof["url"] = url
        except (OSError, ValueError, http.client.HTTPException) as exc:
            outcome["status"] = "source-pending"
            outcome["reason"] = str(exc)[:240]
            continue
        quoted_per_url[url] += len(excerpt.split())
        used_sources.add(source_id)
        block_id = len(blocks) + 1
        blocks.append(
            {
                "id": block_id,
                "source": source_id,
                "text": excerpt,
                "textSha256": digest(excerpt),
                "path": relative,
                "locator": text(candidate["locator"], 512),
                "sourceVerification": proof,
                "definitionSelection": "explicit source-local gap fill; not clinician reviewed",
            }
        )
        terms.append(
            {
                "id": target.id,
                "title": target.title,
                "kind": target.kind,
                "aliases": [],
                "coverage": "definition",
                "blockIds": [block_id],
            }
        )
        targets.append(
            {
                "id": target.id,
                "expectedTitle": target.title,
                "discoveryReceipt": target.receipt,
            }
        )
        outcome.update({"status": "accepted", "targetId": target.id, "block": block_id})
        defined.add(key)
    catalog = {
        "version": 3,
        "id": "clinic-gap-completions-2026.09.23",
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "textKind": "source-excerpt",
        "sources": [sources[n] for n in sorted(used_sources)],
        "blocks": blocks,
        "terms": terms,
        "acquisition": {"authoringSha256": hashlib.sha256(raw_authoring).hexdigest()},
    }
    bundle = {"format": FORMAT, "catalog": catalog, "targets": targets}
    if targets:
        apply_name_completions(projection, bundle, digest(encoded(bundle)))
    report = {
        "candidateCount": len(outcomes),
        "accepted": len(targets),
        "byStatus": dict(Counter(str(row["status"]) for row in outcomes)),
        "outcomes": outcomes,
        "sourcesUsed": len(used_sources),
        "authoringSha256": hashlib.sha256(raw_authoring).hexdigest(),
        "boundary": (
            "Literal short definitions verified against visible source text; clinical review and "
            "public redistribution are not granted. Existing definitions and ambiguous names "
            "are not overwritten. No full articles, scales, treatments or Wikipedia prose imported."
        ),
    }
    return bundle, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--authoring", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if (
        args.output.exists()
        or args.report.exists()
        or args.output.resolve() == args.report.resolve()
    ):
        parser.error("Use distinct new output and report paths")
    bundle, report = collect(args.root.resolve(), args.authoring)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if report["accepted"] == 0:
        raise ValueError("No definitions acquired; pending reasons were recorded")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(encoded(bundle) + "\n")
    print(encoded({key: report[key] for key in ("candidateCount", "accepted", "byStatus")}))


if __name__ == "__main__":
    main()
