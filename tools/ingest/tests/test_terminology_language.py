from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from test_terminology import XML, add_source, snapshot, wd_row

from localmed_ingest.terminology_models import TerminologySources
from localmed_ingest.terminology_packs import build_terminology_packs
from localmed_ingest.terminology_prepare import prepare_terminology


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
