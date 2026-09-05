from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.catalog_module_builder import build_core_catalog_pointers
from localmed_ingest.clinical_definition_migration_006 import (
    migrate_clinical_definition_database,
)
from localmed_ingest.models import (
    ContentPack,
    PackChunk,
    PackDocument,
    PackManifest,
    PackSection,
    PackVersion,
)
from localmed_ingest.sqlite_builder import write_sqlite_pack

VERSION = "2026.09.5"


def _source_pack(
    record_id: str, official_id: str, title: str, definition: dict[str, object]
) -> ContentPack:
    version_id = f"{record_id}@{official_id}"
    section_id = str(definition["sourceSectionId"])
    chunk_id = str(definition["sourceChunkId"])
    quote = str(definition["sourceQuote"])
    return ContentPack(
        manifest=PackManifest(
            id=f"source.{official_id}",
            version=official_id,
            schema_version=1,
            title=title,
            built_at="2026-09-05T00:00:00Z",
        ),
        documents=[
            PackDocument(
                id=record_id,
                title=title,
                short_title=title,
                source_type="clinical_recommendation",
                status="active",
                specialties=["general-medicine"],
                metadata={"officialId": official_id},
                version=PackVersion(
                    id=version_id,
                    label=official_id,
                    source_checksum=f"sha256:source-{official_id}",
                    extracted_at="2026-09-05T00:00:00Z",
                ),
                sections=[
                    PackSection(
                        id=section_id,
                        title=str(definition["sourceSectionTitle"]),
                        normalized_title="определение",
                        section_type="definition",
                        depth=1,
                        order_index=0,
                        page_start=3,
                        page_end=3,
                        anchor=str(definition["sourceAnchor"]),
                        section_path=[str(definition["sourceSectionTitle"])],
                        chunks=[
                            PackChunk(
                                id=chunk_id,
                                order_index=0,
                                original_text=quote,
                                normalized_text=quote.casefold(),
                                page_start=3,
                                page_end=3,
                                anchor=str(definition["sourceAnchor"]),
                                metadata={"sourceSpans": []},
                            )
                        ],
                    )
                ],
            )
        ],
    )


def _fixture(tmp_path: Path, *, mismatch: bool = False) -> tuple[Path, Path, Path, Path]:
    official_root = tmp_path / "official-clinical-documents"
    database_root = official_root / "databases"
    database_root.mkdir(parents=True)
    records: list[dict[str, object]] = []
    core_documents: list[PackDocument] = []
    definitions: list[dict[str, object]] = []
    for index in range(2):
        record_id = f"kr.rf.test{index}"
        official_id = f"test{index}"
        title = f"Тестовое состояние {index}"
        section_id = f"section.source{index}"
        chunk_id = f"chunk.source{index}"
        anchor = f"{record_id}@{official_id}/определение#chunk-source{index}"
        text = f"характеристика состояния номер {index}."
        definition: dict[str, object] = {
            "definitionId": f"clinical.definition.test{index}",
            "text": text,
            "sourceDocumentId": record_id,
            "sourceDocumentVersionId": f"{record_id}@{official_id}",
            "sourceSectionId": section_id,
            "sourceChunkId": chunk_id,
            "sourceAnchor": anchor,
            "sourceSectionTitle": "Термины и определения",
            "sourceQuote": f"{title} – {text}",
            "pageStart": 3,
            "pageEnd": 3,
            "charStart": None,
            "charEnd": None,
            "sourceSpans": [],
        }
        source_path = database_root / f"{official_id}.db"
        write_sqlite_pack(
            _source_pack(record_id, official_id, title, definition), source_path, vacuum=False
        )
        definitions.append(definition)
        records.append(
            {
                "recordId": record_id,
                "officialId": official_id,
                "title": title,
                "versionLabel": official_id,
                "status": "active",
                "primaryModuleId": "minimed.clinical.test.ru",
                "moduleIds": ["minimed.clinical.test.ru"],
                "canonicalDefinition": definition,
            }
        )

    ledger = {
        "schemaVersion": 1,
        "generatedAt": "2026-09-05T00:00:00Z",
        "records": records,
        "modules": [
            {
                "moduleId": "minimed.clinical.test.ru",
                "title": "Тест",
                "recordIds": [record["recordId"] for record in records],
            }
        ],
    }
    if mismatch:
        cast_definition = definitions[1]
        cast_definition["sourceAnchor"] = "wrong-anchor"
    ledger_path = tmp_path / "ledger.json"
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False), encoding="utf-8")
    pointer_root = tmp_path / "pointers"
    build_core_catalog_pointers(
        ledger_path,
        pointer_root,
        family="clinical",
        version=VERSION,
        built_at="2026-09-05T00:00:00Z",
    )

    from localmed_ingest.markdown_parser import parse_markdown_document

    staged = sorted((pointer_root / "minimed.core.ru").glob("*.md"))
    parsed = [parse_markdown_document(path, extracted_at="2026-09-05T00:00:00Z") for path in staged]
    core_documents = []
    for document in parsed:
        target_id = str(document.metadata["targetDocumentId"])
        index = int(target_id[-1])
        info = PackSection(
            id=f"section.core{index}",
            title="Сведения о документе",
            normalized_title="сведения о документе",
            section_type="other",
            depth=1,
            order_index=0,
            anchor=f"stable/{index}/section",
            section_path=["Сведения о документе"],
            chunks=[
                PackChunk(
                    id=f"chunk.core{index}",
                    order_index=0,
                    original_text=f"Старый указатель {index}",
                    normalized_text=f"старый указатель {index}",
                    anchor=f"stable/{index}/chunk",
                    metadata={"kept": True},
                )
            ],
        )
        metadata = dict(document.metadata)
        if index == 0:
            metadata["canonicalDefinition"] = definitions[0]
            metadata["definitionPreviewAnchor"] = "old/definition"
        else:
            metadata["canonicalDefinition"] = None
        core_documents.append(
            document.model_copy(update={"metadata": metadata, "sections": [info]})
        )
    core = tmp_path / "core.db"
    write_sqlite_pack(
        ContentPack(
            manifest=PackManifest(
                id="minimed.core.ru",
                version=VERSION,
                schema_version=1,
                title="Ядро",
                built_at="2026-09-05T00:00:00Z",
            ),
            documents=core_documents,
        ),
        core,
        vacuum=False,
    )
    return core, pointer_root, ledger_path, official_root


