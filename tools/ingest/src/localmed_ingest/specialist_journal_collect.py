"""Bounded original-publisher acquisition; source fragments never become app dependencies."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import tempfile
import time
import urllib.error
import urllib.request
import urllib.robotparser
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from .definition_reference_pack import Projection, encoded, obj, seq, text
from .specialist_journal_reference import (
    HOST,
    MAX_PAGE_BYTES,
    article_url,
    capture_page,
    project_article,
)

USER_AGENT = "MiniMed-Reference-Research/0.1 (+https://github.com/T-Damer/MiniMed/issues/180)"


class PublisherRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> urllib.request.Request | None:
        target = urlsplit(newurl)
        if target.scheme != "https" or target.netloc != "journals.eco-vector.com":
            raise ValueError("Publisher redirected outside the explicit source host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read_original(url: str) -> bytes:
    target = urlsplit(url)
    if target.scheme != "https" or target.netloc != "journals.eco-vector.com":
        raise ValueError("Unexpected journal source host")
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "ru",
            "Accept-Encoding": "identity",
        },
    )
    opener = urllib.request.build_opener(PublisherRedirect())
    for attempt in range(3):
        try:
            with opener.open(request, timeout=40) as response:
                body: bytes = response.read(MAX_PAGE_BYTES + 1)
                if len(body) > MAX_PAGE_BYTES:
                    raise ValueError("Publisher response exceeds the acquisition budget")
                return body
        except urllib.error.HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
            delay = error.headers.get("Retry-After", "")
            time.sleep(min(60, int(delay)) if delay.isdigit() else 3 * (attempt + 1))
    raise RuntimeError("Unreachable publisher retry state")


def collect(selection: Path, output: Path) -> dict[str, object]:
    if output.exists():
        raise ValueError("Collection output already exists; use a new immutable edition")
    raw_selection = selection.read_bytes()
    selected = obj(json.loads(raw_selection))
    if (
        selected.get("version") != 1
        or selected.get("sourcePolicy") != "specialist-medical-sources-2026-09-22"
    ):
        raise ValueError("Unexpected specialist source selection")
    candidates = [obj(row) for row in seq(selected.get("articles"), 24)]
    if not candidates:
        raise ValueError("Empty specialist source selection")
    identities: set[str] = set()
    for row in candidates:
        url = article_url(text(row.get("journal"), 40), text(row.get("articleId"), 12))
        if url in identities:
            raise ValueError("Duplicate source article selection")
        identities.add(url)
    robot_raw = read_original(HOST + "/robots.txt")
    robots = urllib.robotparser.RobotFileParser()
    robots.parse(robot_raw.decode("utf-8").splitlines())
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="specialist-sources-", dir=output.parent) as temporary:
        staged = Path(temporary) / "collection"
        (staged / "records").mkdir(parents=True)
        (staged / "evidence").mkdir()
        (staged / "evidence/robots.txt").write_bytes(robot_raw)
        outcomes: list[dict[str, object]] = []
        counts: Counter[str] = Counter()
        for candidate in candidates:
            journal = text(candidate.get("journal"), 40)
            aid = text(candidate.get("articleId"), 12)
            url = article_url(journal, aid)
            record: dict[str, object] = {
                "journal": journal,
                "articleId": aid,
                "url": url,
                "selectionFocus": candidate.get("focus"),
            }
            if not robots.can_fetch(USER_AGENT, url):
                outcomes.append({**record, "status": "pending-robots-disallowed"})
                continue
            time.sleep(1.5)
            try:
                raw = read_original(url)
                captured = capture_page(raw, journal, aid, datetime.now(UTC).isoformat())
                projected = project_article(captured)
                validation = Projection()
                validation.add(projected, hashlib.sha256(encoded(projected).encode()).hexdigest())
                stem = journal.lower() + "-" + aid
                evidence = "evidence/" + stem + ".json.gz"
                prepared = "records/" + stem + ".json"
                evidence_raw = encoded(captured).encode()
                prepared_raw = encoded(projected).encode()
                (staged / evidence).write_bytes(
                    gzip.compress(evidence_raw, compresslevel=9, mtime=0)
                )
                (staged / prepared).write_bytes(prepared_raw)
                terms = [obj(v) for v in seq(projected["terms"], 5000)]
                sources = [obj(v) for v in seq(projected["sources"], 1000)]
                blocks = [obj(v) for v in seq(projected["blocks"], 1000)]
                counts.update(
                    {
                        "records": len(terms),
                        "articles": 1,
                        "blocks": len(blocks),
                        "definitionCandidates": sum(
                            t["coverage"] == "explicit-definition" for t in terms
                        ),
                        "sectionCards": sum(t["coverage"] == "section-excerpt" for t in terms),
                    }
                )
                outcomes.append(
                    {
                        **record,
                        "status": "prepared-requires-review",
                        "title": sources[0]["title"],
                        "publicationDate": sources[0]["publicationDate"],
                        "license": sources[0]["license"],
                        "articleType": sources[0]["articleType"],
                        "records": len(terms),
                        "blocks": len(blocks),
                        "evidence": evidence,
                        "evidenceSha256": hashlib.sha256(
                            (staged / evidence).read_bytes()
                        ).hexdigest(),
                        "prepared": prepared,
                        "preparedSha256": hashlib.sha256(prepared_raw).hexdigest(),
                        "proposedTitles": [t["title"] for t in terms],
                        "extraction": projected["extraction"],
                    }
                )
            except (ValueError, UnicodeError, OSError, urllib.error.URLError) as error:
                outcomes.append(
                    {
                        **record,
                        "status": "pending-source-review",
                        "reason": type(error).__name__ + ": " + str(error)[:400],
                    }
                )
        report = {
            "version": 1,
            "selectionSha256": hashlib.sha256(raw_selection).hexdigest(),
            "robotsSha256": hashlib.sha256(robot_raw).hexdigest(),
            "selectedArticles": len(candidates),
            "counts": dict(counts),
            "articles": outcomes,
            "boundaries": "Original full article sections, not abstracts. Author-specific dates and frames retained. Proposed headings/definition clauses are not reviewed canonical concepts. No clinical scoring, Wikipedia, private input, model or release.",
        }
        (staged / "collection-report.json").write_text(encoded(report) + "\n", encoding="utf-8")
        (staged / "ATTRIBUTION.md").write_text(
            "# Specialist article extracts\n\n"
            "Each records file preserves the article authors, journal, original page, DOI, publication date, "
            "exact article-specific Creative Commons license and declared copyright. "
            "CC BY-NC-SA sources are noncommercial and share-alike; this is a local development research collection, "
            "not clearance for commercial distribution or third-party proprietary instruments.\n\n"
            "Changes: extraction of article-only DOM fragments, HTML-to-text formatting, whitespace normalization, "
            "list markers, physical table geometry and source-local indexing proposals. "
            "No medical rewriting, translation, modernized consensus, approved scoring or endorsement by authors. "
            "Evidence files are authoring/replay material and are never phone-download inputs.\n",
            encoding="utf-8",
        )
        if not counts["articles"]:
            raise ValueError("No selected full-text article could be prepared")
        os.rename(staged, output)
    return report


def replay(collection: Path) -> dict[str, object]:
    report = obj(json.loads((collection / "collection-report.json").read_bytes()))
    compared = 0
    blocks = 0
    for value in seq(report.get("articles"), 24):
        row = obj(value)
        if row.get("status") != "prepared-requires-review":
            continue
        paths = []
        for field in ("evidence", "prepared"):
            path = (collection / text(row.get(field))).resolve(strict=True)
            if not path.is_relative_to(collection.resolve()) or not path.is_file():
                raise ValueError("Evidence path escapes its collection")
            paths.append(path)
        evidence, prepared = paths
        if hashlib.sha256(evidence.read_bytes()).hexdigest() != row.get(
            "evidenceSha256"
        ) or hashlib.sha256(prepared.read_bytes()).hexdigest() != row.get("preparedSha256"):
            raise ValueError("Collected source receipt changed")
        with gzip.open(evidence, "rb") as stream:
            raw = stream.read(MAX_PAGE_BYTES + 1)
        if len(raw) > MAX_PAGE_BYTES:
            raise ValueError("Archived source expansion exceeds budget")
        payload = project_article(json.loads(raw))
        if encoded(payload).encode() != prepared.read_bytes():
            raise ValueError("Original article replay differs from prepared records")
        compared += 1
        blocks += len(seq(payload["blocks"], 1000))
    return {
        "articlesReplayed": compared,
        "sourceBlocksReplayed": blocks,
        "networkRequests": 0,
        "exactPreparedReplay": True,
        "scope": "Deterministic source fidelity, not clinical review.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--replay", action="store_true")
    args = parser.parse_args()
    if args.replay:
        result = replay(args.output)
    else:
        if args.selection is None:
            parser.error("--selection is required for explicit acquisition")
        result = collect(args.selection, args.output)
    print(encoded(result))


if __name__ == "__main__":
    main()
