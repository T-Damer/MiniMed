"""Medical-services nomenclature: dictionary repairs, documents, lint, build, search, package."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
import yaml

from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.code_reference import (
    DOCUMENT_PREFIX,
    MedicalServicesError,
    clean_code,
    document_title,
    gfm_tables,
    prepare_medical_services,
    read_rows,
    sort_key,
)
from localmed_ingest.code_reference_distribution import package_medical_services_module

OID = "1.2.643.5.1.13.13.11.1070"

# (ID, S_CODE, NAME, REL, DATEOUT)
ROWS: list[tuple[str, str | None, str, str, str | None]] = [
    ("1", "A16.20.005", "Кесарево сечение", "1", None),
    ("2", "A16.20.005.001", "Расширение шеечного канала", "1", None),
    ("3", "A16.20.001", "Удаление кисты яичника", "1", None),
    (
        "4",
        "А16.20.001",
        "Удаление кисты яичника",
        "0",
        "25.02.2021",
    ),  # Cyrillic look-alike, abolished twin
    ("5", "A16. 20.002", "Оофорэктомия лапаротомическая", "1", None),  # space in the code
    ("6", "A16.20.009", "Старое название услуги", "0", "01.01.2018"),  # code reused below
    ("7", "A16.20.009", "Новое название услуги", "1", None),
    (
        "8",
        "В01.003.004.008.001",
        "Спинально-эпидуральная аналгезия",
        "1",
        None,
    ),  # Cyrillic look-alike
    (
        "9",
        "B01.003.004.001",
        "Анестезиологическое пособие (включая раннее послеоперационное ведение)",
        "1",
        None,
    ),
    ("10", None, "признать утратившей силу", "1", None),
    (
        "11",
        "A05.23.009",
        "Магнитно-резонансная томография головного мозга | с контрастом",
        "1",
        None,
    ),
    ("12", "A26.06.049", "Определение антител к вирусу", "1", None),
]


def _raw(root: Path, rows: list[tuple[str, str | None, str, str, str | None]] = ROWS) -> Path:
    raw = root / "v2.10"
    raw.mkdir(parents=True)
    payload = json.dumps(
        [
            [
                {"column": "ID", "value": row[0]},
                {"column": "S_CODE", "value": row[1]},
                {"column": "NAME", "value": row[2]},
                {"column": "REL", "value": row[3]},
                {"column": "DATEOUT", "value": row[4]},
            ]
            for row in rows
        ],
        ensure_ascii=False,
    ).encode()
    (raw / "rows.json").write_bytes(payload)
    (raw / "MANIFEST.json").write_text(
        json.dumps(
            {
                "oid": OID,
                "version": "2.10",
                "publishDate": "06.04.2021 16:31",
                "rowsCount": len(rows),
                "rowsFile": "rows.json",
                "rowsSha256": hashlib.sha256(payload).hexdigest(),
                "fetchedAt": "2026-10-12T17:30:06.021Z",
            }
        ),
        encoding="utf-8",
    )
    return raw


def test_clean_code_repairs_look_alikes_and_spaces() -> None:
    assert clean_code("А16.20.001") == "A16.20.001"
    assert clean_code("В01.003.004.001") == "B01.003.004.001"
    assert clean_code("A11. 19.006") == "A11.19.006"


def test_sort_key_orders_code_parts_numerically() -> None:
    codes = ["A16.20.010", "A16.20.002.001", "A16.20.002", "A09.05.100", "B01.003.004", "A16.5.1"]
    assert sorted((c for c in codes if c != "A16.5.1"), key=sort_key) == [
        "A09.05.100",
        "A16.20.002",
        "A16.20.002.001",
        "A16.20.010",
        "B01.003.004",
    ]


def test_read_rows_repairs_and_counts(tmp_path: Path) -> None:
    rows, _manifest, report = read_rows(_raw(tmp_path))
    codes = [row.code for row in rows]
    assert "A16.20.002" in codes  # the space was removed
    assert "B01.003.004.008.001" in codes  # Cyrillic look-alike
    assert report.rows == 12
    assert report.rows_without_code == ["10: признать утратившей силу"]
    assert report.cyrillic_codes_repaired == 2
    assert report.codes_with_spaces_repaired == 1
    # The abolished twin of A16.20.001 is not repeated; the reused A16.20.009 keeps both rows.
    assert report.abolished_twins_not_repeated == 1
    assert report.codes_reused_for_other_name == ["A16.20.009"]
    assert [row.name for row in rows if row.code == "A16.20.009"] == [
        "Новое название услуги",
        "Старое название услуги",
    ]
    assert report.active_services == 9
    assert report.abolished_services == 1
    assert [row.active for row in rows if row.code == "A16.20.009"] == [True, False]


def test_read_rows_rejects_a_changed_file_and_unexpected_codes(tmp_path: Path) -> None:
    raw = _raw(tmp_path / "one")
    (raw / "rows.json").write_text("[]", encoding="utf-8")
    with pytest.raises(MedicalServicesError, match="SHA-256"):
        read_rows(raw)
    odd = _raw(tmp_path / "two", [("1", "Z99.1", "Нечто", "1", None)])
    with pytest.raises(MedicalServicesError, match="unexpected code"):
        read_rows(odd)
    no_date = _raw(tmp_path / "three", [("1", "A01.01.001", "Старая", "0", None)])
    with pytest.raises(MedicalServicesError, match="abolition date"):
        read_rows(no_date)


def test_gfm_tables_split_long_tables_and_escape_pipes() -> None:
    rows = [(f"A01.01.{index:03d}", "Название | с чертой " * 3) for index in range(200)]
    pieces = gfm_tables(("Код", "Наименование"), rows)
    assert len(pieces) > 1
    assert all(piece.startswith("| Код | Наименование |") for piece in pieces)
    assert all(len(piece) <= 2800 for piece in pieces)
    assert "\\|" in pieces[0]


def test_document_title_names_the_first_services_not_their_variants(tmp_path: Path) -> None:
    rows, _manifest, _report = read_rows(_raw(tmp_path))
    section = [row for row in rows if row.group == "A16.20"]
    assert document_title("A16.20", section) == (
        "Услуги A16.20: Удаление кисты яичника; Оофорэктомия лапаротомическая…"
    )
    single = [row for row in rows if row.group == "A26.06"]
    assert document_title("A26.06", single) == "Услуга A26.06.049: Определение антител к вирусу"


def test_prepare_writes_sections_overview_and_keeps_names_verbatim(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    workspace = tmp_path / "workspace"
    report = prepare_medical_services(raw, workspace)
    names = sorted(path.name for path in workspace.glob("reference.*.md"))
    assert names == [
        f"{DOCUMENT_PREFIX}{key}.md"
        for key in ("a05-23", "a16-20", "a26-06", "b01-003", "overview")
    ]
    assert report.documents == 5
    text = (workspace / f"{DOCUMENT_PREFIX}a16-20.md").read_text(encoding="utf-8")
    front = yaml.safe_load(text.split("---\n")[1])
    assert front["id"] == f"{DOCUMENT_PREFIX}a16-20"
    assert front["source_type"] == "code_reference"
    assert front["metadata"]["serviceCount"] == 5
    assert front["metadata"]["abolishedServiceCount"] == 1
    assert front["metadata"]["publicationState"] == "preview"
    assert "| A16.20.005 | Кесарево сечение |" in text
    assert "| A16.20.005.001 | Расширение шеечного канала |" in text
    assert "# Упразднённые услуги" in text
    assert "| A16.20.009 | Старое название услуги | 01.01.2018 |" in text
    # Active rows come first, in code order.
    assert text.index("A16.20.001 ") < text.index("A16.20.002 ") < text.index("A16.20.005 ")
    assert "localmed:source" in text
    overview = (workspace / f"{DOCUMENT_PREFIX}overview.md").read_text(encoding="utf-8")
    assert "| A16.20 | 5 |" in overview
    assert "804н" in overview
    pipe = (workspace / f"{DOCUMENT_PREFIX}a05-23.md").read_text(encoding="utf-8")
    assert "головного мозга \\| с контрастом" in pipe


def test_prepare_is_deterministic_and_replaces_only_its_own_workspace(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    first = tmp_path / "one"
    second = tmp_path / "two"
    prepare_medical_services(raw, first)
    prepare_medical_services(raw, second)
    assert {p.name: p.read_bytes() for p in first.iterdir()} == {
        p.name: p.read_bytes() for p in second.iterdir()
    }
    prepare_medical_services(raw, first)  # replaces its own workspace
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    (foreign / "keep.txt").write_text("x", encoding="utf-8")
    with pytest.raises(MedicalServicesError, match=r"not a minimed\.reference\.medical-services"):
        prepare_medical_services(raw, foreign)
    assert (foreign / "keep.txt").exists()


def test_workspace_lints_builds_searches_by_code_and_packages(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    prepare_medical_services(_raw(tmp_path), workspace)
    assert lint_content_pack(load_content_pack(workspace)) == []
    database = tmp_path / "services.db"
    build_content_pack(workspace, database, include_embeddings=False, compact_search_text=True)
    report = package_medical_services_module(
        database, tmp_path / "release", version="2026.10.12", min_app_version="0.6.59"
    )
    assert report["documents"] == 5
    assert report["activeServices"] == 9
    assert report["abolishedServices"] == 1
    entry = json.loads(Path(str(report["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.reference.medical-services.ru"
    assert entry["collection"] == "medical-services"
    assert entry["kind"] == "reference"
    assert entry["releaseState"] == "preview"
    assert entry["compatibility"]["minAppVersion"] == "0.6.59"
    assert entry["documents"] == []
    assert entry["previewDocumentCount"] == 5
    assert entry["artifacts"][0]["url"].endswith(
        "/reference-medical-services-2026.10.12/minimed.reference.medical-services.2026.10.12.db.gz"
    )


def test_the_chunk_text_has_the_code_as_separate_tokens(tmp_path: Path) -> None:
    """FTS5's unicode61 tokenizer splits «A16.20.005» at the dots, so a typed code matches."""
    import sqlite3

    workspace = tmp_path / "workspace"
    prepare_medical_services(_raw(tmp_path), workspace)
    database = tmp_path / "services.db"
    build_content_pack(workspace, database, include_embeddings=False, compact_search_text=True)
    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
            ('"a16" AND "20" AND "005"',),
        ).fetchall()
    assert f"{DOCUMENT_PREFIX}a16-20" in {row[0] for row in rows}
    assert f"{DOCUMENT_PREFIX}a26-06" not in {row[0] for row in rows}
