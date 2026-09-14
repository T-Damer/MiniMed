from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.terminology_models import TerminologySources
from localmed_ingest.terminology_names import russian_search_spelling, terminology_search_aliases
from localmed_ingest.terminology_packs import build_terminology_packs
from localmed_ingest.terminology_prepare import prepare_terminology, read_terms
from test_terminology import XML, add_source, snapshot, wd_row


def test_russian_label_with_english_definition_preserves_source_language(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    english = "An original English definition from the synthetic source. " * 30
    xml = XML.replace(b"Synthetic source definition, not medical guidance.", english.encode())
    mesh = add_source(raw, "mesh.xml", xml)
    payload = {"results": {"bindings": [wd_row("D009110", "Q1", "Синдром Мюнхгаузена")]}}
    wd = add_source(raw, "wd.json", json.dumps(payload).encode(), "wikidata-ru")
    manifest = TerminologySources(sources=[mesh, wd])
    (raw / "sources.json").write_text(manifest.model_dump_json(by_alias=True))
    prepare_terminology(raw, tmp_path / "prepared")
    build_terminology_packs(
        tmp_path / "prepared",
        tmp_path / "packs",
        version="2026.1.0",
        built_at="2026-01-01T00:00:00Z",
        sections=["F03"],
    )
    with sqlite3.connect(tmp_path / "packs/minimed.terminology.discovery.db") as db:
        title, short_title, metadata_json = db.execute(
            "SELECT title, short_title, metadata_json FROM documents WHERE id=?",
            ("discovery.medical.term.mesh.M0000001",),
        ).fetchone()
        assert title == "Munchausen Syndrome"
        assert short_title == "Синдром Мюнхгаузена"
        metadata = json.loads(metadata_json)
        assert metadata["sourceTitleLanguage"] == "en"
        assert metadata["nameLanguage"] == "ru"
        assert metadata["definitionLanguages"] == ["en"]
        assert metadata["sourceDefinitions"][0]["text"] == english
        assert metadata["provenance"]["sourceId"] == mesh.id
        assert (
            db.execute(
                "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?", ('"Мюнхгаузена"',)
            ).fetchone()[0]
            > 0
        )


def test_false_russian_definition_is_rejected_even_with_english_source_title(
    tmp_path: Path,
) -> None:
    raw = tmp_path / "raw"
    manifest = snapshot(raw)
    record = {
        "conceptId": "M0000001",
        "preferredName": "Синдром Мюнхгаузена",
        "definition": "An English translation wrongly declared Russian. " * 30,
    }
    manifest.sources.append(
        add_source(
            raw,
            "localized.jsonl",
            (json.dumps(record) + "\n").encode(),
            "localized-concepts",
        )
    )
    (raw / "sources.json").write_text(manifest.model_dump_json(by_alias=True))
    prepare_terminology(raw, tmp_path / "prepared")
    with pytest.raises(ValueError, match="English-dominant"):
        build_terminology_packs(
            tmp_path / "prepared",
            tmp_path / "packs",
            version="2026.1.0",
            built_at="2026-01-01T00:00:00Z",
            sections=["F03"],
        )
    assert not (tmp_path / "packs").exists()


@pytest.mark.parametrize(
    "source, expected",
    [
        ("cиндром Мюнхгаузена", "синдром Мюнхгаузена"),
        ("CD4 клетки", "CD4 клетки"),
        ("HLA-DR", "HLA-DR"),
        ("B-клетки", "B-клетки"),
        ("HbA1c", "HbA1c"),
        ("Munchausen Syndrome", "Munchausen Syndrome"),
        ("fиндром", "fиндром"),
    ],
)
def test_only_mixed_cyrillic_word_spellings_expand(source: str, expected: str) -> None:
    assert russian_search_spelling(source) == expected


def test_search_spelling_does_not_change_source_label_or_concept(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    manifest = snapshot(raw)
    original = "cиндром Мюнхгаузена"  # actual Wikidata label uses Latin c, kept verbatim
    wd = add_source(
        raw,
        "wd.json",
        json.dumps({"results": {"bindings": [wd_row("D009110", "Q1", original)]}}).encode(),
        "wikidata-ru",
    )
    manifest.sources.append(wd)
    (raw / "sources.json").write_text(manifest.model_dump_json(by_alias=True))
    prepare_terminology(raw, tmp_path / "prepared")
    terms, _, _ = read_terms(tmp_path / "prepared")
    before = [term.model_dump_json() for term in terms]
    aliases = terminology_search_aliases(terms)
    assert [term.model_dump_json() for term in terms] == before
    assert len(aliases) == 1
    assert aliases[0].canonical_term == original
    assert aliases[0].alias == "синдром Мюнхгаузена"
    assert aliases[0].category == "terminology-search-spelling"
    build_terminology_packs(
        tmp_path / "prepared",
        tmp_path / "packs",
        version="2026.1.0",
        built_at="2026-01-01T00:00:00Z",
        sections=["F03"],
    )
    with sqlite3.connect(tmp_path / "packs/minimed.terminology.discovery.db") as db:
        expansion = db.execute(
            "SELECT canonical_term FROM aliases WHERE alias=?", ("синдром Мюнхгаузена",)
        ).fetchone()[0]
        results = db.execute(
            "SELECT DISTINCT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
            (" AND ".join(f'"{token}"' for token in expansion.split()),),
        ).fetchall()
        assert results == [("discovery.medical.term.mesh.M0000001",)]
