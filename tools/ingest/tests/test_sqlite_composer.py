from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.models import (
    Alias,
    ContentPack,
    PackChunk,
    PackDocument,
    PackManifest,
    PackSection,
    PackVersion,
    SourceProvenance,
    SourceRights,
)
from localmed_ingest.sqlite_builder import write_sqlite_pack
from localmed_ingest.sqlite_composer import compose_sqlite_packs


def checksum(seed: str) -> str:
    return f"sha256:{seed * 64}"


def source_pack(
    pack_id: str,
    document_id: str,
    text: str,
    *,
    schema_version: int = 2,
) -> ContentPack:
    source_checksum = checksum("a" if document_id.endswith("one") else "b")
    provenance = SourceProvenance(
        source_id=f"source.{document_id}",
        publisher="Test publisher",
        official_locator=f"https://example.test/{document_id}",
        jurisdiction="RU",
        rights_status="verified",
        rights=SourceRights(
            owner="Test owner",
            license_id="test-license",
            allows_offline_storage=True,
            allows_redistribution=True,
        ),
        raw_checksum=source_checksum,
    )
    version = PackVersion(
        id=f"{document_id}@1",
        label="1",
        source_checksum=source_checksum,
        extracted_at="2026-07-29T00:00:00Z",
    )
    section = PackSection(
        id=f"section.{document_id}",
        title="Противопоказания",
        normalized_title="противопоказания",
        section_type="treatment",
        depth=1,
        order_index=0,
        anchor=f"{document_id}@1/contraindications",
        section_path=["Противопоказания"],
        chunks=[
            PackChunk(
                id=f"chunk.{document_id}",
                order_index=0,
                original_text=text,
                normalized_text=text.casefold(),
                anchor=f"{document_id}@1/contraindications#chunk-1",
                metadata={"sourceSpans": [{"page": 1, "block": "b1"}]},
            )
        ],
    )
    return ContentPack(
        manifest=PackManifest(
            id=pack_id,
            version="1",
            schema_version=schema_version,
            title=pack_id,
            built_at="2026-07-29T00:00:00Z",
            checksum=checksum("c"),
        ),
        documents=[
            PackDocument(
                id=document_id,
                title=document_id,
                source_type="official_drug_instruction",
                status="active",
                specialties=[],
                metadata={"provenance": provenance.model_dump(by_alias=True, mode="json")},
                version=version,
                sections=[section],
            )
        ],
        aliases=[Alias(id=f"alias.{document_id}", canonical_term=document_id, alias=document_id)],
    )


def write_source(path: Path, pack: ContentPack) -> None:
    write_sqlite_pack(pack, path)


def test_composes_explicit_directory_into_one_local_edition(tmp_path: Path) -> None:
    sources = tmp_path / "sources"
    sources.mkdir()
    write_source(sources / "one.db", source_pack("pack.one", "document.one", "Первый текст"))
    write_source(sources / "two.db", source_pack("pack.two", "document.two", "Второй текст"))
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"

    report = compose_sqlite_packs(
        [sources],
        output,
        manifest,
        edition_id="minimed.core.local",
        edition_version="2026.07.29-local",
        title="Local candidate",
        built_at="2026-07-29T00:00:00Z",
    )

    assert report.documents == 2
    assert report.chunks == 2
    assert report.discarded_embedding_profiles == 0
    connection = sqlite3.connect(output)
    try:
        assert connection.execute("SELECT id, version FROM content_packs").fetchall() == [
            ("minimed.core.local", "2026.07.29-local")
        ]
        assert connection.execute("SELECT count(*) FROM chunks_fts").fetchone() == (2,)
        assert connection.execute(
            "SELECT document_id FROM chunks_fts WHERE chunks_fts MATCH 'второй'"
        ).fetchall() == [("document.two",)]
        assert connection.execute("SELECT count(*) FROM knowledge_fts").fetchone() == (0,)
        assert connection.execute("SELECT count(*) FROM embedding_profiles").fetchone() == (0,)
        assert connection.execute(
            "SELECT content_pack_id FROM documents ORDER BY id"
        ).fetchall() == [
            ("minimed.core.local",),
            ("minimed.core.local",),
        ]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        connection.close()
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["publishability"] == "local-dev"
    assert [item["documentId"] for item in payload["sources"]] == [
        "document.one",
        "document.two",
    ]


