from __future__ import annotations

import copy
import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_pack import (
    Projection,
    build_definition_reference,
    digest,
    encoded,
    normalized_name,
    obj,
    seq,
)


def fixture() -> dict[str, object]:
    bodies = ["Точное определение тестового понятия.", "Первый пункт.", "Второй пункт.", "Контекст с уникальным словом контекстмаркер."]
    return {
        "version": 3, "id": "fixture.reference", "reviewStatus": "requires-review",
        "publicationState": "local-dev", "textKind": "source-excerpt",
        "sources": [{"id": 1, "title": "Проверочный источник", "baseUrl": "https://example.org/reference/",
                     "sourceType": "fixture", "authority": "third-party", "accessed": "2026-09-21",
                     "rightsStatus": "fixture-only", "releaseEligible": False}],
        "blocks": [{"id": i + 1, "source": 1, "text": body, "path": "chapter",
                    "locator": f"Fixture paragraph {i + 1}", "textSha256": digest(body)} for i, body in enumerate(bodies)],
        "terms": [{"id": "fixture.first", "title": "Тестовый термин", "kind": "criterion_set",
                   "aliases": ["ТТ"], "blockIds": [1], "itemBlocks": [2, 3], "detailBlocks": [4],
                   "coverage": "criterion-list", "note": "Проверочная аннотация аннотациямаркер."},
                  {"id": "fixture.second", "title": "Тестовый термин", "kind": "term", "aliases": [],
                   "blockIds": [1], "coverage": "definition", "note": ""}],
    }


def write_input(root: Path, payload: object, name: str = "input.json") -> Path:
    path = root / name
    path.write_text(encoded(payload), encoding="utf-8")
    return path


def build(root: Path, payload: object, output: str = "reference.db") -> Path:
    write_input(root, payload)
    result = root / output
    build_definition_reference((Path("input.json"),), result, input_root=root,
                               edition_id="fixture.reference", version="1", built_at="2026-09-21")
    return result


def test_existing_schema_shared_source_and_proposed_links(tmp_path: Path) -> None:
    path = build(tmp_path, fixture())
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT count(*) FROM documents").fetchone() == (1,)
        assert db.execute("SELECT count(*) FROM knowledge_entities").fetchone() == (2,)
        assert db.execute("SELECT count(*) FROM knowledge_facts").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM knowledge_relations").fetchone() == (0,)
        assert db.execute("SELECT DISTINCT review_status FROM knowledge_document_links").fetchall() == [("proposed",)]
        assert db.execute("SELECT value FROM app_metadata WHERE key='schema_version'").fetchone() == ("6",)
        assert db.execute("SELECT count(*) FROM chunks WHERE original_text=?", ("Точное определение тестового понятия.",)).fetchone() == (1,)
        assert db.execute("SELECT sum(length(normalized_text)) FROM chunks").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM sqlite_master WHERE name='definition_reference_fts_content'").fetchone() == (0,)


def test_source_order_and_lazy_context_are_separate(tmp_path: Path) -> None:
    path = build(tmp_path, fixture())
    with sqlite3.connect(path) as db:
        rows = db.execute("""SELECT l.link_type, c.original_text, c.metadata_json
          FROM knowledge_document_links l JOIN chunks c ON c.id=l.chunk_id
          WHERE l.entity_id='fixture.first' ORDER BY l.id""").fetchall()
        assert [row[0] for row in rows] == ["reference:definition", "reference:item", "reference:item", "reference:context", "reference:annotation"]
        assert rows[1][1] == "Первый пункт." and rows[2][1] == "Второй пункт."
        assert json.loads(rows[3][2])["locator"] == "Fixture paragraph 4"
        assert db.execute("SELECT count(*) FROM definition_reference_fts WHERE definition_reference_fts MATCH ?", ('"контекстмаркер"',)).fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM definition_reference_fts WHERE definition_reference_fts MATCH ?", ('"аннотациямаркер"',)).fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM definition_reference_fts WHERE definition_reference_fts MATCH ?", ('"определение"',)).fetchone() == (1,)


