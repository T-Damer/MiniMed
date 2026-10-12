"""Tests of the personal-use Vidal preparer. Every row here is synthetic: invented drugs, invented
texts, nothing taken from the real database."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from localmed_ingest.builder import lint_content_pack, load_content_pack
from localmed_ingest.cli import app
from localmed_ingest.local_reference_vidal import (
    DOCUMENT_PREFIX,
    MODULE_ID,
    convert_vidal_html,
    dosage_form_text,
    normalize_registration_number,
    plain_text,
    prepare_vidal_medications,
)

_SCHEMA = """
CREATE TABLE Document (DocumentID INTEGER, RusName varchar, EngName varchar, Elaboration TEXT,
 CompaniesDescription TEXT, ArticleID INTEGER, CompiledComposition TEXT, ClPhGrDescription TEXT,
 PhInfluence TEXT, PhKinetics TEXT, Dosage TEXT, OverDosage TEXT, Interaction TEXT, Lactation TEXT,
 SideEffects TEXT, StorageCondition TEXT, Indication TEXT, ContraIndication TEXT,
 SpecialInstruction TEXT, YearEdition varchar, PregnancyUsing varchar, NursingUsing varchar,
 RenalInsuf TEXT, RenalInsufUsing varchar, HepatoInsuf TEXT, HepatoInsufUsing varchar,
 PharmDelivery TEXT, ElderlyInsuf TEXT, ElderlyInsufUsing varchar, ChildInsuf TEXT,
 ChildInsufUsing varchar);
CREATE TABLE Product (ProductID INTEGER, RusName varchar, EngName varchar,
 NonPrescriptionDrug INTEGER, RegistrationNumber varchar, ZipInfo varchar, GNVLS INTEGER);
CREATE TABLE Product_Document (ProductID INTEGER, DocumentID INTEGER);
CREATE TABLE Molecule (MoleculeID INTEGER, RusName varchar, LatName varchar, GNParent varchar);
CREATE TABLE Molecule_Document (MoleculeID INTEGER, DocumentID INTEGER, Ranking INTEGER);
CREATE TABLE ATC (ATCCode varchar, RusName varchar);
CREATE TABLE Product_ATC (ProductID INTEGER, ATCCode varchar);
CREATE TABLE Company (CompanyID INTEGER, LocalName varchar, Property varchar,
 CountryCode varchar);
CREATE TABLE Country (CountryCode varchar, RusName varchar);
CREATE TABLE Product_Company (ProductID INTEGER, CompanyID INTEGER, ItsMainCompany INTEGER,
 CompanyNote TEXT, Ranking INTEGER);
