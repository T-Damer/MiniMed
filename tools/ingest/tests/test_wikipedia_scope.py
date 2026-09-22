from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

from localmed_ingest.wikipedia_definitions import (
    Snapshot,
    encoded,
    exclusion,
    obj,
    project_page,
    sha,
    source_descriptor,
)
from localmed_ingest.wikipedia_scope import intake, select_paths


def selection() -> dict[str, object]:
    return {"seeds": [{"category": "Категория:Медицина", "family": "medicine", "depth": 2}]}


def policy() -> dict[str, object]:
    return {"version": 1, "excludedCategoryPatterns": ["геральдика"], "excludedPageTitles": []}


def member(page_id: int, title: str, namespace: int = 0) -> dict[str, object]:
    return {"pageid": page_id, "ns": namespace, "title": title}


def categories() -> dict[str, list[object]]:
    return {
        "Категория:Медицина": [
            member(1, "Медицинский термин"),
            member(90, "Категория:Геральдика", 14),
        ],
        "Категория:Геральдика": [member(2, "Герб Example")],
    }


def test_cultural_descendants_are_not_medical_terms() -> None:
    candidates, report = select_paths(categories(), selection(), policy())
    assert set(candidates) == {1}
    assert report["excludedCategories"] == ["Категория:Геральдика"]
    assert report["networkRequests"] == 0


def test_allowed_alternate_path_preserves_a_medical_record() -> None:
    graph = categories()
    graph["Категория:Медицина"].append(member(91, "Категория:Диагностика", 14))
    graph["Категория:Диагностика"] = [member(2, "Герб Example")]
    candidates, _ = select_paths(graph, selection(), policy())
    assert set(candidates) == {1, 2}
    assert candidates[2]["categories"] == ["Категория:Диагностика"]


def test_unfetched_branches_are_reported_instead_of_invented() -> None:
    graph = categories()
    graph["Категория:Медицина"].append(member(92, "Категория:Не загружено", 14))
    _, report = select_paths(graph, selection(), policy())
    assert report["unfetchedCategories"] == ["Категория:Не загружено"]


def test_category_cycles_stay_bounded() -> None:
    graph = categories()
    graph["Категория:Медицина"].append(member(93, "Категория:Медицина", 14))
    candidates, _ = select_paths(graph, selection(), policy())
    assert set(candidates) == {1}


def test_author_birth_date_does_not_turn_a_syndrome_into_a_person() -> None:
    page = {
        "pageid": 3, "ns": 0, "title": "Синдром Example",
        "extract": (
            "Синдром Example — условный учебный пример. Назван по фамилии автора "
            "(1 января 1900 — 2 февраля 1980); это не биографическая статья."
        ),
    }
    assert exclusion(page) is None
    page["title"] = "Иванов, Иван Иванович"
    assert exclusion(page) == "possible-person-separate-history-queue"


def prepared(root: Path) -> tuple[Path, Path, Path]:
    collection = root / "collection"
    collection.mkdir()
    select = root / "selection.json"
    scope = root / "scope.json"
    select.write_bytes(encoded(selection()))
    scope.write_bytes(encoded(policy()))
    records: list[dict[str, object]] = []
    for title, members in categories().items():
        response = encoded({"query": {"categorymembers": members}})
        records.append({
            "parameters": {"list": "categorymembers", "cmtitle": title},
            "response": response.decode(), "responseSha256": sha(response),
            "retrievedAt": "2026-09-22T00:00:00Z",
        })
    pages = [
        {**member(1, "Медицинский термин"), "extract": "Точное исходное медицинское описание.\nВторой абзац."},
        {**member(2, "Герб Example"), "extract": "Исходное описание герба, не медицинское определение."},
    ]
    response = encoded({"query": {"pages": pages}})
    snapshot = Snapshot({}, sha(response), "2026-09-22T00:00:00Z")
    records.append({
        "parameters": {"prop": "extracts"}, "response": response.decode(),
        "responseSha256": sha(response), "retrievedAt": snapshot.retrieved_at,
    })
    blocks: list[dict[str, object]] = []
    terms: list[dict[str, object]] = []
    for page in pages:
        candidate = {
            "pageid": page["pageid"], "families": ["medicine"],
            "categories": ["Категория:Медицина"],
        }
        block, term = project_page(page, candidate, snapshot)
        blocks.append(block)
        terms.append(term)
    payload = encoded({
        "version": 3, "reviewStatus": "requires-review", "publicationState": "local-dev",
        "textKind": "source-excerpt", "sources": [source_descriptor("2026-09-22")],
        "terms": terms, "blocks": blocks,
    })
    (collection / "part-001.json").write_bytes(payload)
    archive = gzip.compress(b"".join(encoded(row) + b"\n" for row in records), mtime=0)
    (collection / "api-snapshots.jsonl.gz").write_bytes(archive)
    (collection / "manifest.json").write_bytes(encoded({
        "version": 1, "sourceFamily": "ruwiki-medical-introductions", "date": "2026-09-22",
        "entries": 2, "configSha256": sha(select.read_bytes()),
        "parts": [{"path": "part-001.json", "bytes": len(payload), "sha256": sha(payload), "entries": 2}],
        "snapshotArchive": {"path": "api-snapshots.jsonl.gz", "bytes": len(archive), "sha256": sha(archive)},
    }))
    return collection, select, scope


def test_intake_keeps_exact_text_and_quarantines_without_erasing_raw_input(tmp_path: Path) -> None:
    collection, selection_path, policy_path = prepared(tmp_path)
    original = (collection / "part-001.json").read_bytes()
    report = intake(collection, selection_path, policy_path)
    assert report["admittedDescriptions"] == 1
    assert report["quarantinedAcquiredDescriptions"] == 1
    assert report["sourceTextExact"] is True
    assert (collection / "part-001.json").read_bytes() == original
    admitted = obj(json.loads((collection / "admitted-001.json").read_bytes()))
    assert 'Точное исходное медицинское описание.' in encoded(admitted).decode()
    assert 'Герб Example' not in encoded(admitted).decode()
    before = (collection / "manifest.json").read_bytes()
    with pytest.raises(ValueError, match="already"):
        intake(collection, selection_path, policy_path)
    assert (collection / "manifest.json").read_bytes() == before


@pytest.mark.parametrize("target", ["api-snapshots.jsonl.gz", "part-001.json"])
def test_changed_source_receipts_are_rejected(tmp_path: Path, target: str) -> None:
    collection, selection_path, policy_path = prepared(tmp_path)
    path = collection / target
    path.write_bytes(path.read_bytes() + b" ")
    with pytest.raises(ValueError, match="changed|mismatch"):
        intake(collection, selection_path, policy_path)
    assert not (collection / "admitted-001.json").exists()
