from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest

import localmed_ingest.sqlite_composer as composer
import localmed_ingest.terminology_packs as packs
from localmed_ingest.sqlite_builder import write_sqlite_pack
from localmed_ingest.sqlite_composer import compose_sqlite_packs
from localmed_ingest.terminology_mentions import (
    TermLabelMatcher,
    read_occurrences,
    write_occurrence_index,
)
from localmed_ingest.terminology_prepare import prepare_terminology
from localmed_ingest.terminology_sources import sha256_file
from test_sqlite_composer import source_pack
from test_terminology import snapshot

STAMP = "2026-09-14T00:00:00Z"
TERM = "mesh.M0000001"


def discovery(tmp: Path) -> Path:
    raw = tmp / "raw"
    raw.mkdir()
    snapshot(raw, russian=True)
    prepare_terminology(raw, tmp / "prepared")
    packs.build_terminology_packs(
        tmp / "prepared", tmp / "terms", version="2026.1", built_at=STAMP, sections=[]
    )
    return tmp / "terms/minimed.terminology.discovery.db"


def source(tmp: Path, *, private: bool = False) -> Path:
    pack = source_pack(
        "test.source",
        "source.one",
        "Первый Синдром Мюнхгаузена; повтор: Синдром Мюнхгаузена. Munchausen Syndrome by Proxy.",
    )
    if private:
        pack.documents[0].source_type = "personal_note"
    path = tmp / "source.db"
    write_sqlite_pack(pack, path)
    return path


def pointer(tmp: Path, *, version: str = "1") -> Path:
    pack = source_pack("test.pointer", "pointer.one", "Документ доступен для отдельной загрузки.")
    doc = pack.documents[0]
    doc.source_type = "core_catalog_pointer"
    doc.version.label = version
    doc.metadata.update(
        {
            "contentMode": "module-pointer",
            "targetDocumentId": "source.one",
            "pointerKind": "clinical",
            "primaryModuleId": "test.source",
            "moduleIds": ["test.source"],
        }
    )
    path = tmp / "pointer.db"
    write_sqlite_pack(pack, path)
    return path


def compose(tmp: Path, inputs: list[Path], sources: list[Path]) -> Path:
    output = tmp / "composed.db"
    compose_sqlite_packs(
        inputs,
        output,
        tmp / "edition.json",
        edition_id="test.composed",
        edition_version="1",
        title="Fixture",
        built_at=STAMP,
        terminology_sources=sources,
    )
    return output


def test_literal_labels_use_boundaries_longest_match_and_original_offsets() -> None:
    matcher = TermLabelMatcher(
        {
            "a": ["синдром Мюнхгаузена"],
            "b": ["синдром Мюнхгаузена по доверенности"],
            "c": ["отёк"],
            "d": ["отёк"],
        }
    )
    text = "СИНДРОМ МЮНХГАУЗЕНА по доверенности, затем отек. Предотёк не подходит."
    hits = list(matcher.occurrences(text))
    assert [(text[a:b], ids) for a, b, ids in hits] == [
        ("СИНДРОМ МЮНХГАУЗЕНА по доверенности", ("b",)),
        ("отек", ("c", "d")),
    ]
    assert list(matcher.occurrences("синдром. Мюнхгаузена")) == []


def test_occurrence_jsonl_is_exact_bounded_and_does_not_write_inputs(tmp_path: Path) -> None:
    terms, document = discovery(tmp_path), source(tmp_path)
    before = sha256_file(document)
    report = write_occurrence_index(terms, [document], tmp_path / "occurrences.jsonl")
    records = [
        json.loads(line) for line in (tmp_path / "occurrences.jsonl").read_text().splitlines()
    ]
    assert report["records"] == 2
    assert records[0]["conceptIds"] == [TERM]
    assert records[1]["conceptIds"] == ["mesh.M0000003"]
    assert records[0]["sourceDocumentVersionId"] == "source.one@1"
    assert records[0]["sourceChunkId"] == "chunk.source.one"
    assert records[0]["quote"] == "Синдром Мюнхгаузена"
    assert records[0]["searchOnly"] is True
    assert sha256_file(document) == before
    with pytest.raises(ValueError, match="already exists"):
        write_occurrence_index(terms, [document], tmp_path / "occurrences.jsonl")


def test_private_notes_are_not_projected_into_public_term_occurrences(tmp_path: Path) -> None:
    document = source(tmp_path, private=True)
    assert list(read_occurrences(document, TermLabelMatcher({TERM: ["Синдром Мюнхгаузена"]}))) == []