CREATE TABLE Nozology (NozologyCode varchar, Code varchar, Name varchar);
CREATE TABLE Document_IndicNozology (DocumentID INTEGER, NozologyCode varchar);
CREATE TABLE DocumentType (ArticleID INTEGER, Name varchar, Comment TEXT);
CREATE TABLE "Using" (Code varchar, Name varchar);
CREATE TABLE PhThGroups (PhThGroupsID INTEGER, Name varchar);
CREATE TABLE Product_PhThGrp (ProductID INTEGER, PhThGroupsID INTEGER);
CREATE TABLE ClPhGroups (ClPhGroupsID INTEGER, Code varchar, Name varchar);
CREATE TABLE Product_ClPhGroups (ProductID INTEGER, ClPhGroupsID INTEGER);
"""

_DOSAGE = (
    "<P>Взрослым по 1 таб. 2 раза/сут.</P>\n<P>Детям - по назначению.<BR />При КК &lt;30 "
    "мл/мин доза Х.</P>"
)
_SIDE_EFFECTS = (
    '<TABLE width="100%" border="1">\n<TR>\n<TD rowSpan="2"><B>Орган</B></TD>\n'
    '<TD colSpan="2"><B>Частота</B></TD></TR>\n<TR>\n<TD><B>Часто</B></TD>\n'
    "<TD><B>Редко</B></TD></TR>\n<TR>\n<TD>Кожа</TD>\n<TD>сыпь</TD>\n<TD></TD></TR>\n"
    "<TR>\n<TD>Нервы<BR />Мышцы</TD>\n<TD></TD>\n<TD>тремор</TD></TR></TABLE>"
)


def _build_vidal(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(_SCHEMA)
    connection.executemany(
        "INSERT INTO DocumentType VALUES (?, ?, ?)",
        [(1, "Объединённая статья", ""), (2, "Новая программа", "")],
    )
    connection.executemany(
        'INSERT INTO "Using" VALUES (?, ?)',
        [("Can", "разрешено"), ("Care", "осторожно"), ("Not", "запрещено"), ("Qwes", "нет данных")],
    )
    connection.executemany("INSERT INTO Country VALUES (?, ?)", [("RUS", "Россия")])
    connection.executemany(
        "INSERT INTO Molecule VALUES (?, ?, ?, ?)",
        [(1, "ТЕСТОВИН", "TESTOVIN", "Rec.INN"), (2, "ПРОБАЦИЛ", "PROBACIL", "Rec.INN")],
    )
    connection.executemany(
        "INSERT INTO Nozology VALUES (?, ?, ?)",
        [
            ("I10..", "I10", "ЭССЕНЦИАЛЬНАЯ ГИПЕРТЕНЗИЯ"),
            ("I10.", "I10-I15", "БОЛЕЗНИ, ХАРАКТЕРИЗУЮЩИЕСЯ ВЫСОКИМ АД"),
            ("E11..", "E11", "САХАРНЫЙ ДИАБЕТ 2 ТИПА"),
        ],
    )
    connection.execute("INSERT INTO ATC VALUES ('C09AA99', 'Тестовин')")
    connection.execute("INSERT INTO Company VALUES (1, 'ЗАВОД ТЕСТ', 'ООО', 'RUS')")
    connection.execute("INSERT INTO PhThGroups VALUES (1, 'ТЕСТОВОЕ СРЕДСТВО')")
    connection.execute("INSERT INTO ClPhGroups VALUES (1, '01.001', 'Тестовая группа')")
    # Document 1: generic substance article with two products, a table and an unsafe tag.
    connection.execute(
        "INSERT INTO Document (DocumentID, RusName, EngName, Elaboration, ArticleID,"
        " CompiledComposition, ClPhGrDescription, PhInfluence, Dosage, SideEffects, Lactation,"
        " Indication, YearEdition, PregnancyUsing, NursingUsing, HepatoInsuf, HepatoInsufUsing,"
        " RenalInsufUsing, ChildInsufUsing, PharmDelivery, Interaction)"
        " VALUES (1, 'ТЕСТОВИН', 'TESTOVIN', 'для приема внутрь', 1,"
        " '<P>[PRING] крахмал, тальк. C<SUB>max</SUB> 5 м<SUP>2</SUP> <IMG>logo.png</IMG></P>',"
        " 'Тестовое средство', '<P>Действует <I>быстро</I>.</P>', ?, ?,"
        " '<P>Проникает в молоко.</P>', '<P>Гипертензия.</P>', '2014', 'Care', 'Qwes',"
        " '<P>Печень: осторожно.</P>', 'Care', 'Qwes', 'Qwes', 'По рецепту.',"
        " '<P>Усиливает эффект X.</P><P><SUP># </SUP>примечание к таблице</P>')",
        (_DOSAGE, _SIDE_EFFECTS),
    )
    # Document 2: brand article with a registered-trademark sign and the same molecule.
    connection.execute(
        "INSERT INTO Document (DocumentID, RusName, EngName, ArticleID, Indication, YearEdition,"
        " PregnancyUsing, NursingUsing, RenalInsufUsing, HepatoInsufUsing, ElderlyInsufUsing,"
        " ChildInsufUsing)"
        " VALUES (2, 'ТЕСТОВИН-ФОРТЕ<SUP>&reg;</SUP>', 'TESTOVIN-FORTE', 2, '<P>Диабет.</P>', '0',"
        " 'Qwes', 'Qwes', 'Qwes', 'Qwes', 'Qwes', 'Qwes')"
    )
    # Document 3: combination of two molecules, no products.
    connection.execute(
        "INSERT INTO Document (DocumentID, RusName, EngName, ArticleID, Indication, YearEdition)"
        " VALUES (3, 'ТЕСТОВИН + ПРОБАЦИЛ', 'TESTOVIN + PROBACIL', 1, '<P>Комбинация.</P>', '0')"
    )
    connection.executemany(
        "INSERT INTO Molecule_Document VALUES (?, ?, ?)",
        [(1, 1, None), (1, 2, 0), (1, 3, 0), (2, 3, 1)],
    )
    connection.executemany(
        "INSERT INTO Product VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (10, "Тестовин", "Testovin", 0, "ЛП-№(000123)-(РГ-RU)", "таб. 5 мг: 20 шт.", 1),
            (11, "Тестовин", "Testovin", 0, "ЛС-000456", "&loz; капс. 10 мг: 10 шт.", 1),
            (12, "Тестовин-Форте<SUP>&reg;</SUP>", "x", 1, "ЛП-№(000789)-(РГ-RU)", "таб. 20 мг", 0),
            (13, "Сирота", "Orphan", 0, "ЛП-№(000999)-(РГ-RU)", "таб. 1 мг", 0),
        ],
    )
    connection.executemany(
        "INSERT INTO Product_Document VALUES (?, ?)", [(10, 1), (11, 1), (12, 2)]
    )
    connection.executemany(
        "INSERT INTO Product_ATC VALUES (?, ?)", [(10, "C09AA99"), (12, "C09AA99")]
    )
    connection.executemany(
        "INSERT INTO Product_Company VALUES (?, ?, ?, ?, ?)",
        [(10, 1, 1, None, 1), (11, 1, 1, None, 1), (12, 1, 1, None, 1)],
    )
    connection.executemany("INSERT INTO Product_PhThGrp VALUES (?, ?)", [(10, 1)])
    connection.executemany("INSERT INTO Product_ClPhGroups VALUES (?, ?)", [(10, 1)])
    connection.executemany(
        "INSERT INTO Document_IndicNozology VALUES (?, ?)",
        [(1, "I10.."), (1, "I10."), (2, "E11..")],
    )
    connection.commit()
    connection.close()


@pytest.fixture
def vidal_db(tmp_path: Path) -> Path:
    path = tmp_path / "vidal.db"
    _build_vidal(path)
    return path


def _front_matter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    loaded: object = yaml.safe_load(text.split("\n---\n", 1)[0].removeprefix("---\n"))
    assert isinstance(loaded, dict)
    return {str(key): value for key, value in loaded.items()}  # type: ignore[reportUnknownVariableType]


def test_converter_keeps_wording_and_marks_what_it_changes() -> None:
    converted = convert_vidal_html(
        "<P>Cmax <I>очень</I> <B>важно</B>: 10<SUP>9</SUP>/л, H<SUB>2</SUB>O, C<SUB>max</SUB>"
        " ТОР<SUP>&reg;</SUP> &lt;38&deg;C &quot;да&quot;.</P>"
        "<P>[PRING] тальк<BR />крахмал<IMG>logo.png</IMG></P>"
        "<UL><LI>один</LI><LI>два<UL><LI>вложенный</LI></UL></LI></UL>"
    )

    assert converted.blocks == (
        'Cmax очень важно: 10⁹/л, H₂O, Cmax ТОР® <38°C "да".',
        "Вспомогательные вещества: тальк",
        "крахмал",
        "- один\n- два\n- вложенный",
    )
    assert dict(converted.notes) == {
        "image-omitted": 1,
        "nested-list-flattened": 1,
        "token-expanded:[PRING]": 1,
    }


def test_converter_keeps_nested_lists_and_footnote_marks_as_text() -> None:
    converted = convert_vidal_html(
        "<P>в составе:</P><UL><UL><LI>лечение А;</LI><LI>профилактика Б;</LI></UL></UL>"
        "<P><SUP># </SUP>примечание</P><P>#1 не заголовок</P><P>* не превышает</P><P>*слитно</P>"
    )

    assert converted.blocks == (
        "в составе:",
        "- лечение А;\n- профилактика Б;",
        "\xa0# примечание",
        "#1 не заголовок",
        "\u200b* не превышает",
        "*слитно",
    )
    assert dict(converted.notes) == {
        "nested-list-flattened": 1,
        "leading-hash-protected": 1,
        "leading-bullet-mark-protected": 1,
    }


def test_converter_cuts_long_paragraphs_and_lists_between_words() -> None:
    sentence = "Препарат ускоряет метаболизм непрямых антикоагулянтов и других средств. "
    paragraph = sentence * 80  # about 5 800 characters in one paragraph
    items = "".join(f"<LI>пункт {index} {'х' * 60}</LI>" for index in range(120))

    converted = convert_vidal_html(f"<P>{paragraph}</P><UL>{items}</UL>")

    texts = [block for block in converted.blocks if not block.startswith("- ")]
    lists = [block for block in converted.blocks if block.startswith("- ")]
    assert len(texts) == 2
    assert all(len(block) <= 3000 for block in texts)
    assert all(
        block.endswith("средств.") for block in texts
    )  # cut after a sentence, never in a word
    assert " ".join(" ".join(texts).split()) == " ".join(paragraph.split())
    assert len(lists) > 1
    assert all(len(block) <= 2800 for block in lists)
    assert sum(block.count("пункт") for block in lists) == 120
    assert dict(converted.notes)["long-paragraph-split"] == 2


def test_converter_keeps_the_space_inside_a_script_tag() -> None:
    converted = convert_vidal_html(
        "<P>T<SUB>1/2 </SUB>составляет 80 мин; Аминосалициловая кислота повышает T<SUB>1/2 </SUB>"
        "изониазида; м<SUP>2</SUP> тела.</P>"
    )

    assert converted.blocks == (
        "T1/2 составляет 80 мин; Аминосалициловая кислота повышает T1/2 изониазида; м² тела.",
    )


def test_converter_turns_tables_into_pipe_tables_and_flags_spans() -> None:
    converted = convert_vidal_html(_SIDE_EFFECTS)

    assert converted.blocks == (
        "| Орган | Частота / Часто | Частота / Редко |\n"
        "| --- | --- | --- |\n"
        "| Кожа | сыпь |  |\n"
        "| Нервы; Мышцы |  | тремор |",
    )
    assert dict(converted.notes) == {"table-spans-flattened": 1}


def test_converter_splits_a_long_table_without_cutting_a_row() -> None:
    rows = "".join(f"<TR><TD>строка {index}</TD><TD>{'х' * 120}</TD></TR>" for index in range(60))
    converted = convert_vidal_html(
        f"<TABLE><TR><TD><B>А</B></TD><TD><B>Б</B></TD></TR>{rows}</TABLE>"
    )

    assert len(converted.blocks) > 1
    for block in converted.blocks:
        assert len(block) <= 2800
        assert block.startswith("| А | Б |\n| --- | --- |\n")
        assert all(line.startswith("| ") and line.endswith(" |") for line in block.splitlines())
    assert sum(block.count("строка") for block in converted.blocks) == 60
    assert dict(converted.notes)["table-split-for-chunks"] == len(converted.blocks) - 1


def test_plain_text_and_small_normalizers() -> None:
    assert plain_text("АНДРОГЕЛЬ<SUP>&reg;</SUP>") == "АНДРОГЕЛЬ®"
    assert plain_text(None) == ""
    assert normalize_registration_number("ЛП-№(002688)-(РГ-RU)") == "ЛП-002688"
    assert normalize_registration_number("Р N001781/01-2002") == "Р N001781/01-2002"
    assert dosage_form_text("&loz; таб., покр. пленочной оболочкой, 500 мг: 12 шт.") == (
        "таблетки, покрытые пленочной оболочкой"
    )
    assert dosage_form_text("р-р д/в/в введения 500 мг/5 мл: амп. 10 шт.") == (
        "раствор для внутривенного введения"
    )
    assert dosage_form_text("таб.диспергируемые 125 мг") == "таблетки диспергируемые"


def test_prepare_writes_one_document_per_vidal_row(vidal_db: Path, tmp_path: Path) -> None:
    output = tmp_path / "workspace"
    identities = [
        {"documentId": "esklp.mnn.testovin", "standardizedInn": "Тестовин"},
        {
            "documentId": "esklp.mnn.testovin-probacil",
            "standardizedInn": "Тестовин + Пробацил",
            "componentInns": ["Тестовин", "Пробацил"],
        },
    ]

    report = prepare_vidal_medications(vidal_db, output, esklp_identities=identities)

    assert report.documents == 3
    assert report.products_listed == 3
    assert report.products_without_document == 1
    assert report.documents_without_products == 1
    assert report.icd10_documents == 2
    assert report.mapping_counts == {"linked": 3, "ambiguous": 0, "unmatched": 0}
    assert report.document_types == {"Новая программа": 1, "Объединённая статья": 2}
    assert report.conversion_notes["token-expanded:[PRING]"] == 1
    assert report.conversion_notes["image-omitted"] == 1
    assert sorted(path.name for path in output.glob("*.md")) == [
        f"{DOCUMENT_PREFIX}1.md",
        f"{DOCUMENT_PREFIX}2.md",
        f"{DOCUMENT_PREFIX}3.md",
    ]
    manifest = yaml.safe_load((output / "manifest.yaml").read_text(encoding="utf-8"))
    assert manifest["id"] == MODULE_ID
    assert manifest["version"] == report.version_label


def test_document_carries_what_the_drug_screen_matches_on(vidal_db: Path, tmp_path: Path) -> None:
    output = tmp_path / "workspace"
    prepare_vidal_medications(
        vidal_db,
        output,
        esklp_identities=[{"documentId": "esklp.mnn.testovin", "standardizedInn": "Тестовин"}],
    )

    front = _front_matter(output / f"{DOCUMENT_PREFIX}1.md")
    metadata = front["metadata"]
    assert isinstance(metadata, dict)

    assert front["id"] == "drug.vidal.1"
    assert front["title"] == "ТЕСТОВИН (для приема внутрь)"
    assert front["short_title"] == "TESTOVIN"
    assert front["source_type"] == "allmed_reference"
    assert metadata["contentMode"] == "drug-reference-snapshot"
    assert metadata["referenceSourceName"] == "Видаль"
    assert metadata["sourceName"] == "Видаль (через Справочник врача MedElement), версия БД 28"
    assert metadata["rightsStatus"] == "personal-use-only"
    assert metadata["localOnly"] is True
    assert metadata["tradeName"] == "ТЕСТОВИН"
    assert metadata["nameLat"] == "TESTOVIN"
    assert metadata["linkedMnnDocumentId"] == "esklp.mnn.testovin"
    assert metadata["ingredientNames"] == ["ТЕСТОВИН"]
    assert metadata["tradeNames"] == ["Тестовин"]
    assert metadata["atcCodes"] == ["C09AA99"]
    assert metadata["registrationNumbers"] == ["ЛП-000123", "ЛС-000456"]
    assert metadata["holders"] == ["ЗАВОД ТЕСТ ООО (Россия)"]
    assert metadata["icd10Codes"] == ["I10"]
    assert metadata["yearEdition"] == 2014
    assert metadata["productionForm"] == "таблетки; капсулы"
    assert metadata["usage"] == {"pregnancy": "осторожно", "hepatic": "осторожно"}
    assert metadata["nonPrescription"] is False
    assert metadata["gnvls"] is True
    assert metadata["shortDescription"] == "Действует быстро."

    brand = _front_matter(output / f"{DOCUMENT_PREFIX}2.md")
    assert brand["title"] == "ТЕСТОВИН-ФОРТЕ®"
    brand_metadata = brand["metadata"]
    assert isinstance(brand_metadata, dict)
    assert brand_metadata["tradeName"] == "ТЕСТОВИН-ФОРТЕ®"
    assert brand_metadata["tradeNames"] == ["Тестовин-Форте®"]
    assert brand_metadata["nonPrescription"] is True
    assert brand_metadata["linkedMnnDocumentId"] == "esklp.mnn.testovin"

    combination = _front_matter(output / f"{DOCUMENT_PREFIX}3.md")["metadata"]
    assert isinstance(combination, dict)
    assert combination["ingredientNames"] == ["ТЕСТОВИН", "ПРОБАЦИЛ"]
    assert combination["mappingStatus"] == "unmatched"


def test_sections_follow_the_vidal_order_with_source_markers(
    vidal_db: Path, tmp_path: Path
) -> None:
    output = tmp_path / "workspace"
    prepare_vidal_medications(vidal_db, output)
    text = (output / f"{DOCUMENT_PREFIX}1.md").read_text(encoding="utf-8")

    headings = [line[2:] for line in text.splitlines() if line.startswith("# ")]
    assert headings == [
        "Карточка препарата",
        "Состав и форма выпуска",
        "Фармакологическая группа",
        "Фармакологическое действие",
        "Показания",
        "Нозологическая классификация (МКБ-10)",
        "Режим дозирования",
        "Побочные действия",
        "Применение при беременности и кормлении грудью",
        "Применение при нарушениях функции печени",
        "Лекарственное взаимодействие",
        "Условия отпуска из аптек",
        "Торговые названия и формы выпуска",
        "Сведения о статье",
    ]
    assert "Вспомогательные вещества: крахмал, тальк. Cmax 5 м²\n" in text
    assert "logo.png" not in text
    assert "- Беременность: осторожно\n- Кормление грудью: нет данных" in text
    assert "- Нарушение функции печени: осторожно" in text
    assert "Клинико-фармакологическая группа: Тестовая группа" in text
    assert "Код АТХ: C09AA99 — Тестовин" in text
    assert "- I10 — ЭССЕНЦИАЛЬНАЯ ГИПЕРТЕНЗИЯ" in text
    # The text keeps every nozology Vidal links; only single codes become `icd10Codes`.
    assert "- I10-I15 — БОЛЕЗНИ, ХАРАКТЕРИЗУЮЩИЕСЯ ВЫСОКИМ АД" in text
    assert "◊ — отпускается без рецепта." in text
    assert "- Тестовин — таб. 5 мг: 20 шт. · рег. № ЛП-№(000123)-(РГ-RU) · ЗАВОД ТЕСТ ООО" in text
    assert "Тип статьи: Объединённая статья\nГод редакции: 2014\nИсточник: Видаль (через" in text
    # Every paragraph has its own provenance marker, not only the first one of a section.
    dosage_start = text.index("# Режим дозирования")
    dosage = text[dosage_start : text.index("# Побочные действия")]
    assert dosage.count('"column":"Dosage"') == 3
    assert '"block":2' in dosage
    # A no-data state with no text is not a section.
    assert "Нарушение функции почек" not in text
    assert "Применение у детей" not in text


def test_workspace_loads_and_lints_as_a_content_pack(vidal_db: Path, tmp_path: Path) -> None:
    output = tmp_path / "workspace"
    prepare_vidal_medications(vidal_db, output)

    pack = load_content_pack(output)

    assert lint_content_pack(pack) == []
    assert {document.id for document in pack.documents} == {
        "drug.vidal.1",
        "drug.vidal.2",
        "drug.vidal.3",
    }
    first = next(document for document in pack.documents if document.id == "drug.vidal.1")
    assert first.source_type == "allmed_reference"
    assert first.metadata["rightsStatus"] == "personal-use-only"
    chunks = [chunk for section in first.sections for chunk in section.chunks]
    assert all(chunk.metadata.get("sourceSpans") for chunk in chunks)
    # A footnote paragraph that starts with «# » stays text of its section, not a new heading.
    assert any("# примечание к таблице" in chunk.original_text for chunk in chunks)
    assert "примечание к таблице" not in {section.title for section in first.sections}
    # The ICD projection reaches the search text of the indexed chunks.
    assert all("i10" in chunk.normalized_text for chunk in chunks)


def test_rerun_replaces_the_workspace(vidal_db: Path, tmp_path: Path) -> None:
    output = tmp_path / "workspace"
    prepare_vidal_medications(vidal_db, output)
    (output / "stale.md").write_text("old", encoding="utf-8")

    prepare_vidal_medications(vidal_db, output)

    assert not (output / "stale.md").exists()
    assert len(list(output.glob("*.md"))) == 3
    assert not [path for path in tmp_path.iterdir() if path.name.startswith(".workspace.")]


def test_rejects_a_database_that_is_not_vidal(tmp_path: Path) -> None:
    other = tmp_path / "other.db"
    sqlite3.connect(other).executescript("CREATE TABLE Document (DocumentID INTEGER);")

    with pytest.raises(ValueError, match="lacks tables"):
        prepare_vidal_medications(other, tmp_path / "workspace")
    with pytest.raises(ValueError, match="not a file"):
        prepare_vidal_medications(tmp_path / "missing.db", tmp_path / "workspace")


def test_cli_refuses_an_output_git_would_track(vidal_db: Path, tmp_path: Path) -> None:
    result = CliRunner().invoke(
        app,
        ["prepare-local-vidal", "--raw-input", str(vidal_db), "--output", str(tmp_path / "out")],
    )

    assert result.exit_code != 0
    assert not (tmp_path / "out").exists()
