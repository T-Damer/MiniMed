from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

import localmed_ingest.russian_dictionary as rd
from localmed_ingest.russian_dictionary_packs import INDEX_ID, build_russian_dictionary
from localmed_ingest.terminology_mentions import matcher_from_database
from localmed_ingest.terminology_sources import sha256_file

STAMP = "2026-09-16T00:00:00Z"


def record(
    word: str = "афазия", gloss: str = "Учебное определение для теста, не медицинские данные."
) -> dict[str, object]:
    return {
        "word": word,
        "pos": "noun",
        "lang_code": "ru",
        "senses": [
            {
                "glosses": [gloss],
                "categories": ["Медицинские термины/ru", "Психиатрические термины/ru"],
                "examples": [{"text": "A third-party quote that must never be imported"}],
            }
        ],
    }


def snapshot(root: Path, rows: list[object]) -> rd.RussianDictionarySource:
    root.mkdir()
    data = b"".join((json.dumps(r, ensure_ascii=False) + "\n").encode() for r in rows)
    compressed = gzip.compress(data, mtime=0)
    (root / "ru-extract.jsonl.gz").write_bytes(compressed)
    source = rd.RussianDictionarySource(
        sha256=hashlib.sha256(compressed).hexdigest(), bytes=len(compressed), retrieved_at=STAMP
    )
    (root / "source.json").write_text(source.model_dump_json(by_alias=True))
    return source


def test_only_source_labelled_medical_senses_and_russian_language(tmp_path: Path) -> None:
    rows = [
        record(),
        {
            "word": "психоз",
            "pos": "noun",
            "lang_code": "ru",
            "categories": ["Психиатрические термины/ru"],
            "senses": [
                {"glosses": ["разговорное настроение"]},
                {
                    "glosses": ["Учебное психиатрическое значение"],
                    "categories": ["Психиатрические термины/ru"],
                },
            ],
        },
        {**record("mania"), "lang_code": "en"},
    ]
    source = snapshot(tmp_path / "raw", rows)
    actual = list(rd.iter_medical_senses(tmp_path / "raw/ru-extract.jsonl.gz", source))
    assert len(actual) == 2
    assert actual[1].glosses == ["Учебное психиатрическое значение"]
    assert all("examples" not in a.model_dump() for a in actual)
    assert all(a.source_sha256 == f"sha256:{source.sha256}" for a in actual)


def test_same_name_never_merges_distinct_senses(tmp_path: Path) -> None:
    snapshot(tmp_path / "raw", [record(), record(gloss="Другое значение того же слова."), record()])
    report = rd.prepare_russian_dictionary(tmp_path / "raw", tmp_path / "prepared")
    assert report["senses"] == 2 and report["words"] == 1
    assert report["russianDefinitionCount"] == 2
    with pytest.raises(ValueError, match="immutable"):
        rd.prepare_russian_dictionary(tmp_path / "raw", tmp_path / "prepared")


def test_bad_digest_and_truncation_fail_closed(tmp_path: Path) -> None:
    root = tmp_path / "raw"
    src = snapshot(root, [record()])
    path = root / "ru-extract.jsonl.gz"
    with pytest.raises(ValueError, match="checksum"):
        list(rd.iter_medical_senses(path, src.model_copy(update={"sha256": "0" * 64})))
    path.write_bytes(path.read_bytes()[:-4])
    truncated = src.model_copy(
        update={
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    )
    with pytest.raises(EOFError):
        list(rd.iter_medical_senses(path, truncated))


@pytest.mark.parametrize("limit", ["MAX_LINE_BYTES", "MAX_EXPANDED_BYTES"])
def test_bounded_decompression(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, limit: str) -> None:
    src = snapshot(tmp_path / "raw", [record()])
    monkeypatch.setattr(rd, limit, 20)
    with pytest.raises(ValueError, match="limit"):
        list(rd.iter_medical_senses(tmp_path / "raw/ru-extract.jsonl.gz", src))


def test_source_download_requires_opt_in(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="network"):
        rd.collect_russian_dictionary(tmp_path / "out", tmp_path / "cache")
    assert not (tmp_path / "out").exists()


def test_real_pack_contract_definitions_license_sections_and_gzip(tmp_path: Path) -> None:
    snapshot(tmp_path / "raw", [record()])
    rd.prepare_russian_dictionary(tmp_path / "raw", tmp_path / "prepared")
    build_russian_dictionary(
        tmp_path / "prepared", tmp_path / "packs", version="2026.9.16", built_at=STAMP
    )
    db_path = tmp_path / "packs" / f"{INDEX_ID}.db"
    with sqlite3.connect(db_path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        doc = db.execute("SELECT id, metadata_json FROM documents").fetchone()
        meta = json.loads(doc[1])
        assert doc[0].startswith("discovery.medical.term.ruwikt.")
        assert meta["terminology"]["definitionLanguages"] == ["ru"]
        assert meta["terminology"]["relatedConceptIds"] == []
        assert meta["terminologySections"] == ["medicine", "psychiatry"]
        assert meta["authorityTier"] == "third-party" and meta["notClinicalGuidance"]
        assert meta["provenance"]["rights"]["licenseId"] == "CC-BY-SA-4.0"
        body = "\n".join(row[0] for row in db.execute("SELECT original_text FROM chunks"))
        assert "Учебное определение" in body and rd.LICENSE_URL in body
        assert "third-party quote" not in body
        assert (
            db.execute(
                "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'определение'"
            ).fetchone()[0]
            > 0
        )
        matcher = matcher_from_database(db)
        assert list(matcher.occurrences("афазия"))
    assert gzip.decompress(db_path.with_suffix(".db.gz").read_bytes()) == db_path.read_bytes()
    build_russian_dictionary(
        tmp_path / "prepared", tmp_path / "again", version="2026.9.16", built_at=STAMP
    )
    assert sha256_file(db_path) == sha256_file(tmp_path / "again" / db_path.name)


def test_prepared_tampering_does_not_publish(tmp_path: Path) -> None:
    snapshot(tmp_path / "raw", [record()])
    rd.prepare_russian_dictionary(tmp_path / "raw", tmp_path / "prepared")
    (tmp_path / "prepared/senses.jsonl").write_text("{}\n")
    with pytest.raises(ValueError, match="checksum"):
        build_russian_dictionary(
            tmp_path / "prepared", tmp_path / "packs", version="1", built_at=STAMP
        )
    assert not (tmp_path / "packs").exists()


def test_composition_preserves_term_entities_and_literal_mentions(tmp_path: Path) -> None:
    from localmed_ingest.sqlite_builder import write_sqlite_pack
    from localmed_ingest.sqlite_composer import compose_sqlite_packs
    from test_sqlite_composer import source_pack

    snapshot(tmp_path / "raw", [record()])
    rd.prepare_russian_dictionary(tmp_path / "raw", tmp_path / "prepared")
    build_russian_dictionary(
        tmp_path / "prepared", tmp_path / "packs", version="2026.9.16", built_at=STAMP
    )
    source = source_pack(
        "test.source", "test.source-doc", "Учебная афазия в источнике, не медицинское утверждение."
    )
    write_sqlite_pack(source, tmp_path / "source.db")
    compose_sqlite_packs(
        [tmp_path / "source.db", tmp_path / "packs" / f"{INDEX_ID}.db"],
        tmp_path / "core.db",
        tmp_path / "core.edition.json",
        edition_id="test.core",
        edition_version="1",
        title="Test",
        built_at=STAMP,
        terminology_sources=[tmp_path / "source.db"],
    )
    with sqlite3.connect(tmp_path / "core.db") as db:
        assert (
            db.execute(
                "SELECT count(*) FROM knowledge_document_links WHERE link_type='term-label-mention'"
            ).fetchone()[0]
            > 0
        )
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert (
            db.execute(
                "SELECT count(*) FROM knowledge_facts WHERE review_status='reviewed'"
            ).fetchone()[0]
            == 0
        )


def test_distribution_verifies_transport_membership_and_source_rights(tmp_path: Path) -> None:
    from localmed_ingest.terminology_distribution import russian_distribution_catalog

    snapshot(tmp_path / "raw", [record()])
    rd.prepare_russian_dictionary(tmp_path / "raw", tmp_path / "prepared")
    build_russian_dictionary(
        tmp_path / "prepared", tmp_path / "packs", version="2026.9.16", built_at=STAMP
    )
    base = "https://github.com/T-Damer/MiniMed/releases/download/test-dataset"
    modules = russian_distribution_catalog(tmp_path / "packs", base)
    assert len(modules) == 2
    assert modules[0]["required"] is False
    with pytest.raises(ValueError, match="HTTPS"):
        russian_distribution_catalog(tmp_path / "packs", "https://untrusted.invalid/data")
    path = tmp_path / "packs" / f"{INDEX_ID}.db.gz"
    path.write_bytes(path.read_bytes()[:-4])
    with pytest.raises(ValueError, match="checksum"):
        russian_distribution_catalog(tmp_path / "packs", base)