def test_core_only_finds_term_and_uninstalled_document_occurrence(tmp_path: Path) -> None:
    terms, document, catalog = discovery(tmp_path), source(tmp_path), pointer(tmp_path)
    before = [sha256_file(p) for p in (terms, document, catalog)]
    db = compose(tmp_path, [terms, catalog], [document])
    with sqlite3.connect(db) as connection:
        assert connection.execute("PRAGMA quick_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute(
            "SELECT count(*) FROM documents WHERE id='source.one'"
        ).fetchone() == (0,)
        hits = connection.execute(
            "SELECT DISTINCT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
            ('"мюнхгаузена"',),
        ).fetchall()
        assert ("discovery.medical.term.mesh.M0000001",) in hits
        assert ("pointer.one",) in hits
        chunks = connection.execute(
            "SELECT original_text,anchor,metadata_json FROM chunks WHERE "
            "json_extract(metadata_json,"
            "'$.projection')='terminology-literal-mentions-v1' ORDER BY order_index"
        ).fetchall()
        assert len(chunks) == 2
        assert chunks[0][0] == "Синдром Мюнхгаузена"
        metadata = json.loads(chunks[0][2])
        assert metadata["sourceLocator"]["sourceAnchor"] == "source.one@1/contraindications#chunk-1"
        pointer_metadata = json.loads(
            connection.execute(
                "SELECT metadata_json FROM documents WHERE id='pointer.one'"
            ).fetchone()[0]
        )
        assert (
            pointer_metadata["terminologyMentionAnchors"][chunks[0][1]]
            == metadata["sourceLocator"]["sourceAnchor"]
        )
        assert connection.execute(
            "SELECT count(*) FROM knowledge_document_links WHERE "
            "link_type='term-label-mention' AND review_status!='proposed'"
        ).fetchone() == (0,)
        # Russian names expand to the English-named concept's source occurrence without
        # replacing text.
        assert connection.execute(
            "SELECT count(*) FROM knowledge_entities WHERE "
            "json_extract(metadata_json,'$.projection')='core-pointer-knowledge-v1'"
        ).fetchone() == (1,)
    assert [sha256_file(p) for p in (terms, document, catalog)] == before


def test_mismatched_source_version_cannot_establish_pointer_occurrence(tmp_path: Path) -> None:
    terms, document, catalog = discovery(tmp_path), source(tmp_path), pointer(tmp_path, version="2")
    db = compose(tmp_path, [terms, catalog], [document])
    with sqlite3.connect(db) as connection:
        assert connection.execute(
            "SELECT count(*) FROM chunks WHERE json_extract(metadata_json,"
            "'$.projection')='terminology-literal-mentions-v1'"
        ).fetchone() == (0,)
        report = json.loads(
            connection.execute(
                "SELECT value FROM app_metadata WHERE key='terminology-literal-mentions-v1'"
            ).fetchone()[0]
        )
        assert report["versionMismatches"] == 2
        assert report["unmappedOccurrences"] == 2


def test_installed_original_text_and_anchor_are_unchanged(tmp_path: Path) -> None:
    terms, document = discovery(tmp_path), source(tmp_path)
    with sqlite3.connect(document) as original:
        expected = original.execute(
            "SELECT id,original_text,normalized_text,anchor FROM chunks"
        ).fetchall()
    db = compose(tmp_path, [terms, document], [document])
    with sqlite3.connect(db) as connection:
        assert (
            connection.execute(
                "SELECT id,original_text,normalized_text,anchor FROM chunks "
                "WHERE document_version_id='source.one@1'"
            ).fetchall()
            == expected
        )
        assert json.loads(
            connection.execute(
                "SELECT metadata_json FROM chunks WHERE id='chunk.source.one'"
            ).fetchone()[0]
        )["terminologyConceptIds"] == [TERM, "mesh.M0000003"]
        assert connection.execute(
            "SELECT count(*) FROM chunks WHERE json_extract(metadata_json,"
            "'$.projection')='terminology-literal-mentions-v1'"
        ).fetchone() == (0,)


def test_batched_discovery_has_identical_documents_definitions_and_no_vectors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ordinary = discovery(tmp_path)
    monkeypatch.setattr(packs, "DISCOVERY_BATCH_SIZE", 2)
    packs.build_terminology_packs(
        tmp_path / "prepared", tmp_path / "batched", version="2026.1", built_at=STAMP, sections=[]
    )
    batched = tmp_path / "batched/minimed.terminology.discovery.db"
    with sqlite3.connect(ordinary) as before, sqlite3.connect(batched) as after:
        for query in (
            "SELECT id,title,short_title,source_type,current_version_id FROM documents ORDER BY id",
            "SELECT id,original_text,anchor FROM chunks ORDER BY id",
            "SELECT id,original_text,review_status FROM knowledge_facts ORDER BY id",
        ):
            assert after.execute(query).fetchall() == before.execute(query).fetchall()
        assert after.execute("SELECT count(*) FROM embedding_profiles").fetchone() == (0,)
        assert after.execute("PRAGMA foreign_key_check").fetchall() == []
        assert (
            after.execute("SELECT count(*) FROM chunks").fetchone()
            == after.execute("SELECT count(*) FROM chunks_fts").fetchone()
        )


