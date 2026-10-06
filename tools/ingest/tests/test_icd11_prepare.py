from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import threading
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from localmed_ingest.builder import build_content_pack
from localmed_ingest.icd11_api_fetch import API_DIRECTORY, fetch_icd11_api, require_loopback
from localmed_ingest.icd11_api_text import classify_text, load_api_text, parse_api_entity
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


API_FIXTURES = Path(__file__).parent / "fixtures" / "icd11-api"
IMAGE = "whoicd/icd-api@sha256:" + "0" * 64
DATA_RELEASE = "cloud_2026-01-17_release-icf-mms_en-ru"


def _fixture(name: str) -> bytes:
    return (API_FIXTURES / f"{name}.json").read_bytes()


def _for_entity(name: str, entity_id: str) -> bytes:
    """A real cached answer, re-addressed to a synthetic test entity (only `@id` changes)."""
    payload = json.loads(_fixture(name))
    payload["@id"] = f"http://id.who.int/icd/release/11/2026-01/mms/{entity_id}"
    return json.dumps(payload, ensure_ascii=False).encode()


def _plain(entity_id: str, title: str) -> bytes:
    return json.dumps(
        {
            "@id": f"http://id.who.int/icd/release/11/2026-01/mms/{entity_id}",
            "title": {"@language": "ru", "@value": title},
            "classKind": "category",
        },
        ensure_ascii=False,
    ).encode()


def _answers() -> dict[str, bytes]:
    return {
        "100": _plain("100", "Некоторые инфекционные болезни"),
        "200": _plain("200", "Кишечные инфекции"),
        "300": _for_entity("257068234", "300"),
        "300/other": _for_entity("515117475~other", "300/other"),
        "400": _plain("400", "Vibrio cholerae О1"),
    }


@contextmanager
def _container(answers: dict[str, bytes]) -> Iterator[str]:
    prefix = "/icd/release/11/2026-01/mms/"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = (
                answers.get(self.path.removeprefix(prefix))
                if self.path.startswith(prefix)
                else None
            )
            self.send_response(200 if body is not None else 404)
            self.send_header("API-Version", "v2.6.0")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            if body is not None:
                self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _with_api(raw: Path, answers: dict[str, bytes] | None = None) -> Path:
    with _container(answers if answers is not None else _answers()) as base_url:
        fetch_icd11_api(
            raw,
            release="2026-01",
            base_url=base_url,
            container_image=IMAGE,
            data_release=DATA_RELEASE,
            concurrency=2,
        )
    return raw


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
            {
                "name": name,
                "url": f"https://icdcdn.who.int/static/releasefiles/2026-01/{name}",
                "sha256": hashlib.sha256((raw / name).read_bytes()).hexdigest(),
            }
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
    report = prepare_icd11(
        _with_api(_raw(tmp_path)), workspace, DECISION, mkb10_database=_mkb10(tmp_path)
    )
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    documents = _documents(database)

    assert report.documents == 5
    assert (report.chapters, report.blocks, report.categories) == (1, 1, 3)
    assert report.english_only_titles == 1
    assert report.entities_with_icd10_closest == 1
    assert report.mapping_rows_unmatched["10To11MapToOneCategory.txt"] == 1
    assert report.icd10_links_resolved == 1 and report.icd10_links_unresolved == 2
    assert report.api_entities == 5 and report.api_container_image == IMAGE

    title, metadata, texts = documents[document_id("300")]
    assert title == "1A00 Холера, МКБ-11 (ВОЗ)"
    for key in ("mkbCode", "icd10Codes", "entityType", "terminology"):
        assert key not in metadata
    assert metadata["codingSystem"] == "icd-11"
    assert metadata["icd11Code"] == "1A00"
    assert metadata["rightsStatus"] == "cc-by-nd-3.0-igo"
    # Per-document metadata stays small: constants live in the raw manifests and release report.
    for key in ("rights", "rawPath", "tabulationSha256", "mappingSha256", "fetchedAt"):
        assert key not in metadata
    path = _items(metadata["classificationPath"])
    assert path[0]["documentId"] == document_id("200")
    assert set(path[0]) == {"documentId", "title"}
    assert path[-1]["documentId"] == document_id("100")
    by_relation = {item["relation"]: item for item in _items(metadata["crosswalkIcd10"])}
    assert by_relation["closest"]["icd10Code"] == "A00.9"
    assert by_relation["closest"]["icd10DocumentId"] == "rls.mkb.node.a00-9"
    assert "icd10DocumentId" not in by_relation["mapped-into-this"]  # no such ICD-10 card
    assert by_relation["mapped-into-this"]["icd11Cluster"] == "1A00&XN8P1"
    assert by_relation["mapped-into-this-multiple"]["icd10Code"] == "A00.1"

    text = "\n".join(texts)
    assert "Код МКБ-11: 1A00" in text
    assert "Указание по кодированию: Первая строка указания" in text
    assert "вторая строка указания" in text
    assert "1A00&XN8P1 (1A00 — Холера; XN8P1 — Vibrio cholerae О1)" in text
    # The searchable crosswalk text carries codes; WHO's English ICD-10 titles stay in metadata.
    assert "Cholera, unspecified" not in text
    assert by_relation["closest"]["icd10TitleEn"] == "Cholera, unspecified"
    # The hierarchy is metadata (card panel links), not repeated as text.
    assert "Положение в классификации" not in text and "Нижестоящие рубрики" not in text
    assert "Кишечные инфекции" in "\n".join(_documents(database)[document_id("200")][2])


