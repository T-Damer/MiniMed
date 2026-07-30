from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from localmed_ingest.instruction_card_drafts import export_instruction_card_drafts


def write_instruction_fixture(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE documents (
                id TEXT PRIMARY KEY, title TEXT, source_type TEXT, current_version_id TEXT
            );
            CREATE TABLE document_versions (
                id TEXT PRIMARY KEY, document_id TEXT, source_checksum TEXT
            );
            CREATE TABLE sections (
                id TEXT PRIMARY KEY, document_version_id TEXT, title TEXT,
                order_index INTEGER, anchor TEXT
            );
            CREATE TABLE chunks (
                id TEXT PRIMARY KEY, document_version_id TEXT, section_id TEXT,
                order_index INTEGER, original_text TEXT, anchor TEXT
            );
            INSERT INTO documents VALUES (
                'clean', 'Чистая инструкция', 'official_drug_instruction', 'clean@1'
            );
            INSERT INTO documents VALUES (
                'garbled', 'Поврежденная инструкция', 'official_drug_instruction', 'garbled@1'
            );
            INSERT INTO documents VALUES (
                'body', 'Маркер в теле', 'official_drug_instruction', 'body@1'
            );
            INSERT INTO documents VALUES (
                'toc', 'Оглавление', 'official_drug_instruction', 'toc@1'
            );
            INSERT INTO document_versions VALUES ('clean@1', 'clean', 'sha256:clean');
            INSERT INTO document_versions VALUES ('garbled@1', 'garbled', 'sha256:garbled');
            INSERT INTO document_versions VALUES ('body@1', 'body', 'sha256:body');
            INSERT INTO document_versions VALUES ('toc@1', 'toc', 'sha256:toc');
            INSERT INTO sections VALUES (
                'clean.use', 'clean@1', 'Показания к применению', 0, 'clean@1/use'
            );
            INSERT INTO sections VALUES (
                'clean.warning', 'clean@1', 'Противопоказания', 1, 'clean@1/warning'
            );
            INSERT INTO sections VALUES (
                'clean.adverse', 'clean@1', '4. Возможные нежелательные реакции.', 2,
                'clean@1/adverse'
            );
            INSERT INTO sections VALUES (
                'garbled.section', 'garbled@1', '4 8', 0, 'garbled@1/4-8'
            );
            INSERT INTO sections VALUES (
                'body.section', 'body@1', '4 8', 0, 'body@1/4-8'
            );
            INSERT INTO sections VALUES (
                'toc.section', 'toc@1', '4 8', 0, 'toc@1/4-8'
            );
            INSERT INTO chunks VALUES (
                'chunk.clean.use', 'clean@1', 'clean.use', 0, 'Исходная цитата показаний.',
                'clean@1/use#chunk-1'
            );
            INSERT INTO chunks VALUES (
                'chunk.clean.warning', 'clean@1', 'clean.warning', 0,
                'Исходная цитата предупреждения.',
                'clean@1/warning#chunk-1'
            );
            INSERT INTO chunks VALUES (
                'chunk.clean.adverse', 'clean@1', 'clean.adverse', 0, 'Исходная цитата реакции.',
                'clean@1/adverse#chunk-1'
            );
            INSERT INTO chunks VALUES (
                'chunk.garbled', 'garbled@1', 'garbled.section', 0,
                'Противопоказания упомянуты в тексте, но не в заголовке.',
                'garbled@1/4-8#chunk-1'
            );
            INSERT INTO chunks VALUES (
                'chunk.body', 'body@1', 'body.section', 0,
                '\n  4) Противопоказания:\n\nТекст после заголовка не захватывается.',
                'body@1/4-8#chunk-1'
            );
            INSERT INTO chunks VALUES (
                'chunk.toc', 'toc@1', 'toc.section', 0,
                '\nПротивопоказания\n.... 5\n', 'toc@1/4-8#chunk-1'
            );
            """
        )
        connection.commit()
    finally:
        connection.close()


def test_exports_exact_heading_matched_review_drafts(tmp_path: Path) -> None:
    source = tmp_path / "instructions.db"
    output = tmp_path / "instruction-card-drafts.jsonl"
    write_instruction_fixture(source)

    report = export_instruction_card_drafts(source, output)

    assert report.documents == 4
    assert report.group_coverage == {
        "identity": 0,
        "use": 1,
        "warning": 2,
        "administration": 0,
        "adverse-reaction": 1,
        "storage": 0,
    }
    drafts = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    clean = next(draft for draft in drafts if draft["document"]["id"] == "clean")
    assert clean["reviewStatus"] == "needs-review"
    assert clean["extractionRule"]["version"] == (
        "instruction-card-drafts-v2-heading-exact-body-marker"
    )
    assert clean["document"]["sourceChecksum"] == "sha256:clean"
    assert clean["groups"]["use"] == [
        {
            "documentId": "clean",
            "documentVersionId": "clean@1",
            "sectionId": "clean.use",
            "chunkId": "chunk.clean.use",
            "anchor": "clean@1/use#chunk-1",
            "quote": "Исходная цитата показаний.",
            "sectionAnchor": "clean@1/use",
        }
    ]
    assert "dose" not in json.dumps(clean, ensure_ascii=False).casefold()
    garbled = next(draft for draft in drafts if draft["document"]["id"] == "garbled")
    assert garbled["groups"] == {}
    assert garbled["missingGroups"] == [
        "identity",
        "use",
        "warning",
        "administration",
        "adverse-reaction",
        "storage",
    ]
    body = next(draft for draft in drafts if draft["document"]["id"] == "body")
    assert body["groups"]["warning"] == [
        {
            "documentId": "body",
            "documentVersionId": "body@1",
            "sectionId": "body.section",
            "chunkId": "chunk.body",
            "anchor": "body@1/4-8#chunk-1",
            "quote": "  4) Противопоказания:",
            "sectionAnchor": "body@1/4-8",
            "matchKind": "body-heading-marker",
            "startOffset": 1,
            "endOffset": 23,
        }
    ]
    assert "Текст после заголовка" not in json.dumps(body, ensure_ascii=False)
    toc = next(draft for draft in drafts if draft["document"]["id"] == "toc")
    assert toc["groups"] == {}