def test_uppercase_abbreviation_is_not_an_ordinary_lowercase_word() -> None:
    matcher = TermLabelMatcher({"abbreviation": ["NO"], "group": ["HLA-DR"]})
    text = "There is no match here, but NO and HLA-DR are literal labels."
    assert [(text[a:b], ids) for a, b, ids in matcher.occurrences(text)] == [
        ("NO", ("abbreviation",)),
        ("HLA-DR", ("group",)),
    ]


def test_explicit_source_version_cannot_be_overridden_by_a_matching_label(tmp_path: Path) -> None:
    terms, original, catalog = discovery(tmp_path), source(tmp_path), pointer(tmp_path)
    with sqlite3.connect(catalog) as connection:
        connection.execute(
            "UPDATE documents SET metadata_json=json_set(metadata_json, "
            "'$.canonicalDefinition', json(?))",
            (
                json.dumps(
                    {
                        "definitionId": "fixture.definition.older",
                        "text": "Документ доступен для отдельной загрузки.",
                        "sourceDocumentId": "source.one",
                        "sourceDocumentVersionId": "source.one@older",
                        "sourceSectionId": "section.source.one",
                        "sourceChunkId": "chunk.source.one",
                        "sourceAnchor": "source.one@older#fixture",
                    }
                ),
            ),
        )
    output = compose(tmp_path, [terms, catalog], [original])
    with sqlite3.connect(output) as connection:
        assert connection.execute(
            "SELECT count(*) FROM chunks WHERE "
            "json_extract(metadata_json, '$.projection')='terminology-literal-mentions-v1'"
        ).fetchone() == (0,)


def test_recomposing_the_same_mention_index_does_not_duplicate_chunks_or_anchors(
    tmp_path: Path,
) -> None:
    terms, original, catalog = discovery(tmp_path), source(tmp_path), pointer(tmp_path)
    first = compose(tmp_path, [terms, catalog], [original])
    second_root = tmp_path / "again"
    second_root.mkdir()
    second = compose(second_root, [first], [original])
    with sqlite3.connect(first) as before, sqlite3.connect(second) as after:
        for query in (
            "SELECT id,original_text,normalized_text,anchor FROM chunks ORDER BY id",
            "SELECT id,chunk_id,review_status FROM knowledge_document_links "
            "WHERE link_type='term-label-mention' ORDER BY id",
            "SELECT id,json_extract(metadata_json,'$.terminologyMentionAnchors') "
            "FROM documents ORDER BY id",
        ):
            assert after.execute(query).fetchall() == before.execute(query).fetchall()
        assert after.execute("PRAGMA foreign_key_check").fetchall() == []


def test_terminology_source_checksums_survive_interrupted_composition_resume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    terms, original, catalog = discovery(tmp_path), source(tmp_path), pointer(tmp_path)
    output = tmp_path / "resumed.db"
    manifest = tmp_path / "resumed.edition.json"
    write_checkpoint = cast(
        Callable[[Path, dict[str, object]], None], composer.__dict__["_write_checkpoint"]
    )

    def interrupt_first(path: Path, payload: dict[str, object]) -> None:
        write_checkpoint(path, payload)
        if payload["nextModule"] == 1:
            raise KeyboardInterrupt

    def run(*, resume: bool = False) -> None:
        compose_sqlite_packs(
            [terms, catalog],
            output,
            manifest,
            edition_id="test.terminology.resume",
            edition_version="1",
            title="Resume fixture",
            built_at=STAMP,
            terminology_sources=[original],
            resume=resume,
        )

    with monkeypatch.context() as interrupted:
        interrupted.setattr(composer, "_write_checkpoint", interrupt_first)
        with pytest.raises(KeyboardInterrupt):
            run()
    assert not output.exists()
    assert (tmp_path / ".resumed.db.checkpoint.json").is_file()
    run(resume=True)
    with sqlite3.connect(output) as connection:
        assert connection.execute("PRAGMA quick_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert (
            connection.execute(
                "SELECT count(*) FROM knowledge_document_links WHERE link_type='term-label-mention'"
            ).fetchone()[0]
            > 0
        )
    assert manifest.is_file()
    assert not (tmp_path / ".resumed.db.checkpoint.json").exists()
