"""Personal-use lab and TNM modules, on invented rows only (no real source text)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
import yaml

from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.local_reference_common import (
    LocalModuleSpec,
    ensure_gitignored,
    package_local_module,
)
from localmed_ingest.local_reference_lab import (
    MISSING_TEXT,
    RANGE_NOTE,
    format_number,
    format_value,
    prepare_lab_reference,
    split_names,
)
from localmed_ingest.local_reference_lab import (
    SPEC as LAB_SPEC,
)
from localmed_ingest.local_reference_tnm import (
    SPEC as TNM_SPEC,
)
from localmed_ingest.local_reference_tnm import (
    extract_icd10,
    prepare_tnm,
    stated_editions,
)
from localmed_ingest.markdown_parser import parse_front_matter

LAB_SCHEMA = """
CREATE TABLE biomaterials (id integer PRIMARY KEY, title varchar);
CREATE TABLE sections (id integer PRIMARY KEY, parent_id integer, title varchar);
CREATE TABLE preparations (id integer PRIMARY KEY, directive varchar);
CREATE TABLE nms_names (id integer PRIMARY KEY, code varchar, title varchar);
CREATE TABLE deviation_reasons (id integer PRIMARY KEY, elevated_values varchar,
  low_values varchar);
CREATE TABLE research_methods (id integer PRIMARY KEY, title varchar);
CREATE TABLE result_formats (id integer PRIMARY KEY, title varchar);
CREATE TABLE slis_attributes (id integer PRIMARY KEY, units varchar, sex varchar, age varchar,
  min_norm float, max_norm float, quality_norm varchar, commentary varchar);
CREATE TABLE slis_parameters (id integer PRIMARY KEY, title varchar, print_title varchar,
  uppercase_print_title varchar, secondary_title varchar);
CREATE TABLE analyzes (id integer PRIMARY KEY, biomaterial_id integer, preparation_id integer,
  subsection_id integer, deviation_reason_id integer, nms_name_id integer, code varchar,
  rus_name varchar, foreign_name varchar, alternative_rus_name varchar, service_type varchar,
  execution_period integer, description text, cito boolean, cito_deadline varchar,
  method_format varchar, collection_rules text, appointments varchar, outcome_factors varchar,
  interfering_factors varchar);
CREATE TABLE analyzes_research_methods (id integer PRIMARY KEY, research_method_id integer,
  analyze_id integer);
CREATE TABLE analyzes_result_formats (id integer PRIMARY KEY, result_format_id integer,
  analyze_id integer);
CREATE TABLE analyzes_slis_parameters (id integer PRIMARY KEY, slis_parameter_id integer,
  slis_attribute_id integer, analyze_id integer);
CREATE TABLE analyzes_complex_researches (id integer PRIMARY KEY, complex_research_id integer,
  analyze_id integer);
CREATE TABLE analyzes_recommended_analyzes (id integer PRIMARY KEY, recommended_analyze_id integer,
  analyze_id integer);
