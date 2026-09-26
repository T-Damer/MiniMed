"""Collect Russian medical reference descriptions; never infer clinical rules or translations.

The TextExtracts response is the source snapshot. Revision metadata is recorded but is NOT
claimed to cryptographically identify the cached extract. Raw API snapshots stay in the
separate authoring cache; only compact, source-linked V3 shards enter the app's input manifest.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import time
import unicodedata
from collections import Counter, deque
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

API = "https://ru.wikipedia.org/w/api.php"
USER_AGENT = (
    "MiniMedTermCollector/0.1 (https://github.com/T-Damer/MiniMed"
    "; source-linked reference research)"
)
MAX_RESPONSE = 16 * 1024 * 1024
MAX_EXTRACT = 65536
OMIT_CATEGORY = re.compile(
    (
        "персоналии|родившиеся|умершие|учёные|ученые|врачи|физиологи|"
        "анатомы|психиатры|организации|учреждения|университеты|инстит"
        "уты|больницы|клиники|журналы|премии|история |истории |лауреа"
        "ты|фильмы|романы|по странам|по городам"
    ),
    re.I,
)
ETYMOLOGY = re.compile(r"(?:др\.-греч\.|греч\.|лат\.|нем\.|англ\.)", re.I)


def encoded(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def obj(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or any(
        not isinstance(k, str) for k in cast(dict[object, object], value)
    ):
        raise ValueError("Expected a JSON object")
    return cast(dict[str, object], value)


def items(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("Expected a JSON list")
    return cast(list[object], value)


def text(value: object, limit: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip() or "\0" in value or len(value) > limit:
        raise ValueError("Invalid source text")
    return value


def integer(value: object, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError("Invalid source integer")
    return value


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).lower().replace("ё", "е").split())


@dataclass(frozen=True)
class Snapshot:
    data: dict[str, object]
    response_sha256: str
    retrieved_at: str


class WikiApi:
    def __init__(self, cache: Path, *, offline: bool = False) -> None:
        self.cache = cache
        self.cache.mkdir(parents=True, exist_ok=True)
        self.offline = offline
        self.last_request = 0.0
        self.requests = 0

    def get(self, values: dict[str, str]) -> Snapshot:
        params = {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "maxlag": "5",
            **values,
        }
        key = sha(encoded(params))
        path = self.cache / f"{key}.json"
        if path.exists():
            saved = obj(json.loads(path.read_bytes()))
            raw = text(saved["response"], MAX_RESPONSE).encode()
            if saved["parameters"] != params or sha(raw) != saved["responseSha256"]:
                raise ValueError("Cached source receipt mismatch")
            return Snapshot(obj(json.loads(raw)), sha(raw), text(saved["retrievedAt"]))
        if self.offline:
            raise ValueError("Missing requested source snapshot in offline mode")
        for attempt in range(4):
            time.sleep(max(0.0, 1.0 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            self.requests += 1
            request = Request(
                API + "?" + urlencode(params),
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            try:
                with urlopen(request, timeout=40) as response:
                    raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise ValueError("Source response exceeds the collection budget")
                data = obj(json.loads(raw))
                if "error" in data:
                    error = obj(data["error"])
                    if error.get("code") == "maxlag" and attempt < 3:
                        time.sleep(5 * (attempt + 1))
                        continue
                    raise ValueError("Source API error: " + str(error.get("code")))
                retrieved = datetime.now(UTC).isoformat()
                saved = {
                    "parameters": params,
                    "response": raw.decode(),
                    "responseSha256": sha(raw),
                    "retrievedAt": retrieved,
                }
                path.write_bytes(encoded(saved))
                return Snapshot(data, sha(raw), retrieved)
            except HTTPError as error:
                if error.code not in {429, 502, 503, 504} or attempt == 3:
                    raise
                delay = min(120.0, max(5.0, float(error.headers.get("Retry-After", "10"))))
                time.sleep(delay)
        raise ValueError("Source API retry budget exhausted")


def discover(
    api: WikiApi, config: dict[str, object]
) -> tuple[dict[int, dict[str, object]], list[dict[str, object]]]:
    max_categories = integer(config["maxCategories"], 1)
    max_pages = integer(config["maxPages"], 1)
    if max_categories > 1000 or max_pages > 15000:
        raise ValueError("Collection exceeds bounded category/page policy")
    seeds = items(config["seeds"])
    if not seeds or len(seeds) > 40:
        raise ValueError("Use 1..40 explicit medical category seeds")
    candidates: dict[int, dict[str, object]] = {}
    visited: set[str] = set()
    ledger: list[dict[str, object]] = []
    queue: deque[tuple[str, int, int, str]] = deque()
    for value in seeds:
        seed = obj(value)
        depth = integer(seed["depth"])
        category = text(seed["category"])
        if not category.startswith("Категория:") or depth > 4:
            raise ValueError("Invalid category seed")
        queue.append((category, 0, depth, text(seed["family"], 64)))
    while queue and len(visited) < max_categories and len(candidates) < max_pages:
        category, depth, maximum, family = queue.popleft()
        if category in visited:
            continue
        visited.add(category)
        continuation: dict[str, str] = {}
        seen_cursors: set[str] = set()
        record: dict[str, object] = {
            "category": category,
            "family": family,
            "depth": depth,
            "requests": [],
            "members": 0,
            "complete": True,
        }
        receipts = cast(list[object], record["requests"])
        members_seen = 0
        while True:
            snapshot = api.get(
                {
                    "list": "categorymembers",
                    "cmtitle": category,
                    "cmtype": "page|subcat",
                    "cmlimit": "500",
                    **continuation,
                }
            )
            receipts.append(snapshot.response_sha256)
            rows = items(obj(snapshot.data["query"])["categorymembers"])
            members_seen += len(rows)
            for raw in rows:
                member = obj(raw)
                title = text(member["title"])
                namespace = integer(member["ns"])
                if namespace == 14:
                    if depth < maximum and not OMIT_CATEGORY.search(title):
                        queue.append((title, depth + 1, maximum, family))
                elif namespace == 0:
                    page_id = integer(member["pageid"], 1)
                    if page_id not in candidates and len(candidates) >= max_pages:
                        record["complete"] = False
                        continue
                    row = candidates.setdefault(
                        page_id,
                        {"pageid": page_id, "title": title, "families": [], "categories": []},
                    )
                    for key, value in (("families", family), ("categories", category)):
                        target = cast(list[str], row[key])
                        if value not in target:
                            target.append(value)
            more = snapshot.data.get("continue")
            if more is None:
                break
            if len(candidates) >= max_pages:
                record["complete"] = False
                break
            parsed = obj(more)
            continuation = {key: text(value) for key, value in parsed.items()}
            cursor = encoded(continuation).decode()
            if cursor in seen_cursors:
                raise ValueError("Source category cursor repeated")
            seen_cursors.add(cursor)
        record["members"] = members_seen
        ledger.append(record)
    if queue:
        ledger.append(
            {
                "remainingQueuedCategories": len(queue),
                "reason": "configured-category-or-page-budget",
                "complete": False,
            }
        )
    return candidates, ledger


def exclusion(page: dict[str, object]) -> str | None:
    if page.get("missing") is not None or page.get("invalid") is not None:
        return "missing-page"
    if page.get("ns") != 0:
        return "non-article"
    if "disambiguation" in obj(page.get("pageprops", {})):
        return "disambiguation"
    title = text(page.get("title"))
    if re.match(r"^(?:Список|Списки|История |Категория:|Википедия:|Портал:)", title):
        return "list-or-history-not-definition"
    extract = page.get("extract")
    if not isinstance(extract, str) or len(extract.strip()) < 30:
        return "missing-or-short-introduction"
    if len(extract) > MAX_EXTRACT or "\0" in extract:
        return "oversized-or-invalid-introduction"
    if not re.search(r"[А-Яа-яЁё]", extract):
        return "no-russian-source-text"
    if re.search(r"\{\||\{\{|\[\[", extract):
        return "unrendered-source-markup"
    if re.match(r"^[А-ЯЁ][^,]{1,60},\s*[А-ЯЁ]", title):
        return "possible-person-separate-history-queue"
    return None


def classify(title: str, families: list[str]) -> str:
    lowered = title.lower()
    if re.search(r"\b(?:шкал[а-я]*|опросник[а-я]*|тест(?:ы|а|ов|ирование)?)(?=\s|$)", lowered):
        return "scale" if "шкал" in lowered or "опросник" in lowered else "tool"
    if "синдром" in lowered:
        return "syndrome"
    if "классификац" in lowered:
        return "classification"
    if lowered.startswith("закон "):
        return "law"
    if "symptoms" in families and not any(f in families for f in ("anatomy", "physiology")):
        return "symptom"
    return "term"


def project_page(
    page: dict[str, object], candidate: dict[str, object], snapshot: Snapshot
) -> tuple[dict[str, object], dict[str, object]]:
    reason = exclusion(page)
    if reason is not None:
        raise ValueError(reason)
    page_id = integer(page["pageid"], 1)
    if page_id != candidate["pageid"]:
        raise ValueError("Response page does not match selected category member")
    title = text(page["title"])
    body = text(page["extract"], MAX_EXTRACT)
    revisions = items(page.get("revisions", []))
    revision = obj(revisions[0]) if revisions else {}
    families = [text(value, 64) for value in items(candidate["families"])]
    path = quote(title.replace(" ", "_"), safe="")
    block: dict[str, object] = {
        "id": page_id,
        "source": 1,
        "text": body,
        "textSha256": sha(body.encode()),
        "path": path,
        "locator": f"TextExtracts intro; pageid={page_id}; snapshot={snapshot.response_sha256}",
        "pageId": page_id,
        "observedRevisionId": revision.get("revid"),
        "observedRevisionTimestamp": revision.get("timestamp"),
        "retrievedAt": snapshot.retrieved_at,
        "apiResponseSha256": snapshot.response_sha256,
        "sourcePageRecordSha256": sha(encoded(page)),
        "revisionBinding": "retrieval-snapshot-not-pinned-revision",
        "historyUrl": "https://ru.wikipedia.org/w/index.php?title=" + path + "&action=history",
        "discoveryCategories": candidate["categories"],
        "families": families,
    }
    term: dict[str, object] = {
        "id": f"ruwiki.definition.{page_id}",
        "title": title,
        "kind": classify(title, families),
        "aliases": [],
        "coverage": "source-description",
        "blockIds": [page_id],
    }
    return block, term


def source_descriptor(date: str) -> dict[str, object]:
    return {
        "id": 1,
        "title": "Русская Википедия — медицинские и смежные определения",
        "baseUrl": "https://ru.wikipedia.org/wiki/",
        "sourceType": "wikipedia-api-introductions",
        "authority": "third-party",
        "accessed": date,
        "releaseEligible": False,
        "license": "CC-BY-SA-4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "attribution": (
            "Авторы соответствующих статей русской Википедии; индивидуаль"
            "ные страницы и история авторства указаны в блоках."
        ),
        "changes": (
            "Category selection and projection of complete API-provided p"
            "lain-text introductions. No model rewriting, translation, in"
            "vented aliases, scoring or harmonization."
        ),
        "sourceUrl": API,
        "sourceLimitations": (
            "Community encyclopedia, not clinical guidance. Plain-text AP"
            "I introductions omit media/tables and may differ from curren"
            "t article revisions. Exact retrieval snapshots are retained "
            "separately."
        ),
    }


def collect(
    config_path: Path, destination: Path, cache: Path, *, offline: bool = False
) -> dict[str, object]:
    if destination.exists():
        raise ValueError("Choose a new collection destination; source snapshots are immutable")
    config_raw = config_path.read_bytes()
    config = obj(json.loads(config_raw))
    if config.get("schemaVersion") != 1:
        raise ValueError("Unsupported source selection config")
    date = text(config["date"], 10)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise ValueError("Invalid collection date")
    api = WikiApi(cache, offline=offline)
    candidates, category_ledger = discover(api, config)
    selected = sorted(candidates)
    blocks: list[dict[str, object]] = []
    terms: list[dict[str, object]] = []
    rejected: list[dict[str, object]] = []
    request_warnings: list[object] = []
    for start in range(0, len(selected), 20):
        batch = selected[start : start + 20]
        snapshot = api.get(
            {
                "pageids": "|".join(map(str, batch)),
                "prop": "extracts|revisions|pageprops",
                "exintro": "1",
                "explaintext": "1",
                "exlimit": "20",
                "rvprop": "ids|timestamp",
                "ppprop": "disambiguation",
            }
        )
        if "continue" in snapshot.data:
            raise ValueError(
                "Unexpected incomplete extract batch; do not silently drop source pages"
            )
        if "warnings" in snapshot.data:
            request_warnings.append(snapshot.data["warnings"])
        returned: set[int] = set()
        for raw in items(obj(snapshot.data["query"])["pages"]):
            page = obj(raw)
            page_id = integer(page["pageid"], 1)
            if page_id not in batch or page_id in returned:
                raise ValueError("Unexpected/duplicate page in source response")
            returned.add(page_id)
            reason = exclusion(page)
            if reason is not None:
                rejected.append(
                    {
                        "pageid": page_id,
                        "title": page.get("title"),
                        "reason": reason,
                        "snapshot": snapshot.response_sha256,
                    }
                )
                continue
            block, term = project_page(page, candidates[page_id], snapshot)
            blocks.append(block)
            terms.append(term)
        for page_id in set(batch) - returned:
            rejected.append({"pageid": page_id, "reason": "not-returned-by-source"})
        if start % 200 == 0:
            print(
                json.dumps(
                    {
                        "requested": min(start + 20, len(selected)),
                        "admitted": len(terms),
                        "rejected": len(rejected),
                    }
                ),
                flush=True,
            )
    if not terms:
        raise ValueError("No source descriptions were admitted")
    destination.mkdir(parents=True)
    shard_receipts: list[dict[str, object]] = []
    for start in range(0, len(terms), 500):
        name = f"part-{start // 500 + 1:03d}.json"
        payload = {
            "version": 3,
            "id": "ruwiki.medical.introductions",
            "reviewStatus": "requires-review",
            "publicationState": "local-dev",
            "textKind": "source-excerpt",
            "sources": [source_descriptor(date)],
            "blocks": blocks[start : start + 500],
            "terms": terms[start : start + 500],
        }
        raw = encoded(payload)
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("Source shard exceeds the application input budget")
        (destination / name).write_bytes(raw)
        shard_receipts.append(
            {
                "path": name,
                "sha256": sha(raw),
                "bytes": len(raw),
                "entries": len(terms[start : start + 500]),
            }
        )
    # Raw snapshots are authoring evidence only; the runtime manifest never points to this archive.
    archive = destination / "api-snapshots.jsonl.gz"
    with (
        archive.open("xb") as output,
        gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as compressed,
    ):
        for path in sorted(cache.glob("*.json")):
            compressed.write(path.read_bytes() + b"\n")
    manifest = {
        "version": 1,
        "sourceFamily": "ruwiki-medical-introductions",
        "date": date,
        "entries": len(terms),
        "parts": shard_receipts,
        "configSha256": sha(config_raw),
        "snapshotArchive": {
            "path": archive.name,
            "sha256": sha(archive.read_bytes()),
            "bytes": archive.stat().st_size,
        },
    }
    (destination / "manifest.json").write_bytes(encoded(manifest))
    report = {
        "schemaVersion": 1,
        "configSha256": sha(config_raw),
        "selectedPages": len(selected),
        "records": len(terms),
        "distinctTitles": len({t["title"] for t in terms}),
        "newNetworkRequests": api.requests,
        "sourceFamilies": dict(
            Counter(f for block in blocks for f in cast(list[str], block["families"]))
        ),
        "kinds": dict(Counter(str(term["kind"]) for term in terms)),
        "introductionsWithLanguageMarkers": sum(
            bool(ETYMOLOGY.search(str(b["text"]))) for b in blocks
        ),
        "rejectedCounts": dict(Counter(str(row["reason"]) for row in rejected)),
        "rejected": rejected,
        "categoryTraversal": category_ledger,
        "warnings": request_warnings,
        "jsonBytes": sum(integer(part["bytes"]) for part in shard_receipts),
        "boundaries": (
            "Complete returned plain-text introductions for this bounded "
            "category traversal, not all Wikipedia/medicine. Source-local"
            " records and proposed kinds, not disjoint reviewed concepts,"
            " verified etymologies or executable scales. No rewritten or "
            "truncated definitions. Revision metadata is observational; c"
            "ached extracts are bound to archived response snapshots."
        ),
    }
    (destination / "collection-report.json").write_bytes(encoded(report))
    (destination / "ATTRIBUTION.md").write_text(
        (
            "# Russian Wikipedia source introductions\n\nText: contributors"
            " to the individual Russian Wikipedia articles linked by each"
            " block. Page histories credit the authors. Text is reused un"
            "der CC BY-SA-4.0: https://creativecommons.org/licenses/by-sa"
            "/4.0/ .\n\nChanges: category selection, MediaWiki plain-text i"
            "ntroduction extraction, and V3 projection only. No translati"
            "on, model rewriting, scoring or clinical review. Individual "
            "source wording and language-origin notes are not harmonized "
            "with clinical guidelines or textbooks.\n\n`api-snapshots.jsonl"
            ".gz` is reproducible authoring evidence, not an app download"
            " dependency. The response SHA-256 and page-record SHA-256 id"
            "entify retrieved text; an observed latest revision does not "
            "prove the cached extract is from that revision. The full art"
            "icle, media and tables are not represented by these introduc"
            "tion cards.\n"
        ),
        encoding="utf-8",
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    report = collect(args.config, args.output, args.cache, offline=args.offline)
    print(
        json.dumps(
            {
                key: report[key]
                for key in ("records", "distinctTitles", "kinds", "rejectedCounts", "jsonBytes")
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
