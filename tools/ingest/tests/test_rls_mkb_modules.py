from __future__ import annotations

import gzip
import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.builder import build_content_pack
from localmed_ingest.markdown_parser import parse_markdown_document
from localmed_ingest.mkb_reference_upgrade import upgrade_mkb_reference_database
from localmed_ingest.publication import PublicationDecision
from localmed_ingest.rls_mkb import (
    RlsMkbDetail,
    RlsMkbMedicine,
    RlsMkbPresentation,
    _detail_markdown,  # pyright: ignore[reportPrivateUsage]
    scrape_rls_mkb,
)
from localmed_ingest.rls_mkb_distribution import package_rls_mkb_modules
from localmed_ingest.rls_mkb_modules import (
    classification_path,
    split_rls_mkb_workspace,
)

INDEX_URL = "https://www.rlsnet.ru/mkb"
DETAIL_URL = "https://www.rlsnet.ru/mkb/i679"
DECISION = PublicationDecision(
    decided_at="2026-09-28", decided_by="project owner", basis="personal project"
)
PAGES = {
    INDEX_URL: """
    <div class='b-tree__collapse'>
      <a href='/mkb/i00'>I00-I99 КЛАСС IX Болезни системы кровообращения</a>
      <a href='/mkb/i60'>I60-I69 Цереброваскулярные болезни</a>
      <a href='/mkb/i67'>I67 Другие цереброваскулярные болезни</a>
      <a href='/mkb/i679'>I67.9 Цереброваскулярная болезнь неуточненная</a>
    </div>
    """.encode(),
    DETAIL_URL: """
    <h1>I67.9 Цереброваскулярная болезнь неуточненная, МКБ-10</h1>
    <div id='synonyms'><ul><li>ЦВБ</li><li>Хроническая ишемия мозга</li></ul></div>
    <div id='tableWithFilters-mkb'>
      <div id='tradenamesList' name='40'>
        <div id='headingOne'><a name='tradename-link' href='/drugs/example-one'>Абактал®</a></div>
        <div id='collapse40' data-name='mkb'></div>
      </div>
      <div id='tradenamesList' name='41'>
        <div id='headingOne'>
          <a name='tradename-link' href='/drugs/example-two'>Препарат Два</a>
        </div>
        <div id='collapse41' data-name='mkb'></div>
      </div>
    </div>
    """.encode(),
}
ROW = "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>"
PACKINGS = {
    "40": "<table><tbody>"
    + ROW.format("Пефлоксацин", "таблетки", "400 мг", "№10", "Завод Один")
    + ROW.format("Пефлоксацин", "раствор", "400 мг/100 мл", "№1", "Завод Два")
    + ROW.format("Пефлоксацин", "таблетки", "400 мг", "№10", "Завод Один")
    + "</tbody></table>",
    "41": "<table><tbody>"
    + ROW.format("Аскорбиновая кислота", "таблетки", "100 мг", "№20", "Завод Три")
    + "</tbody></table>",
}


def _scraped(root: Path) -> Path:
    workspace = root / "rls-mkb"
    scrape_rls_mkb(
        workspace,
        raw_output=root / "raw",
        classification_url=INDEX_URL,
        detail_urls=[DETAIL_URL],
        built_at="2026-08-14T00:00:00Z",
        fetcher=lambda url, _timeout: PAGES[url],
        packing_fetcher=lambda _url, tradename_id, _timeout: PACKINGS[tradename_id].encode(),
    )
    return workspace


def _rows(database: Path, sql: str) -> list[tuple[object, ...]]:
    connection = sqlite3.connect(database)
    try:
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


def _split_and_build(root: Path) -> tuple[Path, Path, Path]:
    source = _scraped(root)
    original = root / "original.db"
    build_content_pack(source, original, include_embeddings=False)
    split_rls_mkb_workspace(source, root / "code", root / "packaging", DECISION)
    compact = root / "compact.db"
    build_content_pack(root / "code", compact, include_embeddings=False)
    code = root / "code.db"
    upgrade_mkb_reference_database(compact, code)
    packaging = root / "packaging.db"
    build_content_pack(root / "packaging", packaging, include_embeddings=False)
    return original, code, packaging