"""


def make_lab_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(LAB_SCHEMA)
    connection.executemany(
        "INSERT INTO sections VALUES (?, ?, ?)",
        [(1, None, "Тестовая химия"), (2, 1, "Тестовые ферменты"), (3, 2, "Тестовые ферменты")],
    )
    connection.execute("INSERT INTO biomaterials VALUES (1, 'Сыворотка (синтетическая)')")
    connection.execute("INSERT INTO preparations VALUES (1, 'Натощак, пробный режим.')")
    connection.execute(
        "INSERT INTO nms_names VALUES (1, 'X01.01', 'Исследование пробного вещества')"
    )
    connection.execute(
        "INSERT INTO deviation_reasons VALUES (1, '<div>1. Причина вверх;</div><div>2. Ещё</div>', "
        "'Причина вниз')"
    )
    connection.execute("INSERT INTO research_methods VALUES (1, 'Пробный метод')")
    connection.execute("INSERT INTO result_formats VALUES (1, 'Количественный')")
    analyses = [
        (
            1,
            1,
            1,
            3,
            1,
            1,
            "00-00-001",
            "Пробное вещество",
            "Probe substance, PSU.",
            "Тестовый маркер, проба А (вариант, второй)",
            "Тест",
            2,
            "Описание пробы.\nВторой абзац &gt; 5.",
            False,
            "2 - 5 ч.",
            "Автоматизированный",
            "Правило взятия.",
            "Показание один,\nПоказание два.",
            "Не есть.",
            "Повышают:\nвещество А",
        ),
        (
            2,
            None,
            None,
            2,
            None,
            None,
            "00-00-002",
            "Пробный профиль",
            None,
            None,
            "Профиль",
            1,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ),
        (
            3,
            None,
            None,
            None,
            None,
            None,
            "00-00-003",
            "Качественная проба",
            None,
            None,
            "Тест",
            1,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        ),
    ]
    connection.executemany(
        "INSERT INTO analyzes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", analyses
    )
    connection.executemany(
        "INSERT INTO slis_parameters VALUES (?,?,?,?,?)",
        [
            (1, "PSUB", "Пробное вещество", "", "Probe substance"),
            (2, "QUAL", "Качество", "", "Quality"),
            (3, "NONE", "Без значений", "", None),
        ],
    )
    connection.executemany(
        "INSERT INTO slis_attributes VALUES (?,?,?,?,?,?,?,?)",
        [
            (1, "ммоль/л", "Любой", "От 0 до 2 дней", 2.5, 3.0, None, None),
            (2, "ммоль/л", "Жен.", "От 2 дней до 99 лет", 4.1, 5.9, None, None),
            (3, "г/л", "Любой", "От 0 до 99 лет", None, 7.0, None, None),
            (4, "г/л", "Муж.", "От 0 до 99 лет", 1.5, None, None, None),
            (5, None, "Любой", "От 0 до 99 лет", 5.0, 7.0, "10^5 - 10^7", "Общий комментарий"),
            (6, None, "Любой", "От 0 до 99 лет", None, None, "@ERROR_NO_RTF@", "Общий комментарий"),
            (7, "ед", None, None, None, None, None, None),
            (8, None, "Любой", "От 0 до 99 лет", 10.15, 0.83, None, "Общий комментарий"),
        ],
    )
    connection.executemany(
        "INSERT INTO analyzes_slis_parameters VALUES (?,?,?,?)",
        [
            (1, 1, 1, 1),
            (2, 1, 2, 1),
            (3, 1, 3, 1),
            (4, 1, 4, 1),
            (5, 2, 5, 3),
            (6, 2, 6, 3),
            (7, 2, 8, 3),
            (8, 3, 7, 3),
        ],
    )
    connection.execute("INSERT INTO analyzes_research_methods VALUES (1, 1, 1)")
    connection.execute("INSERT INTO analyzes_result_formats VALUES (1, 1, 1)")
    connection.execute("INSERT INTO analyzes_complex_researches VALUES (1, 2, 1)")
    connection.execute("INSERT INTO analyzes_recommended_analyzes VALUES (1, 3, 1)")
    connection.commit()
    connection.close()


def test_numbers_are_printed_as_stored() -> None:
    assert format_number(12.0) == "12"
    assert format_number(0.0) == "0"
    assert format_number(2.22) == "2.22"
    assert format_number(100.0) == "100"
    assert format_number(1e-05) == "0.00001"
    assert format_value(2.5, 3.0, None) == ("2.5–3", False, False)
    assert format_value(None, 7.0, None) == ("< 7", False, False)
    assert format_value(1.5, None, None) == ("> 1.5", False, False)
    assert format_value(4.0, 4.0, None) == ("4", False, False)
    assert format_value(None, None, None) == ("—", False, False)
    assert format_value(None, None, "отрицательно\nили слабо") == (
        "отрицательно или слабо",
        False,
        False,
    )
    text, missing, _ = format_value(1.0, 2.0, "@ERROR_NO_RTF@")
    assert missing and text == f"1–2; {MISSING_TEXT}"
    text, _, inverted = format_value(10.15, 0.83, None)
    assert inverted and text.startswith("10.15–0.83 [")


def test_names_split_outside_parentheses() -> None:
    assert split_names("Анализ А (вариант, второй), анализ Б; ABC.") == [
        "Анализ А (вариант, второй)",
        "анализ Б",
        "ABC",
    ]
    assert split_names(None) == []
    assert split_names("<span style=x>IgE</span>&nbsp;тест") == ["IgE тест"]


def test_lab_workspace_documents(tmp_path: Path) -> None:
    database = tmp_path / "analyzes.sqlite"
    make_lab_database(database)
    output = tmp_path / "workspace"
    report = prepare_lab_reference(database, output)

    assert report.documents == 3
    assert report.profiles == 1
    assert report.reference_rows == 8
    assert report.inverted_ranges == 1
    assert report.rows_with_missing_text == 1
    assert report.empty_rows_omitted == 1

    metadata, body = parse_front_matter((output / "local.lab.1.md").read_text(encoding="utf-8"))
    assert metadata.id == "local.lab.1"
    assert metadata.title == "Пробное вещество"
    assert metadata.source_type == "medical_reference"
    assert metadata.source_checksum is not None and metadata.source_checksum.startswith("sha256:")
    assert metadata.metadata["rightsStatus"] == "personal-use-only"
    assert metadata.metadata["localOnly"] is True
    assert metadata.metadata["labSection"] == ["Тестовая химия", "Тестовые ферменты"]
    assert "Тестовый маркер" in "".join(str(x) for x in metadata.metadata["aliases"])  # type: ignore[attr-defined]
    assert metadata.metadata["relatedDocuments"] == {  # type: ignore[comparison-overlap]
        "composition": [],
        "partOf": ["local.lab.2"],
        "recommended": ["local.lab.3"],
    }
    assert "| Любой | От 0 до 2 дней | 2.5–3 | ммоль/л |" in body
    assert "| Жен. | От 2 дней до 99 лет | 4.1–5.9 | ммоль/л |" in body
    assert "| Любой | От 0 до 99 лет | < 7 | г/л |" in body
    assert "| Муж. | От 0 до 99 лет | > 1.5 | г/л |" in body
    assert body.count(RANGE_NOTE) == 1
    headings = [line for line in body.splitlines() if line.startswith("## ")]
    assert headings == [
        "## Общие сведения",
        "## Референсные значения",
        "## Показания",
        "## Подготовка",
        "## Биоматериал и правила взятия",
        "## Что влияет на результат",
        "## Причины отклонений",
        "## Описание",
        "## Связанные исследования",
    ]
    assert "Код услуги: 00-00-001." in body
    assert "Раздел: Тестовая химия / Тестовые ферменты." in body
    assert "Номенклатура медицинских услуг: X01.01 Исследование пробного вещества." in body
    assert "- Показание один\n- Показание два." in body
    assert "Второй абзац > 5." in body
    assert "### Повышение значений" in body and "### Понижение значений" in body
    assert "- Пробный профиль (00-00-002)" in body
    assert "- Качественная проба (00-00-003)" in body

    _, profile = parse_front_matter((output / "local.lab.2.md").read_text(encoding="utf-8"))
    assert "### Состав профиля" in profile
    assert "- Пробное вещество (00-00-001)" in profile

    _, qualitative = parse_front_matter((output / "local.lab.3.md").read_text(encoding="utf-8"))
    assert "10^5 - 10^7" in qualitative.replace("\\", "")
    assert "5–7; 10^5 - 10^7" in qualitative.replace("\\", "")
    assert "[нет текста в источнике]" in qualitative
    assert qualitative.count("Комментарий лаборатории:") == 1
    assert "[нижняя граница больше верхней в источнике]" in qualitative
    assert "## Показатели результата" not in qualitative
    assert "### Показатели без референсных значений" in qualitative
    assert "- Без значений [NONE]; единицы: ед" in qualitative.replace("\\", "")

    aliases = yaml.safe_load((output / "aliases.yaml").read_text(encoding="utf-8"))["aliases"]
    pairs = {(row["canonicalTerm"], row["alias"]) for row in aliases}
    assert ("Пробное вещество", "Probe substance") in pairs
    assert ("Пробное вещество", "PSU") in pairs
    assert ("Пробное вещество", "PSUB") in pairs
    manifest = yaml.safe_load((output / "manifest.yaml").read_text(encoding="utf-8"))
    assert manifest["id"] == "minimed.local.lab-reference.ru"
    assert manifest["publicationState"] == "local-dev"


def test_lab_pack_lints_builds_and_packages(tmp_path: Path) -> None:
    database = tmp_path / "analyzes.sqlite"
    make_lab_database(database)
    workspace = tmp_path / "workspace"
    prepare_lab_reference(database, workspace)
    assert lint_content_pack(load_content_pack(workspace)) == []
    pack_db = tmp_path / "lab.db"
    build_content_pack(workspace, pack_db, include_embeddings=False, compact_search_text=True)
    release = package_local_module(
        LAB_SPEC, pack_db, tmp_path / "out", version="2026.10.12", min_app_version="0.6.59"
    )
    assert release["documents"] == 3
    entry = json.loads(Path(str(release["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.local.lab-reference.ru"
    assert entry["collection"] == "local-lab-reference"
    assert entry["documents"] == []
    assert entry["previewDocumentCount"] == 3
    assert entry["compatibility"]["minAppVersion"] == "0.6.59"
    assert entry["capabilities"]["structuredTables"] is True


def test_packaging_refuses_a_pack_without_the_personal_use_mark(tmp_path: Path) -> None:
    database = tmp_path / "analyzes.sqlite"
    make_lab_database(database)
    workspace = tmp_path / "workspace"
    prepare_lab_reference(database, workspace)
    pack_db = tmp_path / "lab.db"
    build_content_pack(workspace, pack_db, include_embeddings=False)
    foreign = LocalModuleSpec(
        module_id="x.y",
        file_stem="x.y",
        title="x",
        collection="x",
        document_prefix="other.",
        source_name="x",
        description_head="x",
        tags=(),
    )
    with pytest.raises(ValueError, match="Unexpected document"):
        package_local_module(
            foreign, pack_db, tmp_path / "out", version="2026.10.12", min_app_version="0.6.59"
        )


def test_gitignore_guard_rejects_tracked_paths() -> None:
    root = Path(__file__).resolve().parents[3]
    ensure_gitignored(root / "output" / "local-modules" / "anything")
    ensure_gitignored(root / "data" / "intermediate" / "local-reference" / "x")
    with pytest.raises(ValueError, match="not ignored"):
        ensure_gitignored(root / "docs" / "output-copy")


TNM_SCHEMA = """
CREATE TABLE tnm_categories (id integer PRIMARY KEY, title text);
CREATE TABLE tnms (id integer PRIMARY KEY, title text, tnm_category_id integer,
  anatomical_sites text, lymph_nodes text, t text, n text, m text, ptnm text, g text,
  stage text, prognostic text, rules text, title_upper text);
