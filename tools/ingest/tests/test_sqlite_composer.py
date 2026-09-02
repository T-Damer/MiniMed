from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest

import localmed_ingest.sqlite_composer as sqlite_composer
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


def add_knowledge_rows(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executemany(
            """INSERT INTO knowledge_entities(
                id, entity_type, canonical_name, normalized_name,
                external_ids_json, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            [
                ("entity.one", "condition", "Первое состояние", "первое состояние", "{}", "{}"),
                ("entity.two", "medication", "Второй препарат", "второй препарат", "{}", "{}"),
                ("entity.names-only", "condition", "Только имя", "только имя", "{}", "{}"),
            ],
        )
        connection.execute(
            """INSERT INTO knowledge_names(
                id, entity_id, name, normalized_name, language, name_type, weight
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            ("name.one", "entity.one", "Первое", "первое", "ru", "short", 1.0),
        )
        connection.executemany(
            """INSERT INTO knowledge_facts(
                id, entity_id, fact_type, original_text, structured_json,
                population_json, approval_status, authority_tier, review_status,
                jurisdiction, confidence, valid_from, valid_to, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    "fact.reviewed",
                    "entity.one",
                    "indication",
                    "Точный текст",
                    "{}",
                    "{}",
                    "approved",
                    "clinical-recommendation",
                    "reviewed",
                    "RU",
                    1.0,
                    None,
                    None,
                    "{}",
                ),
                (
                    "fact.proposed",
                    "entity.one",
                    "ignored",
                    "Не должен попасть",
                    "{}",
                    "{}",
                    "proposed",
                    "clinical-recommendation",
                    "proposed",
                    "RU",
                    1.0,
                    None,
                    None,
                    "{}",
                ),
            ],
        )
        connection.executemany(
            """INSERT INTO knowledge_relations(
                id, subject_entity_id, predicate, object_entity_id, relation_status,
                authority_tier, review_status, jurisdiction, final_weight,
                weight_components_json, valid_from, valid_to, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    "relation.reviewed",
                    "entity.one",
                    "связан",
                    "entity.two",
                    "related",
                    "clinical-recommendation",
                    "reviewed",
                    "RU",
                    1.0,
                    "{}",
                    None,
                    None,
                    "{}",
                ),
                (
                    "relation.reference",
                    "entity.two",
                    "справочно",
                    "entity.one",
                    "reference-only",
                    "professional-reference",
                    "proposed",
                    "RU",
                    0.5,
                    "{}",
                    None,
                    None,
                    "{}",
                ),
            ],
        )
        connection.commit()
    finally:
        connection.close()


def test_composes_explicit_directory_into_one_local_edition(tmp_path: Path) -> None:
    sources = tmp_path / "sources"
    sources.mkdir()
    write_source(sources / "one.db", source_pack("pack.one", "document.one", "Первый текст"))
    write_source(sources / "two.db", source_pack("pack.two", "document.two", "Второй текст"))
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"
    checkpoint_temp = tmp_path / "..core.db.checkpoint.json.tmp-stale"
    checkpoint_temp.write_text("stale", encoding="utf-8")

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
    assert not (tmp_path / ".core.db.stage").exists()
    assert not (tmp_path / ".core.db.checkpoint.json").exists()
    assert not (tmp_path / ".edition-manifest.json.stage").exists()
    assert not (tmp_path / ".core.db.stage-journal").exists()
    assert not checkpoint_temp.exists()
    assert not list(tmp_path.glob("..core.db.checkpoint.json.tmp-*"))


def test_composed_schema_and_fts_match_source_contract(tmp_path: Path) -> None:
    first = tmp_path / "first.db"
    second = tmp_path / "second.db"
    write_source(first, source_pack("pack.one", "document.one", "Первый текст"))
    write_source(second, source_pack("pack.two", "document.two", "Второй текст"))
    output = tmp_path / "core.db"

    compose_sqlite_packs(
        [first, second],
        output,
        tmp_path / "edition-manifest.json",
        edition_id="minimed.core.local",
        edition_version="1",
        title="Local candidate",
        built_at="2026-07-29T00:00:00Z",
    )

    def schema_objects(path: Path) -> list[tuple[str, str, str | None]]:
        connection = sqlite3.connect(path)
        try:
            return connection.execute(
                """SELECT type, name, sql
                FROM sqlite_master
                WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_autoindex%'
                ORDER BY type, name"""
            ).fetchall()
        finally:
            connection.close()

    assert schema_objects(output) == schema_objects(first)
    connection = sqlite3.connect(output)
    source_connections = [sqlite3.connect(path) for path in (first, second)]
    try:
        for spec in sqlite_composer.TABLES:
            columns = ", ".join(spec.columns)
            composed_rows = cast(
                list[tuple[object, ...]],
                connection.execute(f"SELECT {columns} FROM {spec.name}").fetchall(),
            )
            source_rows: list[tuple[object, ...]] = []
            for source_connection in source_connections:
                source_rows.extend(
                    cast(
                        list[tuple[object, ...]],
                        source_connection.execute(f"SELECT {columns} FROM {spec.name}").fetchall(),
                    )
                )
            assert sorted(composed_rows, key=repr) == sorted(source_rows, key=repr), spec.name

        assert connection.execute(
            """SELECT chunk_id, document_id, document_version_id, section_id, anchor,
                      title, section_path, normalized_text
               FROM chunks_fts ORDER BY rowid"""
        ).fetchall() == [
            (
                "chunk.document.one",
                "document.one",
                "document.one@1",
                "section.document.one",
                "document.one@1/contraindications#chunk-1",
                "document.one",
                "Противопоказания",
                "первый текст",
            ),
            (
                "chunk.document.two",
                "document.two",
                "document.two@1",
                "section.document.two",
                "document.two@1/contraindications#chunk-1",
                "document.two",
                "Противопоказания",
                "второй текст",
            ),
        ]
    finally:
        connection.close()
        for source_connection in source_connections:
            source_connection.close()


def test_composed_knowledge_fts_keeps_review_projection_rules(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    add_knowledge_rows(source)
    output = tmp_path / "core.db"

    compose_sqlite_packs(
        [source],
        output,
        tmp_path / "edition-manifest.json",
        edition_id="minimed.core.local",
        edition_version="1",
        title="Local candidate",
        built_at="2026-07-29T00:00:00Z",
    )

    connection = sqlite3.connect(output)
    try:
        assert connection.execute(
            """SELECT entity_id, canonical_name, aliases, facts, relations
               FROM knowledge_fts ORDER BY entity_id"""
        ).fetchall() == [
            (
                "entity.one",
                "Первое состояние",
                "Первое состояние Первое",
                "indication Точный текст",
                "Второй препарат справочно Первое состояние reference-only "
                "Первое состояние связан Второй препарат related",
            ),
            (
                "entity.two",
                "Второй препарат",
                "Второй препарат",
                "",
                "Второй препарат справочно Первое состояние reference-only "
                "Первое состояние связан Второй препарат related",
            ),
        ]
        assert connection.execute(
            "SELECT count(*) FROM knowledge_fts WHERE knowledge_fts MATCH 'не'"
        ).fetchone() == (0,)
    finally:
        connection.close()


@pytest.mark.parametrize("domain", ["chunks", "knowledge"])
def test_fts_validation_has_bounded_vm_work(tmp_path: Path, domain: str) -> None:
    source = tmp_path / "source.db"
    pack = source_pack("pack.one", "document.one", "Текст")
    if domain == "chunks":
        section = pack.documents[0].sections[0]
        chunk = section.chunks[0]
        section.chunks = [
            chunk.model_copy(update={"id": f"chunk.{i}", "order_index": i, "anchor": f"a.{i}"})
            for i in range(1_000)
        ]
    write_source(source, pack)
    if domain == "knowledge":
        add_knowledge_rows(source)
    connection = sqlite3.connect(source)
    try:
        if domain == "knowledge":
            connection.executemany(
                """INSERT INTO knowledge_entities
                SELECT ?, entity_type, canonical_name, normalized_name,
                       external_ids_json, metadata_json
                FROM knowledge_entities WHERE id = 'entity.one'""",
                [(f"entity.{i}",) for i in range(1_000)],
            )
            connection.executemany(
                """INSERT INTO knowledge_facts
                SELECT ?, ?, fact_type, original_text, structured_json, population_json,
                       approval_status, authority_tier, review_status, jurisdiction,
                       confidence, valid_from, valid_to, metadata_json
                FROM knowledge_facts WHERE id = 'fact.reviewed'""",
                [(f"fact.{i}", f"entity.{i}") for i in range(1_000)],
            )
            rebuild = cast(
                Callable[[sqlite3.Connection], None],
                sqlite_composer.__dict__["_rebuild_knowledge_fts"],
            )
            rebuild(connection)
        ticks = 0

        def vm_budget() -> int:
            nonlocal ticks
            ticks += 1
            return int(ticks > 1_000)

        connection.set_progress_handler(vm_budget, 1_000)
        validate = cast(
            Callable[[sqlite3.Connection], None], sqlite_composer.__dict__["_validate_fts"]
        )
        validate(connection)
    finally:
        connection.set_progress_handler(None, 0)
        connection.close()


@pytest.mark.parametrize("domain", ["chunks", "knowledge"])
@pytest.mark.parametrize("damage", ["missing", "duplicate", "orphan", "null", "replacement"])
def test_fts_validation_rejects_mismatched_ids(tmp_path: Path, domain: str, damage: str) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    add_knowledge_rows(source)
    connection = sqlite3.connect(source)
    try:
        rebuild = cast(
            Callable[[sqlite3.Connection], None],
            sqlite_composer.__dict__["_rebuild_knowledge_fts"],
        )
        rebuild(connection)
        table, key, identifier = {
            "chunks": ("chunks_fts", "chunk_id", "chunk.document.one"),
            "knowledge": ("knowledge_fts", "entity_id", "entity.one"),
        }[domain]
        if damage == "missing":
            connection.execute(f"DELETE FROM {table} WHERE {key} = ?", (identifier,))
        elif damage == "replacement":
            connection.execute(
                f"UPDATE {table} SET {key} = 'unexpected' WHERE {key} = ?", (identifier,)
            )
        else:
            value = {"duplicate": identifier, "orphan": "unexpected", "null": None}[damage]
            connection.execute(f"INSERT INTO {table}({key}) VALUES (?)", (value,))
        validate = cast(
            Callable[[sqlite3.Connection], None], sqlite_composer.__dict__["_validate_fts"]
        )
        with pytest.raises(ValueError, match=f"Composed {domain} FTS"):
            validate(connection)
    finally:
        connection.close()


@pytest.mark.parametrize("damage", [None, "digest", "fts"])
def test_resume_finalized_stage_does_not_rebuild_and_still_validates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, damage: str | None
) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"

    def interrupt_validation(_: sqlite3.Connection) -> None:
        raise KeyboardInterrupt

    with monkeypatch.context() as interrupted:
        interrupted.setattr(sqlite_composer, "_validate_fts", interrupt_validation)
        with pytest.raises(KeyboardInterrupt):
            compose_sqlite_packs(
                [source],
                output,
                manifest,
                edition_id="minimed.core.local",
                edition_version="1",
                title="Local candidate",
                built_at="2026-07-29T00:00:00Z",
            )
    stage = tmp_path / ".core.db.stage"
    checkpoint = tmp_path / ".core.db.checkpoint.json"
    assert stage.exists() and checkpoint.exists()
    if damage:
        with sqlite3.connect(stage) as connection:
            if damage == "digest":
                connection.execute("DELETE FROM app_metadata WHERE key = 'source_set_digest'")
            else:
                connection.execute("UPDATE chunks_fts SET chunk_id = 'unexpected'")
    stage_bytes = stage.read_bytes()

    def no_rebuild(*_: object) -> str:
        pytest.fail("A committed finalized stage must not rebuild its indexes")

    monkeypatch.setattr(sqlite_composer, "_finalize_staging_database", no_rebuild)
    if damage:
        with pytest.raises(ValueError, match=r"digest|Composed chunks FTS"):
            compose_sqlite_packs(
                [source],
                output,
                manifest,
                edition_id="minimed.core.local",
                edition_version="1",
                title="Local candidate",
                built_at="2026-07-29T00:00:00Z",
                resume=True,
            )
        assert stage.read_bytes() == stage_bytes
        assert checkpoint.exists() and not output.exists()
    else:
        report = compose_sqlite_packs(
            [source],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
            resume=True,
        )
        assert report.sqlite_integrity == "ok"
        assert output.read_bytes() == stage_bytes
        assert manifest.exists() and not stage.exists() and not checkpoint.exists()


def test_interrupted_composition_resumes_and_skips_validated_prefix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = tmp_path / "first.db"
    second = tmp_path / "second.db"
    write_source(first, source_pack("pack.one", "document.one", "Первый текст"))
    write_source(second, source_pack("pack.two", "document.two", "Второй текст"))
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"

    original_checkpoint = cast(
        Callable[[Path, dict[str, object]], None],
        sqlite_composer.__dict__["_write_checkpoint"],
    )

    def interrupt_after_first(path: Path, payload: dict[str, object]) -> None:
        original_checkpoint(path, payload)
        if payload["nextModule"] == 1:
            raise KeyboardInterrupt

    monkeypatch.setattr("localmed_ingest.sqlite_composer._write_checkpoint", interrupt_after_first)
    with pytest.raises(KeyboardInterrupt):
        compose_sqlite_packs(
            [first, second],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )

    stage = tmp_path / ".core.db.stage"
    checkpoint = tmp_path / ".core.db.checkpoint.json"
    assert stage.exists()
    assert checkpoint.exists()
    assert not output.exists()

    validation_calls: list[Path] = []
    original_validate = cast(
        Callable[[sqlite3.Connection, Path, int], None],
        sqlite_composer.__dict__["_validate_input"],
    )

    def record_validation(connection: sqlite3.Connection, path: Path, schema_version: int) -> None:
        validation_calls.append(path)
        original_validate(connection, path, schema_version)

    monkeypatch.setattr("localmed_ingest.sqlite_composer._validate_input", record_validation)
    report = compose_sqlite_packs(
        [first, second],
        output,
        manifest,
        edition_id="minimed.core.local",
        edition_version="1",
        title="Local candidate",
        built_at="2026-07-29T00:00:00Z",
        resume=True,
    )

    assert report.documents == 2
    assert validation_calls == [second.resolve()]
    assert not stage.exists()
    assert not checkpoint.exists()


def test_resume_rejects_configuration_mismatch_and_keeps_stage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"
    original_checkpoint = cast(
        Callable[[Path, dict[str, object]], None],
        sqlite_composer.__dict__["_write_checkpoint"],
    )

    def interrupt_after_checkpoint(path: Path, payload: dict[str, object]) -> None:
        original_checkpoint(path, payload)
        if payload["nextModule"] == 1:
            raise KeyboardInterrupt

    monkeypatch.setattr(
        "localmed_ingest.sqlite_composer._write_checkpoint", interrupt_after_checkpoint
    )
    with pytest.raises(KeyboardInterrupt):
        compose_sqlite_packs(
            [source],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )

    with pytest.raises(ValueError, match="Resume configuration"):
        compose_sqlite_packs(
            [source],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="2",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
            resume=True,
        )
    assert (tmp_path / ".core.db.stage").exists()
    assert (tmp_path / ".core.db.checkpoint.json").exists()


def test_resume_rejects_changed_input_fingerprint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"
    original_checkpoint = cast(
        Callable[[Path, dict[str, object]], None],
        sqlite_composer.__dict__["_write_checkpoint"],
    )

    def interrupt_after_checkpoint(path: Path, payload: dict[str, object]) -> None:
        original_checkpoint(path, payload)
        if payload["nextModule"] == 1:
            raise KeyboardInterrupt

    monkeypatch.setattr(
        "localmed_ingest.sqlite_composer._write_checkpoint", interrupt_after_checkpoint
    )
    with pytest.raises(KeyboardInterrupt):
        compose_sqlite_packs(
            [source],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )

    connection = sqlite3.connect(source)
    try:
        connection.execute("UPDATE chunks SET original_text = 'Изменённый текст'")
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(ValueError, match="Resume inputs"):
        compose_sqlite_packs(
            [source],
            output,
            manifest,
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
            resume=True,
        )
    assert not output.exists()
    assert (tmp_path / ".core.db.stage").exists()
    assert (tmp_path / ".core.db.checkpoint.json").exists()


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


def test_allows_identical_shared_rows_and_rejects_conflicts(tmp_path: Path) -> None:
    first = tmp_path / "first.db"
    second = tmp_path / "second.db"
    shared = Alias(id="alias.shared", canonical_term="общий", alias="общий")
    first_pack = source_pack("pack.one", "document.one", "Первый текст").model_copy(
        update={"aliases": [shared]}
    )
    second_pack = source_pack("pack.two", "document.two", "Второй текст").model_copy(
        update={"aliases": [shared]}
    )
    write_source(first, first_pack)
    write_source(second, second_pack)

    output = tmp_path / "core.db"
    compose_sqlite_packs(
        [first, second],
        output,
        tmp_path / "edition-manifest.json",
        edition_id="minimed.core.local",
        edition_version="1",
        title="Local candidate",
        built_at="2026-07-29T00:00:00Z",
    )
    connection = sqlite3.connect(output)
    try:
        assert connection.execute("SELECT count(*) FROM aliases").fetchone() == (1,)
    finally:
        connection.close()

    conflicting = second_pack.model_copy(
        update={"aliases": [shared.model_copy(update={"alias": "другой"})]}
    )
    write_source(second, conflicting)
    with pytest.raises(ValueError, match=r"Conflicting aliases row"):
        compose_sqlite_packs(
            [first, second],
            tmp_path / "conflict.db",
            tmp_path / "conflict-manifest.json",
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


def test_staged_pair_rolls_back_on_keyboard_interrupt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    staged_database = tmp_path / ".core.db.stage"
    staged_manifest = tmp_path / ".edition-manifest.json.stage"
    output = tmp_path / "core.db"
    manifest = tmp_path / "edition-manifest.json"
    staged_database.write_bytes(b"new database")
    staged_manifest.write_bytes(b"new manifest")
    output.write_bytes(b"previous database")
    manifest.write_bytes(b"previous manifest")

    original_replace = cast(Callable[[Path, Path], Path], Path.replace)

    def interrupt_manifest_install(source: Path, target: Path) -> Path:
        if source == staged_manifest:
            raise KeyboardInterrupt
        return original_replace(source, target)

    monkeypatch.setattr(Path, "replace", interrupt_manifest_install)
    replace_pair = cast(
        Callable[[Path, Path, Path, Path], None],
        sqlite_composer.__dict__["_replace_staged_pair"],
    )
    with pytest.raises(KeyboardInterrupt):
        replace_pair(staged_database, staged_manifest, output, manifest)

    assert output.read_bytes() == b"previous database"
    assert manifest.read_bytes() == b"previous manifest"
    assert not list(tmp_path.glob(".core.db.backup-*"))
    assert not list(tmp_path.glob(".edition-manifest.json.backup-*"))


def test_rejects_input_table_without_unique_key(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Текст"))
    connection = sqlite3.connect(source)
    try:
        connection.execute("DROP INDEX IF EXISTS idx_aliases_alias")
        connection.execute("ALTER TABLE aliases RENAME TO aliases_original")
        connection.execute(
            """CREATE TABLE aliases(
                id TEXT NOT NULL,
                canonical_term TEXT NOT NULL,
                alias TEXT NOT NULL,
                category TEXT,
                weight REAL NOT NULL
            )"""
        )
        connection.execute(
            """INSERT INTO aliases(id, canonical_term, alias, category, weight)
               SELECT id, canonical_term, alias, category, weight FROM aliases_original"""
        )
        connection.execute("DROP TABLE aliases_original")
        connection.execute("CREATE INDEX idx_aliases_alias ON aliases(alias)")
        connection.execute(
            """INSERT INTO aliases(id, canonical_term, alias, category, weight)
               SELECT id, canonical_term, alias || ' duplicate', category, weight
               FROM aliases LIMIT 1"""
        )
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(ValueError, match="lacks a unique key for aliases"):
        compose_sqlite_packs(
            [source],
            tmp_path / "core.db",
            tmp_path / "edition-manifest.json",
            edition_id="minimed.core.local",
            edition_version="1",
            title="Local candidate",
            built_at="2026-07-29T00:00:00Z",
        )
    assert not (tmp_path / "core.db").exists()


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


def test_chunk_source_query_scans_source_rows_without_sort_or_full_row_lookup(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.db"
    write_source(source, source_pack("pack.one", "document.one", "Первый текст"))
    connection = sqlite3.connect(source)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN")
        connection.execute(
            "UPDATE chunks SET next_chunk_id = ? WHERE id = ?",
            ("chunk.a", "chunk.document.one"),
        )
        connection.executemany(
            """INSERT INTO chunks(
                id, document_version_id, section_id, order_index, original_text,
                normalized_text, page_start, page_end, char_start, char_end,
                previous_chunk_id, next_chunk_id, anchor, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    "chunk.z",
                    "document.one@1",
                    "section.document.one",
                    1,
                    "Текст z",
                    "текст z",
                    None,
                    None,
                    None,
                    None,
                    "chunk.a",
                    None,
                    "document.one@1/contraindications#chunk-z",
                    "{}",
                ),
                (
                    "chunk.a",
                    "document.one@1",
                    "section.document.one",
                    1,
                    "Текст a",
                    "текст a",
                    None,
                    None,
                    None,
                    None,
                    "chunk.document.one",
                    "chunk.z",
                    "document.one@1/contraindications#chunk-a",
                    "{}",
                ),
            ],
        )
        connection.commit()
    finally:
        connection.close()

    connection = sqlite3.connect(":memory:")
    try:
        connection.execute("ATTACH DATABASE ? AS source", (str(source),))
        spec = next(spec for spec in sqlite_composer.TABLES if spec.name == "chunks")
        query = sqlite_composer._source_query(spec, "source")
        plan = [str(row[3]) for row in connection.execute(f"EXPLAIN QUERY PLAN {query}").fetchall()]
        assert "NOT INDEXED" in query
        assert "d.current_version_id = c.document_version_id" in query
        assert any(detail == "SCAN c" for detail in plan)
        assert not any("USE TEMP B-TREE FOR ORDER BY" in detail for detail in plan)
        assert not any(detail.startswith("SEARCH c USING") for detail in plan)

        rows = connection.execute(query).fetchall()
        assert [(row[0], row[3], row[10], row[11]) for row in rows] == [
            ("chunk.document.one", 0, None, "chunk.a"),
            ("chunk.z", 1, "chunk.a", None),
            ("chunk.a", 1, "chunk.document.one", "chunk.z"),
        ]
    finally:
        connection.close()