def test_classification_path_orders_category_block_and_chapter() -> None:
    nodes = [
        ("A00-В99", "КЛАСС I"),
        ("A00-A09", "Кишечные инфекции"),
        ("A00", "Холера"),
        ("A00.0", "Холера классическая"),
    ]
    documents = {"rls.mkb.node.a00", "rls.mkb.node.a00-в99"}

    path = classification_path("A00.0", nodes, documents)

    assert [entry["code"] for entry in path] == ["A00", "A00-A09", "A00-В99"]
    assert path[0]["documentId"] == "rls.mkb.node.a00"
    assert "documentId" not in path[1]
    assert [entry["code"] for entry in classification_path("A00-A09", nodes, documents)] == [
        "A00-В99"
    ]


def test_compact_medicine_lines_never_cross_a_chunk_boundary(tmp_path: Path) -> None:
    inn = "Парацетамол + Фенилэфрин + Хлорфенамин + [Аскорбиновая кислота]"
    medicines = tuple(
        RlsMkbMedicine(
            tradename_id=str(index),
            name=f"Препарат с длинным названием номер {index}®",
            url=f"https://www.rlsnet.ru/drugs/example-{index}",
            presentations=(RlsMkbPresentation(inn, "таблетки", "1 мг", "№10", "Завод"),),
        )
        for index in range(80)
    )
    detail = RlsMkbDetail(
        code="J06.9",
        title="Острая инфекция верхних дыхательных путей неуточненная",
        url="https://www.rlsnet.ru/mkb/j069",
        checksum="sha256:" + "0" * 64,
        synonyms=(),
        medicines=medicines,
    )
    path = tmp_path / "rls.mkb.node.j06-9.md"
    path.write_text(_detail_markdown(detail, compact_medicines=True), encoding="utf-8")

    document = parse_markdown_document(path, extracted_at="2026-08-14T00:00:00Z")
    [section] = [item for item in document.sections if item.title == "Препараты на странице РЛС"]
    assert len(section.chunks) > 1
    for medicine in medicines:
        line = f"- {medicine.name} — МНН: {inn} — {medicine.url}"
        holders = [chunk for chunk in section.chunks if line in chunk.original_text]
        assert len(holders) == 1
        assert holders[0].metadata["sourceSpans"]


def test_split_keeps_cited_identities_and_moves_packaging_rows(tmp_path: Path) -> None:
    original, code, packaging = _split_and_build(tmp_path)

    kept_sections = (
        "SELECT s.anchor, c.id, c.anchor, c.original_text FROM sections s "
        "JOIN chunks c ON c.section_id = s.id "
        "WHERE s.title <> 'Препараты на странице РЛС' ORDER BY c.anchor"
    )
    assert _rows(code, kept_sections) == _rows(original, kept_sections)
    versions = "SELECT id, current_version_id FROM documents ORDER BY id"
    assert _rows(code, versions) == _rows(original, versions)

    medicines = _rows(
        code,
        "SELECT c.original_text FROM chunks c JOIN sections s ON s.id = c.section_id "
        "WHERE s.title = 'Препараты на странице РЛС'",
    )
    text = "\n".join(str(row[0]) for row in medicines)
    assert "Абактал® — МНН: Пефлоксацин — https://www.rlsnet.ru/drugs/example-one" in text
    assert "Завод" not in text

    assert _rows(code, "SELECT count(*) FROM knowledge_relations") == [(4,)]
    assert _rows(
        code,
        "SELECT count(*) FROM knowledge_evidence e JOIN chunks c ON c.id = e.chunk_id "
        "WHERE instr(c.original_text, e.evidence_quote) > 0",
    ) == [(4,)]
    [(brand_id, raw_profile)] = _rows(
        code,
        "SELECT entity_id, metadata_json FROM medication_profiles "
        "WHERE entity_id LIKE 'medication.brand.%' AND inn = 'Пефлоксацин'",
    )
    profile = json.loads(str(raw_profile))
    assert "presentations" not in profile
    assert profile["dosageForms"] == ["таблетки", "раствор"]
    assert profile["presentationCounts"] == {"40": 2}

    [(document_id, raw_metadata)] = _rows(
        packaging,
        "SELECT id, metadata_json FROM documents WHERE json_extract(metadata_json, "
        f"'$.medicationEntityId') = '{brand_id}'",
    )
    assert document_id == profile["packagingDocumentId"]
    metadata = json.loads(str(raw_metadata))
    assert metadata["mkbCodes"] == ["I67.9"]
    assert metadata["rightsStatus"] == "unknown"
    assert metadata["publicationState"] == "experimental-preview"
    table = "\n".join(
        str(row[0])
        for row in _rows(
            packaging,
            f"SELECT c.original_text FROM chunks c JOIN documents d "
            f"ON d.current_version_id = c.document_version_id WHERE d.id = '{document_id}'",
        )
    )
    assert table.count("| Пефлоксацин | таблетки | 400 мг | №10 | Завод Один |") == 1
    assert "| Пефлоксацин | раствор | 400 мг/100 мл | №1 | Завод Два |" in table


def _core(path: Path, code: Path) -> Path:
    [(version_id,)] = _rows(
        code, "SELECT current_version_id FROM documents WHERE id = 'rls.mkb.node.i67-9'"
    )
    [(class_version,)] = _rows(
        code, "SELECT current_version_id FROM documents WHERE id = 'rls.mkb.classification'"
    )
    [(chunk_id, anchor)] = _rows(
        code,
        "SELECT c.id, c.anchor FROM chunks c JOIN sections s ON s.id = c.section_id "
        "WHERE s.title LIKE 'I67 %'",
    )
    pointer = {
        "contentMode": "module-pointer",
        "targetDocumentId": "rls.mkb.node.i67-9",
        "primaryModuleId": "minimed.mkb.ru",
        "moduleIds": ["minimed.mkb.ru"],
        "sourceDocumentVersionId": version_id,
        "classificationPath": [
            {
                "code": "I67",
                "sourceDocumentId": "rls.mkb.classification",
                "sourceDocumentVersionId": class_version,
                "sourceChunkId": chunk_id,
                "sourceAnchor": anchor,
            }
        ],
    }
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE documents (id TEXT PRIMARY KEY, metadata_json TEXT)")
        connection.execute("INSERT INTO documents VALUES ('p1', ?)", (json.dumps(pointer),))
        connection.commit()
    finally:
        connection.close()
    return path


def test_package_writes_both_modules_and_verifies_cited_anchors(tmp_path: Path) -> None:
    _, code, packaging = _split_and_build(tmp_path)

    report = package_rls_mkb_modules(
        code,
        packaging,
        tmp_path / "out",
        version="2026.9.28",
        min_app_version="0.6.44",
        core_database=_core(tmp_path / "core.db", code),
    )

    code_report = report["code"]
    assert isinstance(code_report, dict)
    membership = code_report["pointerMembership"]
    assert membership["resolved"] == 1
    assert membership["citedAnchors"] == 1
    entry = json.loads(Path(str(code_report["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.mkb.ru"
    assert entry["collection"] == "conditions"
    assert entry["capabilities"]["structuredKnowledge"] is True
    assert entry["artifacts"][0]["url"].endswith(
        "/reference-rls-mkb-2026.9.28/minimed.reference.rls-mkb.2026.9.28.db.gz"
    )
    assert gzip.decompress(Path(str(code_report["archive"])).read_bytes()) == code.read_bytes()
    packaging_report = report["packaging"]
    assert isinstance(packaging_report, dict)
    packaging_entry = json.loads(
        Path(str(packaging_report["catalogEntry"])).read_text(encoding="utf-8")
    )
    assert packaging_entry["id"] == "minimed.rls.packaging.ru"
    assert packaging_entry["collection"] == "shared"
    assert packaging_entry["previewDocumentCount"] == 2


def test_package_refuses_a_cited_anchor_missing_from_the_pack(tmp_path: Path) -> None:
    _, code, packaging = _split_and_build(tmp_path)
    core = _core(tmp_path / "core.db", code)
    connection = sqlite3.connect(core)
    try:
        connection.execute(
            "UPDATE documents SET metadata_json = json_set(metadata_json, "
            "'$.classificationPath[0].sourceAnchor', 'gone#chunk-0')"
        )
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(ValueError, match="do not resolve exactly"):
        package_rls_mkb_modules(
            code,
            packaging,
            tmp_path / "out",
            version="2026.9.28",
            min_app_version="0.6.44",
            core_database=core,
        )