def test_rejects_duplicate_document_ids_before_output(tmp_path: Path) -> None:
    first = tmp_path / "first.db"
    second = tmp_path / "second.db"
    write_source(first, source_pack("pack.one", "document.one", "Первый текст"))
    write_source(second, source_pack("pack.two", "document.one", "Другой текст"))

    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"
    with pytest.raises(ValueError, match=r"Duplicate document document\.one"):
        compose_sqlite_packs(
            [first, second],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )
    assert not output.exists()
    assert not manifest.exists()


def test_rejects_identical_duplicate_document_ids_from_separate_packs(tmp_path: Path) -> None:
    first = tmp_path / "first.db"
    second = tmp_path / "second.db"
    pack = source_pack("pack.one", "document.one", "Первый текст")
    write_source(first, pack)
    write_source(
        second,
        pack.model_copy(update={"manifest": pack.manifest.model_copy(update={"id": "pack.two"})}),
    )

    with pytest.raises(ValueError, match=r"Duplicate document document\.one"):
        compose_sqlite_packs(
            [first, second],
            tmp_path / "core.db",
            tmp_path / "edition-manifest.json",
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )


def test_rejects_incompatible_source_pack_schema_version(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.old", "document.one", "Текст", schema_version=1))

    with pytest.raises(ValueError, match="schema version 1 != requested 2"):
        compose_sqlite_packs(
            [source],
            tmp_path / "core.db",
            tmp_path / "edition-manifest.json",
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )


def test_rejects_document_current_version_that_does_not_belong_to_document(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    connection = sqlite3.connect(source)
    try:
        connection.execute("UPDATE documents SET current_version_id = 'missing@1'")
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(ValueError, match="does not belong to document"):
        compose_sqlite_packs(
            [source],
            tmp_path / "core.db",
            tmp_path / "edition-manifest.json",
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )


def test_rejects_chunk_bound_to_another_document_section(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    first = source_pack("pack.one", "document.one", "Первый текст")
    second = source_pack("pack.one", "document.two", "Второй текст")
    combined = first.model_copy(
        update={"documents": [*first.documents, *second.documents], "aliases": []}
    )
    write_source(source, combined)
    connection = sqlite3.connect(source)
    try:
        connection.execute(
            "UPDATE chunks SET section_id = 'section.document.two' WHERE id = 'chunk.document.one'"
        )
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(ValueError, match="does not match its section document/version"):
        compose_sqlite_packs(
            [source],
            tmp_path / "core.db",
            tmp_path / "edition-manifest.json",
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )


def test_manifest_write_failure_preserves_existing_outputs(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"
    output.write_bytes(b"previous database")
    manifest.write_text("previous manifest\n", encoding="utf-8")

    def fail_manifest_write(_: Path, __: object) -> None:
        raise OSError("simulated manifest failure")

    with pytest.raises(OSError, match="simulated manifest failure"):
        compose_sqlite_packs(
            [source],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
            manifest_writer=fail_manifest_write,
        )
    assert output.read_bytes() == b"previous database"
    assert manifest.read_text(encoding="utf-8") == "previous manifest\n"


def test_rejects_output_inside_recursive_input_directory(tmp_path: Path) -> None:
    sources = tmp_path / "sources"
    sources.mkdir()
    write_source(sources / "source.db", source_pack("pack.one", "document.one", "Текст"))

    with pytest.raises(ValueError, match="must not be inside a recursive input directory"):
        compose_sqlite_packs(
            [sources],
            sources / "core.db",
            sources / "edition-manifest.json",
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )
