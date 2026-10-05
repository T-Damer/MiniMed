from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from localmed_ingest.builder import build_content_pack
from localmed_ingest.icd11_distribution import package_icd11_module
from localmed_ingest.icd11_fetch import MANIFEST_NAME, MAPPING_NAME, TABULATION_NAME
from localmed_ingest.icd11_prepare import (
    document_id,
    parse_tabulation,
    prepare_icd11,
)
from localmed_ingest.publication import PublicationDecision

ENTITY = "http://id.who.int/icd/entity/"
RELEASE_URI = "http://id.who.int/icd/release/11/mms/"
DECISION = PublicationDecision(
    decided_at="2026-10-05", decided_by="project owner", basis="optional separate pack"
)
HEADER = "\t".join(
    [
        "Foundation URI",
        "Linearization URI",
        "Code",
        "BlockId",
        "TitleEN",
        "Title",
        "ClassKind",
        "DepthInKind",
        "IsResidual",
        "ChapterNo",
        "BrowserLink",
        "isLeaf",
        "Primary tabulation",
        "Grouping1",
        "Grouping2",
        "Grouping3",
        "Grouping4",
        "Grouping5",
        "CodingNote",
        "Parent",
        "Version:2026 Jan 17 - 05:30 UTC",
    ]
)


def _row(
    entity: str,
    *,
    code: str = "",
    block: str = "",
    en: str,
    ru: str,
    kind: str,
    chapter: str = "01",
    residual: bool = False,
    suffix: str = "",
    note: str = "",
    parent: str = "",
) -> str:
    fields = [
        ENTITY + entity,
        RELEASE_URI + entity + suffix,
        code,
        block,
        f'"- {en}"',
        f'"- {ru}"' if ru else "",
        kind,
        "1",
        str(residual),
        chapter,
        '"=hyperlink(""https://icd.who.int/browse/latestrelease/mms/en#x"",""browser"")"',
        "True",
        "True",
        "",
        "",
        "",
        "",
        "",
        note,
        ENTITY + parent if parent else "",
    ]
    return "\t".join(fields)


ROWS = [
    _row("100", en="Certain infectious", ru="Некоторые инфекционные болезни", kind="chapter"),
    _row(
        "200",
        block="BlockL1-1A0",
        en="Intestinal infections",
        ru="Кишечные инфекции",
        kind="block",
        parent="100",
    ),
    _row(
        "300",
        code="1A00",
        en="Cholera",
        ru="Холера",
        kind="category",
        parent="200",
        note="Первая строка указания\r\nвторая строка указания",
    ),
    _row(
        "300",
        code="1A0Y",
        en="Other specified cholera",
        ru="",
        kind="category",
        parent="300",
        residual=True,
        suffix="/other",
    ),
    _row(
        "400",
        code="XN8P1",
        en="Vibrio cholerae O1",
        ru="Vibrio cholerae О1",
        kind="category",
        chapter="X",
        parent="100",
    ),
]
TABULATION = (HEADER + "\r\n" + "\r\n".join(ROWS) + "\r\n").encode()

MAP_11_10 = (
    "Linearization (release) URI\ticd11Code\ticd11Chapter\ticd11Title\ticd10Code\ticd10Chapter\t"
    "icd10Title\t2026-Jan-17\r\n"
    "http://id.who.int/icd/release/11/2026-01/mms/300\t1A00\t01\tCholera\tA00.9\tI\t"
    "Cholera, unspecified\r\n"
)
MAP_10_11_HEADER = (
    "10ClassKind\t10DepthInKind\ticd10Code\ticd10Chapter\ticd10Title\t11ClassKind\t"
    "11DepthInKind\tICD-11 FoundationURI\tLinearization (releaseURI)\ticd11Code\ticd11Chapter\t"
    "icd11Title\t2026-Jan-17\r\n"
)
MAP_10_11_ONE = (
    MAP_10_11_HEADER
    + "category\t1\tA00.0\tI\tCholera due to Vibrio cholerae 01, biovar cholerae\tcategory\t1\t"
    + ENTITY
    + "300\thttp://id.who.int/icd/release/11/2026-01/mms/300\t1A00&XN8P1\t01\tCholera\r\n"
    + "category\t1\tZ99\tXXI\tNothing\tcategory\t1\t"
    + ENTITY
    + "999\thttp://id.who.int/icd/release/11/2026-01/mms/999\t9Z99\t01\tUnknown\r\n"
)
MAP_10_11_MULTI = (
    MAP_10_11_HEADER
    + "category\t1\tA00.1\tI\tCholera due to El Tor\tcategory\t1\t"
    + ENTITY
    + "300\thttp://id.who.int/icd/release/11/2026-01/mms/300\t1A00\t01\tCholera\r\n"
)