"""


def make_tnm_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(TNM_SCHEMA)
    connection.execute("INSERT INTO tnm_categories VALUES (1, 'Опухоли пробной системы')")
    stage = (
        "<table><tbody>"
        "<tr><td><strong>Стадия</strong></td><td><strong>T</strong></td><td><strong>N</strong></td></tr>"
        "<tr><td rowspan='2'>Стадия I</td><td>T1</td><td>N0</td></tr>"
        "<tr><td>T2</td><td>N0</td></tr>"
        "<tr><td>Стадия II</td><td>T3<br>T4</td><td>N0</td></tr>"
        "</tbody></table>"
    )
    rows = [
        (
            1,
            "Пробный орган",
            1,
            "<p><strong>Пробная опухоль (С99)</strong></p><p><strong>C99.1</strong> Часть один</p>"
            "<p><strong>С98-99</strong> Диапазон</p>",
            "<p>Региональные узлы: пробные.</p>",
            "<p><strong>Для стадирования применяется TNM (8-е издание, 2017)</strong></p>"
            "<p><strong>T1</strong> – малая<br>опухоль</p>",
            "<p><strong>N0</strong> – нет</p>",
            "<p><strong>M0</strong> – нет</p>",
            None,
            None,
            stage,
            None,
            "<p>Правило пробной системы.</p>",
            "ПРОБНЫЙ ОРГАН",
        ),
        (
            2,
            "Другой орган",
            1,
            "<p>Без кодов</p>",
            None,
            "<p>T1 – a</p>",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            "ДРУГОЙ ОРГАН",
        ),
    ]
    connection.executemany("INSERT INTO tnms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    connection.commit()
    connection.close()


def test_icd10_extraction_and_edition_detection() -> None:
    assert extract_icd10("Рак (С34) C34.0 и С02—06, C18-20; D05.1") == [
        "C34",
        "C34.0",
        "C02",
        "C03",
        "C04",
        "C05",
        "C06",
        "C18",
        "C19",
        "C20",
        "D05.1",
        "D05",
    ]
    assert extract_icd10("С 10 лет, C5, СЗ0.0") == []
    assert extract_icd10("C15.1-15.3") == ["C15.1", "C15.3", "C15"]
    assert stated_editions("классификация TNM (8-е издание, 2017) и ВОЗ, 4-е издание, 2010") == [
        ("8", "2017")
    ]
    assert stated_editions("UICC, 8-й пересмотр, 2016") == [("8", "2016")]
    assert stated_editions("классификация ВОЗ, 4-е издание, 2010 г.") == []


def test_tnm_workspace_documents(tmp_path: Path) -> None:
    database = tmp_path / "tnm.sqlite"
    make_tnm_database(database)
    output = tmp_path / "workspace"
    report = prepare_tnm(database, output)

    assert report.documents == 2
    assert report.tables == 1
    assert report.merged_cells == 1
    assert report.documents_without_icd10 == [2]
    assert report.documents_stating_edition == 1
    assert report.edition == "TNM (UICC/AJCC), 8-е издание, 2017"

    metadata, body = parse_front_matter((output / "local.tnm.1.md").read_text(encoding="utf-8"))
    assert metadata.title == "TNM: Пробный орган"
    assert metadata.version_label.startswith("uicc-tnm-8-")
    assert metadata.metadata["icd10Codes"] == ["C99", "C99.1", "C98"]
    assert metadata.metadata["rightsStatus"] == "personal-use-only"
    assert metadata.metadata["tnmEditionStatedInText"] == ["8-е издание, 2017"]
    assert "## Издание\n" in body
    assert "TNM (UICC/AJCC), 8-е издание, 2017." in body
    assert "**T1** – малая опухоль" in body
    assert (
        "| **Стадия** | **T** | **N** |\n| --- | --- | --- |\n| Стадия I | T1 | N0 |\n"
        "| Стадия I | T2 | N0 |\n| Стадия II | T3; T4 | N0 |"
    ) in body
    headings = [line for line in body.splitlines() if line.startswith("## ")]
    assert "## Группировка по стадиям" in headings
    assert headings[-1] == "## Издание"

    other_metadata, other = parse_front_matter(
        (output / "local.tnm.2.md").read_text(encoding="utf-8")
    )
    assert other_metadata.metadata["icd10Codes"] == []
    assert "TNM (UICC/AJCC), 8-е издание, 2017." in other


def test_tnm_pack_search_projection_and_packaging(tmp_path: Path) -> None:
    database = tmp_path / "tnm.sqlite"
    make_tnm_database(database)
    workspace = tmp_path / "workspace"
    prepare_tnm(database, workspace)
    pack, _ = build_content_pack(
        workspace, tmp_path / "tnm.db", include_embeddings=False, compact_search_text=False
    )
    assert lint_content_pack(pack) == []
    first = next(doc for doc in pack.documents if doc.id == "local.tnm.1")
    assert first.metadata["icd10Codes"] == ["C99", "C99.1", "C98"]
    assert any("c99" in chunk.normalized_text for s in first.sections for chunk in s.chunks)
    release = package_local_module(
        TNM_SPEC,
        tmp_path / "tnm.db",
        tmp_path / "out",
        version="2026.10.12",
        min_app_version="0.6.59",
    )
    assert release["moduleId"] == "minimed.local.tnm.ru"
    assert release["documents"] == 2