def test_api_text_is_merged_with_exact_source_spans(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    report = prepare_icd11(_with_api(_raw(tmp_path)), workspace, DECISION)
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    _, metadata, texts = _documents(database)[document_id("300")]
    text = "\n".join(texts)

    assert "Определение: Холера -" in text and "biovar eltor." in text
    assert "Включения:\n\n- синдром холеры" in text
    assert "- азиатская холера" in text
    # The entity's own title is not repeated as an index term.
    assert "- Холера\n" not in text
    assert "Полное название ВОЗ: Кишечная инфекция, вызванная Vibrio cholerae" in text
    assert "Источник: ВОЗ, МКБ-11 (MMS), выпуск 2026-01" in text
    assert report.documents_with_api_text["definition"] >= 1
    assert report.api_text["definition"]["kept"] >= 1

    connection = sqlite3.connect(database)
    try:
        spans = [
            span
            for (raw,) in connection.execute(
                "SELECT c.metadata_json FROM chunks c JOIN document_versions v "
                "ON v.id = c.document_version_id WHERE v.document_id = ?",
                (document_id("300"),),
            )
            for span in json.loads(raw).get("sourceSpans", [])
        ]
        version = connection.execute(
            "SELECT version_label, source_checksum FROM document_versions WHERE document_id = ?",
            (document_id("300"),),
        ).fetchone()
    finally:
        connection.close()
    selectors = {span["selector"] for span in spans}
    assert {
        "line:4",
        "300.json#definition",
        "300.json#inclusion",
        "300.json#indexTerm",
    } <= selectors
    assert {span["rawPath"] for span in spans if "#" in span["selector"]} == {
        f"icd11/2026-01/{API_DIRECTORY}/mms-ru.zip"
    }
    assert all(set(span) == {"rawPath", "selector", "sourceKind"} for span in spans)
    assert version[0] == "who-2026-01" and version[1].startswith("sha256:")
    assert "apiEntrySha256" not in metadata


def test_residual_row_takes_the_api_coding_note_only_when_the_tabulation_has_none(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    report = prepare_icd11(_with_api(_raw(tmp_path)), workspace, DECISION)
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    text = "\n".join(_documents(database)[document_id("300/other")][2])

    assert "Указание по кодированию: Инфекция или пищевое отравление" in text
    assert report.coding_notes == 1 and report.coding_notes_api_only == 1


def test_english_fallback_is_omitted_and_provisional_translation_is_flagged() -> None:
    fallback = parse_api_entity("1", "1.json", "x", json.loads(_fixture("1638970223")))
    assert fallback.definition is None and fallback.index_terms == ()
    assert fallback.omitted_fallback["definition"] == 1
    assert fallback.omitted_fallback["indexTerm"] == 1

    unmarked = parse_api_entity("1", "1.json", "x", json.loads(_fixture("2088244412")))
    assert unmarked.definition is None  # «Definition corresponds to another code.» is English
    assert unmarked.omitted_unmarked_foreign["definition"] == 1

    provisional = parse_api_entity("1", "1.json", "x", json.loads(_fixture("599258359")))
    assert [item.text for item in provisional.inclusions] == [
        "Папиллярная плоскоклеточная карцинома in situ"
    ]
    assert provisional.inclusions[0].provisional is True
    assert provisional.provisional["inclusion"] == 1

    mixed = parse_api_entity("1", "1.json", "x", json.loads(_fixture("1247223172")))
    assert mixed.definition is not None and mixed.definition.provisional is False
    assert [item.text for item in mixed.inclusions] == ["Боль, вызванная скоплением газов"]


def test_markers_are_classified_without_rewriting_other_brackets() -> None:
    assert classify_text("Perioperative [No translation available]") == (None, False)
    assert classify_text("x [No translation available][Residual translation rule not defined]") == (
        None,
        False,
    )
    assert classify_text("Тромбоцитопатия [possible translation]") == ("Тромбоцитопатия", True)
    assert classify_text("Pleuro-pneumonia-like-organism [PPLO]") == (
        "Pleuro-pneumonia-like-organism [PPLO]",
        False,
    )
    with pytest.raises(ValueError, match="unknown or misplaced"):
        classify_text("Текст [translation pending]")
    with pytest.raises(ValueError, match="unknown or misplaced"):
        classify_text("Текст [possible translation] ещё текст")


def test_api_fetch_is_loopback_only_checksummed_and_resumable(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    with pytest.raises(ValueError, match="loopback"):
        require_loopback("https://id.who.int")
    with pytest.raises(ValueError, match="loopback"):
        require_loopback("http://192.168.1.5:8382")

    answers = _answers()
    with _container(answers) as base_url:
        first = fetch_icd11_api(
            raw,
            release="2026-01",
            base_url=base_url,
            container_image=IMAGE,
            data_release=DATA_RELEASE,
        )
        again = fetch_icd11_api(
            raw,
            release="2026-01",
            base_url=base_url,
            container_image=IMAGE,
            data_release=DATA_RELEASE,
        )
    assert first.stored == 5 and first.reused == 0
    assert again.stored == 0 and again.reused == 5
    manifest = json.loads((raw / API_DIRECTORY / "MANIFEST.json").read_text(encoding="utf-8"))
    assert manifest["containerImage"] == IMAGE and manifest["apiVersions"] == ["v2.6.0"]
    assert manifest["entries"]["300"] == hashlib.sha256(answers["300"]).hexdigest()
    archive = load_api_text(raw, "2026-01")
    assert archive.archive_sha256 == manifest["archive"]["sha256"]
    assert set(archive.entities) == {"100", "200", "300", "300/other", "400"}

    with zipfile.ZipFile(raw / API_DIRECTORY / "mms-ru.zip", "a") as bundle:
        bundle.writestr("tamper.json", "{}")
    with pytest.raises(ValueError, match="differs from its manifest"):
        load_api_text(raw, "2026-01")


def test_api_answer_for_another_entity_is_refused(tmp_path: Path) -> None:
    answers = _answers()
    answers["200"] = _plain("999", "Другое")
    with _container(answers) as base_url, pytest.raises(ValueError, match="another entity"):
        fetch_icd11_api(
            _raw(tmp_path),
            release="2026-01",
            base_url=base_url,
            container_image=IMAGE,
            data_release=DATA_RELEASE,
        )


def test_residual_row_without_russian_title_says_so_and_has_no_children(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    prepare_icd11(_with_api(_raw(tmp_path)), workspace, DECISION)
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    title, metadata, texts = _documents(database)[document_id("300/other")]

    assert title == "1A0Y Other specified cholera, МКБ-11 (ВОЗ)"
    assert metadata["icd11TitleLanguage"] == "en-source-only"
    assert "перевод не выполнялся" in "\n".join(texts)
    assert metadata["childDocuments"] == []
    parent_titles = [item["title"] for item in _items(metadata["classificationPath"])]
    assert parent_titles[0] == "Холера"
    assert not (workspace / "300.md").exists()


def test_parents_list_their_children_in_file_order(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    prepare_icd11(_with_api(_raw(tmp_path)), workspace, DECISION)
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
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
    raw = _with_api(_raw(tmp_path))
    prepare_icd11(raw, workspace, DECISION, mkb10_database=_mkb10(tmp_path))
    database = tmp_path / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)

    report = package_icd11_module(
        database, tmp_path / "release", version="2026.10.5", min_app_version="0.6.49", raw_root=raw
    )
    sources = report["rawSources"]
    assert isinstance(sources, dict)
    assert sources["icdApi"]["containerImage"] == IMAGE
    assert sources["icdApi"]["entityCount"] == 5
    assert {item["name"] for item in sources["files"]} == {TABULATION_NAME, MAPPING_NAME}

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
