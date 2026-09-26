from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_pack import Projection
from localmed_ingest.definition_source_manifest import read_source_manifest, write_source_manifest
from localmed_ingest.wikipedia_definitions import (
    Snapshot,
    WikiApi,
    classify,
    discover,
    encoded,
    exclusion,
    items,
    obj,
    project_page,
    sha,
    source_descriptor,
)

BODY = "Тестовое понятие (греч. παράδειγμα) — учебное описание.\n\nПолный второй абзац с оговоркой."


def page() -> dict[str, object]:
    return {
        "pageid": 12,
        "ns": 0,
        "title": "Тестовое понятие",
        "extract": BODY,
        "revisions": [{"revid": 34, "timestamp": "2026-09-20T00:00:00Z"}],
    }


def candidate() -> dict[str, object]:
    return {
        "pageid": 12,
        "title": "Тестовое понятие",
        "families": ["general-medicine"],
        "categories": ["Категория:Медицинская терминология"],
    }


def snapshot() -> Snapshot:
    return Snapshot({}, "a" * 64, "2026-09-22T00:00:00Z")


def payload() -> dict[str, object]:
    block, term = project_page(page(), candidate(), snapshot())
    return {
        "version": 3,
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "textKind": "source-excerpt",
        "sources": [source_descriptor("2026-09-22")],
        "blocks": [block],
        "terms": [term],
    }


def test_complete_source_text_and_observational_revision_are_preserved() -> None:
    block, term = project_page(page(), candidate(), snapshot())
    assert block["text"] == BODY
    assert block["textSha256"] == sha(BODY.encode())
    assert block["observedRevisionId"] == 34
    assert block["revisionBinding"] == "retrieval-snapshot-not-pinned-revision"
    assert term["aliases"] == []
    assert term["coverage"] == "source-description"
    assert term["id"] == "ruwiki.definition.12"


def test_real_projection_accepts_the_new_source_without_approval() -> None:
    value = payload()
    projection = Projection()
    projection.add(value, sha(encoded(value)))
    assert len(projection.entries) == 1
    assert len(projection.sources) == 1
    assert next(iter(projection.chunks.values()))[1].original_text == BODY


@pytest.mark.parametrize(
    ("key", "value", "reason"),
    [
        ("missing", True, "missing-page"),
        ("ns", 14, "non-article"),
        ("pageprops", {"disambiguation": ""}, "disambiguation"),
        ("title", "Список синдромов", "list-or-history-not-definition"),
        ("extract", "", "missing-or-short-introduction"),
        ("extract", "x" * 65537, "oversized-or-invalid-introduction"),
        ("extract", "English only text without a Russian definition.", "no-russian-source-text"),
        (
            "extract",
            "{{Template}} Неразобранный исходный текст вместо определения.",
            "unrendered-source-markup",
        ),
        ("title", "Иванов, Иван Иванович", "possible-person-separate-history-queue"),
    ],
)
def test_invalid_or_other_content_is_queued_not_fabricated(
    key: str, value: object, reason: str
) -> None:
    row = page()
    row[key] = value
    assert exclusion(row) == reason
    with pytest.raises(ValueError, match=reason):
        project_page(row, candidate(), snapshot())


def test_wrong_page_membership_is_rejected() -> None:
    row = candidate()
    row["pageid"] = 999
    with pytest.raises(ValueError, match="selected category"):
        project_page(page(), row, snapshot())


def test_proposed_instrument_kind_does_not_create_executable_content() -> None:
    assert classify("Шкала комы Глазго", ["scales"]) == "scale"
    assert classify("Опросник Example", ["scales"]) == "scale"
    assert classify("Тестостерон", ["physiology"]) == "term"
    row = page()
    row["title"] = "Шкала Example"
    _, term = project_page(row, candidate(), snapshot())
    assert term["coverage"] == "source-description"
    assert "scoring" not in term
    assert "items" not in term