def test_migration_preserves_existing_and_adds_searchable_definition(tmp_path: Path) -> None:
    core, pointers, ledger, official_root = _fixture(tmp_path)
    output = tmp_path / "output.db"
    before = sqlite3.connect(core)
    old_chunk = before.execute(
        "SELECT original_text, anchor FROM chunks WHERE id = 'chunk.core0'"
    ).fetchone()
    old_definition = json.loads(
        before.execute(
            "SELECT metadata_json FROM documents "
            "WHERE json_extract(metadata_json, '$.targetDocumentId') = 'kr.rf.test0'"
        ).fetchone()[0]
    )["canonicalDefinition"]
    before.close()

    report = migrate_clinical_definition_database(core, pointers, ledger, official_root, output)
    assert report["definitionsAdded"] == 1
    assert report["definitionsPreserved"] == 1
    checksums = report["sourceChecksums"]
    assert isinstance(checksums, dict)
    versions = checksums["documentVersions"]
    assert isinstance(versions, dict)
    assert versions["kr.rf.test1"] == "sha256:source-test1"
    connection = sqlite3.connect(output)
    assert (
        connection.execute(
            "SELECT original_text, anchor FROM chunks WHERE id = 'chunk.core0'"
        ).fetchone()
        == old_chunk
    )
    assert (
        json.loads(
            connection.execute(
                "SELECT metadata_json FROM documents "
                "WHERE json_extract(metadata_json, '$.targetDocumentId') = 'kr.rf.test0'"
            ).fetchone()[0]
        )["canonicalDefinition"]
        == old_definition
    )
    added = connection.execute(
        "SELECT original_text, anchor FROM chunks "
        "WHERE original_text LIKE '%характеристика состояния номер 1%'"
    ).fetchone()
    assert added is not None
    assert (
        connection.execute(
            "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'характеристика'"
        ).fetchone()[0]
        >= 1
    )
    connection.close()


def test_migration_rejects_source_anchor_mismatch(tmp_path: Path) -> None:
    core, pointers, ledger, official_root = _fixture(tmp_path, mismatch=True)
    with pytest.raises(ValueError, match="anchor mismatch"):
        migrate_clinical_definition_database(
            core, pointers, ledger, official_root, tmp_path / "rejected.db"
        )
