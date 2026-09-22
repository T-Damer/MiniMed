"""Discover teaching/review articles from original medical journal issue contents.

Discovery is a candidate queue, not medical or redistribution approval. The existing
full-text collector still checks article identity, language, license and source structure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.robotparser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from .definition_reference_pack import encoded, obj, seq, text
from .definition_source_manifest import read_source_manifest
from .specialist_journal_collect import USER_AGENT, read_original
from .specialist_journal_reference import HOST, MAX_PAGE_BYTES

JOURNALS = ("RFD", "pediatr", "uroved", "1027-4898")
TEACHING = re.compile(
    r"лекци|обзор|клиническ.{0,30}рекомендаци|в помощь|практическ.{0,20}врач|"
    r"lecture|review|clinical.{0,20}guideline|continuing medical",
    re.I,
)
EXCLUDED = re.compile(
    r"некролог|юбиле|поздравлен|к памяти|рецензи|редакционн|реклам|"
    r"сравнительн.{0,30}эффективност|randomi[sz]ed|obituar|anniversary|editorial",
    re.I,
)
FOCUS = re.compile(
    r"синдром|симптом|семиотик|термин|определени|классификац|критери|"
    r"дифференциальн|диагност|патогенез|syndrome|classification|diagnos|criteria",
    re.I,
)


def _html(raw: bytes) -> BeautifulSoup:
    if len(raw) > MAX_PAGE_BYTES or b"\0" in raw:
        raise ValueError("Invalid publisher contents response")
    return BeautifulSoup(raw.decode("utf-8"), "html.parser")


def publisher_path(href: str, journal: str, kind: str) -> str | None:
    if journal not in JOURNALS or kind not in {"issue", "article"}:
        raise ValueError("Undeclared journal or resource kind")
    value = urlsplit(urljoin(HOST + "/" + journal + "/", href))
    match = re.fullmatch(
        rf"/{re.escape(journal)}/{kind}/view/([1-9]\d{{0,11}})(?:/(?:ru_RU|en_US))?/?",
        value.path,
        re.I,
    )
    if (
        value.scheme != "https"
        or value.netloc != "journals.eco-vector.com"
        or value.query
        or value.fragment
        or not match
    ):
        return None
    return match[1]


def issue_links(raw: bytes, journal: str) -> list[str]:
    result: list[str] = []
    for link in _html(raw).find_all("a", href=True):
        href = link.get("href")
        if isinstance(href, str):
            issue = publisher_path(href, journal, "issue")
            if issue and issue not in result:
                result.append(issue)
    return result


def teaching_articles(raw: bytes, journal: str, issue: str) -> list[dict[str, object]]:
    section = ""
    selected: dict[str, dict[str, object]] = {}
    for node in _html(raw).find_all(["h2", "h3", "h4", "a"]):
        if node.name == "h2":
            section = node.get_text(" ", strip=True)
            continue
        if node.name != "a":
            continue
        href = node.get("href")
        aid = publisher_path(href, journal, "article") if isinstance(href, str) else None
        title = node.get_text(" ", strip=True)
        if (
            not aid
            or aid in selected
            or not 8 <= len(title) <= 600
            or EXCLUDED.search(title)
            or not re.search(r"[А-Яа-яЁёA-Za-z]", title)
        ):
            continue
        # Only actual title links in declared teaching/review sections are candidates.
        if not TEACHING.search(section) and not re.search(r"лекци|lecture", title, re.I):
            continue
        selected[aid] = {
            "journal": journal,
            "articleId": aid,
            "title": title,
            "focus": "Publisher teaching/review section; content and reuse admission pending",
            "discovery": {
                "issueUrl": f"{HOST}/{journal}/issue/view/{issue}/ru_RU",
                "section": section,
                "issueResponseSha256": hashlib.sha256(raw).hexdigest(),
            },
        }
    return list(selected.values())


def discover(
    root: Path, output: Path, issues_per_journal: int = 12, articles_per_journal: int = 18
) -> dict[str, object]:
    if output.exists() or not 1 <= issues_per_journal <= 16 or not 1 <= articles_per_journal <= 24:
        raise ValueError("Use a new bounded discovery directory")
    inputs, _ = read_source_manifest(root, root / "content/definition-drafts/source-inputs.json")
    existing: set[tuple[str, str]] = set()
    for path in inputs:
        payload = obj(json.loads(path.read_bytes()))
        for value in seq(payload.get("sources"), 1000):
            source = obj(value)
            if source.get("sourceType") != "specialist-journal":
                continue
            url = text(source.get("sourceUrl"))
            for journal in JOURNALS:
                aid = publisher_path(url, journal, "article")
                if aid:
                    existing.add((journal.lower(), aid))
    robots_raw = read_original(HOST + "/robots.txt")
    robots = urllib.robotparser.RobotFileParser()
    robots.parse(robots_raw.decode("utf-8").splitlines())
    output.mkdir(parents=True)
    (output / "robots.txt").write_bytes(robots_raw)
    outcomes: list[dict[str, object]] = []
    candidates: list[dict[str, object]] = []
    excluded_existing = 0

    def fetch(url: str) -> bytes:
        if not robots.can_fetch(USER_AGENT, url):
            raise ValueError("Source robots policy does not allow this contents URL")
        delay = int(robots.crawl_delay(USER_AGENT) or 0)
        if delay > 60:
            raise ValueError("Source crawl delay exceeds this bounded acquisition window")
        time.sleep(max(1.5, delay))
        return read_original(url)

    for journal in JOURNALS:
        try:
            archive = fetch(f"{HOST}/{journal}/issue/archive")
        except (ValueError, UnicodeError, OSError, urllib.error.URLError) as error:
            outcomes.append(
                {
                    "journal": journal,
                    "status": "archive-pending",
                    "reason": type(error).__name__ + ": " + str(error)[:200],
                }
            )
            continue
        issues = issue_links(archive, journal)
        pool: dict[str, dict[str, object]] = {}
        for issue in issues[:issues_per_journal]:
            try:
                raw = fetch(f"{HOST}/{journal}/issue/view/{issue}/ru_RU")
                found = teaching_articles(raw, journal, issue)
                for row in found:
                    aid = text(row["articleId"])
                    if (journal.lower(), aid) in existing:
                        excluded_existing += 1
                    else:
                        pool.setdefault(aid, row)
                outcomes.append(
                    {
                        "journal": journal,
                        "issue": issue,
                        "status": "indexed",
                        "candidates": len(found),
                        "responseSha256": hashlib.sha256(raw).hexdigest(),
                    }
                )
            except (ValueError, UnicodeError, OSError, urllib.error.URLError) as error:
                outcomes.append(
                    {
                        "journal": journal,
                        "issue": issue,
                        "status": "issue-pending",
                        "reason": type(error).__name__ + ": " + str(error)[:200],
                    }
                )
        ordered = sorted(
            pool.values(),
            key=lambda row: (
                not bool(FOCUS.search(text(row["title"]))),
                text(row["articleId"]),
            ),
        )
        candidates.extend(ordered[:articles_per_journal])
    selections: list[str] = []
    for start in range(0, len(candidates), 24):
        name = f"selection-{start // 24 + 1:02d}.json"
        (output / name).write_text(
            encoded(
                {
                    "version": 1,
                    "sourcePolicy": "specialist-medical-sources-2026-09-22",
                    "articles": candidates[start : start + 24],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        selections.append(name)
    report = {
        "version": 1,
        "journals": list(JOURNALS),
        "issuesPerJournalLimit": issues_per_journal,
        "articlesPerJournalLimit": articles_per_journal,
        "selectedCandidates": len(candidates),
        "alreadyActiveObservationsSkipped": excluded_existing,
        "robotsSha256": hashlib.sha256(robots_raw).hexdigest(),
        "selections": selections,
        "issues": outcomes,
        "boundary": "Candidate discovery only; no clinical or reuse approval.",
    }
    (output / "discovery-report.json").write_text(encoded(report) + "\n", encoding="utf-8")
    if not candidates:
        raise ValueError("No teaching candidates found; discovery report retained for inspection")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = discover(args.root, args.output)
    print(encoded({key: value for key, value in result.items() if key != "issues"}))


if __name__ == "__main__":
    main()