class CategoryApi(WikiApi):
    def __init__(self) -> None:
        self.requested: list[str] = []

    def get(self, values: dict[str, str]) -> Snapshot:
        category = values["cmtitle"]
        self.requested.append(category)
        if category == "Категория:Медицина" and "cmcontinue" not in values:
            response: dict[str, object] = {
                "query": {
                    "categorymembers": [
                        {"pageid": 12, "ns": 0, "title": "Первое понятие"},
                        {"pageid": 99, "ns": 14, "title": "Категория:Врачи"},
                        {"pageid": 100, "ns": 14, "title": "Категория:Симптомы"},
                    ]
                },
                "continue": {"continue": "-||", "cmcontinue": "next"},
            }
        else:
            response = {
                "query": {"categorymembers": [{"pageid": 13, "ns": 0, "title": "Второе понятие"}]}
            }
        return Snapshot(response, sha(encoded(response)), "2026-09-22T00:00:00Z")


def selection(max_pages: int = 10) -> dict[str, object]:
    return {
        "maxCategories": 10,
        "maxPages": max_pages,
        "seeds": [{"category": "Категория:Медицина", "family": "general-medicine", "depth": 1}],
    }


def test_category_continuation_and_nonmedical_subtree_exclusion() -> None:
    api = CategoryApi()
    pages, ledger = discover(api, selection())
    assert set(pages) == {12, 13}
    assert api.requested.count("Категория:Медицина") == 2
    assert "Категория:Врачи" not in api.requested
    assert "Категория:Симптомы" in api.requested
    assert ledger[0]["complete"] is True


def test_bounded_traversal_is_not_advertised_as_complete() -> None:
    pages, ledger = discover(CategoryApi(), selection(1))
    assert len(pages) == 1
    assert any(row.get("complete") is False for row in ledger)


def source_input(root: Path) -> Path:
    source = root / "content/definition-drafts"
    source.mkdir(parents=True)
    path = source / "new.json"
    path.write_bytes(encoded(payload()))
    return path


def test_manifest_drives_count_and_verified_input(tmp_path: Path) -> None:
    path = source_input(tmp_path)
    manifest = tmp_path / "manifest.json"
    written = write_source_manifest(tmp_path, (path,), manifest)
    paths, count = read_source_manifest(tmp_path, manifest)
    assert paths == (path,)
    assert count == written["entries"] == 1


@pytest.mark.parametrize("change", ["text", "count", "path", "duplicate", "owner"])
def test_manifest_refuses_stale_tampered_or_private_inputs(tmp_path: Path, change: str) -> None:
    path = source_input(tmp_path)
    manifest = tmp_path / "manifest.json"
    written = write_source_manifest(tmp_path, (path,), manifest)
    if change == "text":
        path.write_bytes(path.read_bytes() + b" ")
    elif change == "count":
        written["entries"] = 2
        manifest.write_bytes(encoded(written))
    elif change == "path":
        first = obj(items(written["inputs"])[0])  # checked below by the boundary parser
        first["path"] = "../outside.json"
        manifest.write_bytes(encoded(written))
    elif change == "duplicate":
        rows = items(written["inputs"])
        rows.append(copy.deepcopy(rows[0]))
        written["inputs"] = rows
        written["entries"] = 2
        manifest.write_bytes(encoded(written))
    else:
        value = payload()
        source = obj(items(value["sources"])[0])
        source["sourceType"] = "owner-pdf"
        path.write_bytes(encoded(value))
    with pytest.raises((ValueError, FileNotFoundError)):
        read_source_manifest(tmp_path, manifest)


def test_offline_cache_is_bound_to_exact_response_bytes(tmp_path: Path) -> None:
    client = WikiApi(tmp_path, offline=True)
    parameters = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "maxlag": "5",
        "pageids": "12",
    }
    response = json.dumps({"query": {"pages": [page()]}}, ensure_ascii=False)
    path = tmp_path / (sha(encoded(parameters)) + ".json")
    stored = {
        "parameters": parameters,
        "response": response,
        "responseSha256": sha(response.encode()),
        "retrievedAt": "2026-09-22T00:00:00Z",
    }
    path.write_bytes(encoded(stored))
    assert client.get({"pageids": "12"}).response_sha256 == stored["responseSha256"]
    stored["response"] = response + " "
    path.write_bytes(encoded(stored))
    with pytest.raises(ValueError, match="receipt"):
        client.get({"pageids": "12"})