def _raw(root: Path, tabulation: bytes = TABULATION) -> Path:
    raw = root / "raw"
    raw.mkdir()
    for name, members in (
        (TABULATION_NAME, {"SimpleTabulation-ICD-11-MMS-ru.txt": tabulation}),
        (
            MAPPING_NAME,
            {
                "11To10MapToOneCategory.txt": MAP_11_10.encode(),
                "10To11MapToOneCategory.txt": MAP_10_11_ONE.encode(),
                "10To11MapToMultipleCategories.txt": MAP_10_11_MULTI.encode(),
            },
        ),
    ):
        with zipfile.ZipFile(raw / name, "w") as bundle:
            for member, payload in members.items():
                bundle.writestr(member, payload)
    manifest = {
        "release": "2026-01",
        "fetchedAt": "2026-10-05T20:00:00Z",
        "files": [
            {"name": name, "sha256": hashlib.sha256((raw / name).read_bytes()).hexdigest()}
            for name in (TABULATION_NAME, MAPPING_NAME)
        ],
    }
    (raw / MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
    return raw


def _mkb10(root: Path) -> Path:
    path = root / "mkb10.db"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE documents (id TEXT PRIMARY KEY)")
    connection.executemany(
        "INSERT INTO documents VALUES (?)", [("rls.mkb.node.a00-9",), ("rls.mkb.node.a00",)]
    )
    connection.commit()
    connection.close()
    return path


def _items(value: object) -> list[dict[str, object]]:
    assert isinstance(value, list)
    return [item for item in value if isinstance(item, dict)]


def _documents(database: Path) -> dict[str, tuple[str, dict[str, object], list[str]]]:
    connection = sqlite3.connect(database)
    try:
        result: dict[str, tuple[str, dict[str, object], list[str]]] = {}
        for identifier, title, raw in connection.execute(
            "SELECT id, title, metadata_json FROM documents"
        ):
            texts = [
                str(row[0])
                for row in connection.execute(
                    "SELECT c.original_text FROM chunks c JOIN document_versions v "
                    "ON v.id = c.document_version_id JOIN documents d "
                    "ON d.current_version_id = v.id WHERE d.id = ? ORDER BY c.order_index",
                    (identifier,),
                )
            ]
            result[str(identifier)] = (str(title), json.loads(raw), texts)
        return result
    finally:
        connection.close()


def test_tabulation_parser_keeps_embedded_breaks_and_english_only_titles() -> None:
    entities = parse_tabulation(TABULATION.decode())
    by_code = {entity.code: entity for entity in entities if entity.code}

    assert len(entities) == 5
    assert by_code["1A00"].coding_note == "Первая строка указания\nвторая строка указания"
    assert by_code["1A00"].title_ru == "Холера"
    assert by_code["1A0Y"].title_ru is None
    assert by_code["1A0Y"].entity_id == "300/other"
    assert by_code["1A0Y"].residual is True
    assert entities[0].kind == "chapter"
    assert entities[0].title_ru == "Некоторые инфекционные болезни"


def test_prepared_documents_are_icd11_only_and_source_exact(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    report = prepare_icd11(_raw(tmp_path), workspace, DECISION, mkb10_database=_mkb10(tmp_path))
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    documents = _documents(database)

    assert report.documents == 5
    assert (report.chapters, report.blocks, report.categories) == (1, 1, 3)
    assert report.english_only_titles == 1
    assert report.entities_with_icd10_closest == 1
    assert report.mapping_rows_unmatched["10To11MapToOneCategory.txt"] == 1
    assert report.icd10_links_resolved == 1 and report.icd10_links_unresolved == 2

    title, metadata, texts = documents[document_id("300")]
    assert title == "1A00 Холера, МКБ-11 (ВОЗ)"
    for key in ("mkbCode", "icd10Codes", "entityType", "terminology"):
        assert key not in metadata
    assert metadata["codingSystem"] == "icd-11"
    assert metadata["icd11Code"] == "1A00"
    assert metadata["rightsStatus"] == "cc-by-nd-3.0-igo"
    assert metadata["icd11LinearizationUri"] == RELEASE_URI + "300"
    path = _items(metadata["classificationPath"])
    assert path[0]["code"] == "BlockL1-1A0"
    assert path[-1]["documentId"] == document_id("100")
    by_relation = {item["relation"]: item for item in _items(metadata["crosswalkIcd10"])}
    assert by_relation["closest"]["icd10Code"] == "A00.9"
    assert by_relation["closest"]["icd10DocumentId"] == "rls.mkb.node.a00-9"
    assert "icd10DocumentId" not in by_relation["mapped-into-this"]  # no such ICD-10 card
    assert by_relation["mapped-into-this"]["icd11Cluster"] == "1A00&XN8P1"
    assert by_relation["mapped-into-this-multiple"]["icd10Code"] == "A00.1"

    text = "\n".join(texts)
    assert "Код МКБ-11: 1A00" in text
    assert "Первая строка указания" in text and "вторая строка указания" in text
    assert "1A00&XN8P1 (1A00 — Холера; XN8P1 — Vibrio cholerae О1)" in text
    assert "Нижестоящие рубрики" not in text  # only the residual child, which lists itself
    assert "Холера" in "\n".join(_documents(database)[document_id("200")][2])


def test_residual_row_without_russian_title_says_so_and_has_no_children(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    prepare_icd11(_raw(tmp_path), workspace, DECISION)
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    title, metadata, texts = _documents(database)[document_id("300/other")]

    assert title == "1A0Y Other specified cholera, МКБ-11 (ВОЗ)"
    assert metadata["icd11TitleLanguage"] == "en-source-only"
    assert "перевод не выполнялся" in "\n".join(texts)
    assert "Нижестоящие рубрики" not in "\n".join(texts)
    parent_titles = [item["title"] for item in _items(metadata["classificationPath"])]
    assert parent_titles[0] == "Холера"
    assert not (workspace / "300.md").exists()


def test_parents_list_their_children_in_file_order(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    prepare_icd11(_raw(tmp_path), workspace, DECISION)
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    _, _, chapter_texts = _documents(database)[document_id("100")]
    children = next(text for text in chapter_texts if text.startswith("- Блок"))

    assert children.splitlines() == ["- Блок: Кишечные инфекции", "- XN8P1 Vibrio cholerae О1"]
    _, chapter_metadata, _ = _documents(database)[document_id("100")]
    assert _items(chapter_metadata["childDocuments"]) == [
        {"documentId": document_id("200"), "label": "Блок: Кишечные инфекции"},
        {"documentId": document_id("400"), "label": "XN8P1 Vibrio cholerae О1"},
    ]


def test_changed_source_bytes_are_refused(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    with (raw / TABULATION_NAME).open("ab") as stream:
        stream.write(b"tampered")

    with pytest.raises(ValueError, match="SHA-256 differs"):
        prepare_icd11(raw, tmp_path / "workspace", DECISION)


def test_package_is_exact_and_refuses_icd10_keys(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    prepare_icd11(_raw(tmp_path), workspace, DECISION, mkb10_database=_mkb10(tmp_path))
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)

    report = package_icd11_module(
        database, tmp_path / "release", version="2026.10.5", min_app_version="0.6.49"
    )

    assert report["moduleId"] == "minimed.reference.icd11.ru"
    assert report["documents"] == 5
    assert report["classKinds"] == {"block": 1, "category": 3, "chapter": 1}
    assert report["englishOnlyTitles"] == 1
    entry = json.loads(Path(str(report["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["collection"] == "icd11"
    assert entry["documents"] == [] and entry["previewDocumentCount"] == 5
    assert entry["title"] == "МКБ-11 (ВОЗ), справочно; в РФ действует МКБ-10"
    assert entry["artifacts"][0]["url"].endswith(
        "/reference-icd11-2026.10.5/" + Path(str(report["archive"])).name
    )
    assert entry["tags"][:2] == ["icd-11", "who"]
    with gzip.open(str(report["archive"]), "rb") as decoded:
        assert (
            hashlib.sha256(decoded.read()).hexdigest() == str(report["sqliteSha256"]).split(":")[-1]
        )

    connection = sqlite3.connect(database)
    connection.execute(
        "UPDATE documents SET metadata_json = json_set(metadata_json, '$.mkbCode', 'A00') "
        "WHERE id = ?",
        (document_id("300"),),
    )
    connection.commit()
    connection.close()
    with pytest.raises(ValueError, match="ICD-10 key mkbCode"):
        package_icd11_module(
            database, tmp_path / "again", version="2026.10.5", min_app_version="0.6.49"
        )