@pytest.mark.parametrize("version,text_kind", [(1, "editorial-paraphrase"), (2, "source-gloss")])
def test_editorial_and_dictionary_inputs_preserve_text_and_items(tmp_path: Path, version: int, text_kind: str) -> None:
    payload = fixture()
    payload.update({"version": version, "textKind": text_kind, "terms": [{
        "id": "fixture.named", "title": "в/в", "kind": "term", "aliases": ["ТТ"],
        "definition": "Буквальный словарный текст.", "items": ["Пункт один", "Пункт два"], "note": "",
        "references": [{"source": 1, "path": "entry", "locator": "Exact fixture entry"}],
    }]})
    payload.pop("blocks")
    path = build(tmp_path, payload)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT entity_id FROM knowledge_names WHERE normalized_name='в/в'").fetchone() == ("fixture.named",)
        assert db.execute("SELECT original_text FROM chunks WHERE original_text='Буквальный словарный текст.'").fetchone() is not None
        assert json.loads(db.execute("SELECT metadata_json FROM knowledge_entities").fetchone()[0])["textKind"] == text_kind


@pytest.mark.parametrize("field,value", [("reviewStatus", "reviewed"), ("publicationState", "published"), ("textKind", "generated"), ("version", True), ("version", [])])
def test_rejects_promotion_or_invalid_version(field: str, value: object) -> None:
    payload = fixture()
    payload[field] = value
    with pytest.raises(ValueError):
        Projection().add(payload, "a" * 64)


def test_rejects_changed_source_text_and_dangling_blocks() -> None:
    payload = fixture()
    obj(seq(payload["blocks"], 100)[0])["text"] = "Подменённый текст"
    with pytest.raises(ValueError, match="checksum"):
        Projection().add(payload, "a" * 64)
    payload = fixture()
    obj(seq(payload["terms"], 100)[0])["detailBlocks"] = [999]
    with pytest.raises(ValueError, match="Dangling"):
        Projection().add(payload, "a" * 64)


@pytest.mark.parametrize("path", ["../secret", "%2e%2e/secret", "https://evil.example/", "//evil.example/", "\\secret"])
def test_rejects_escaping_source_locator(path: str) -> None:
    payload = fixture()
    obj(seq(payload["blocks"], 100)[0])["path"] = path
    with pytest.raises(ValueError, match="Unsafe"):
        Projection().add(payload, "a" * 64)


def test_numeric_sources_are_module_local_not_implicitly_global() -> None:
    projection = Projection()
    projection.add(fixture(), "a" * 64)
    other = fixture()
    obj(seq(other["sources"], 100)[0])["title"] = "Другой источник с тем же числом"
    for term in seq(other["terms"], 100):
        row = obj(term)
        row["id"] = str(row["id"]) + ".other"
    projection.add(other, "b" * 64)
    assert len(projection.sources) == 2
    with pytest.raises(ValueError, match="conflicting"):
        projection.add(fixture(), "c" * 64)


def test_mentions_never_acquire_scoring_or_approval(tmp_path: Path) -> None:
    payload = fixture()
    term = obj(seq(payload["terms"], 100)[0])
    term.update({"kind": "scale", "coverage": "mention-only"})
    path = build(tmp_path, payload)
    with sqlite3.connect(path) as db:
        raw = db.execute("SELECT metadata_json FROM knowledge_entities WHERE id='fixture.first'").fetchone()[0]
        assert json.loads(raw)["coverage"] == "mention-only"
        assert db.execute("SELECT count(*) FROM knowledge_facts").fetchone() == (0,)


def test_output_and_inputs_are_immutable(tmp_path: Path) -> None:
    path = build(tmp_path, fixture())
    before = path.read_bytes()
    with pytest.raises(ValueError, match="immutable"):
        build(tmp_path, fixture())
    assert path.read_bytes() == before
    payload = copy.deepcopy(fixture())
    obj(seq(payload["blocks"], 100)[0])["textSha256"] = "0" * 64
    with pytest.raises(ValueError):
        build(tmp_path, payload, "failed.db")
    assert not (tmp_path / "failed.db").exists()


def test_input_root_escape(tmp_path: Path) -> None:
    child = tmp_path / "private"
    child.mkdir()
    write_input(tmp_path, fixture())
    with pytest.raises(ValueError, match="escapes"):
        build_definition_reference((Path("../input.json"),), child / "out.db", input_root=child,
                                   edition_id="fixture.reference", version="1", built_at="2026-09-21")


def test_name_normalization_keeps_short_words_and_punctuation() -> None:
    assert normalized_name("  ЁЖ  В/В  ") == "еж в/в"
    assert normalized_name("об") == "об"
