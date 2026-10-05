"""Order 1094н: the preparer's multi-appendix rules and shared scan pages, and the three blanks."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_form_prescription import mask_scan
from localmed_ingest.medical_forms import (
    FormBlueprint,
    FormSourceError,
    Row,
    RulesSection,
    body_rows,
    load_blueprint,
    prepare_form,
)

SOURCE = {
    "publicationUrl": "http://publication.pravo.gov.ru/document/1",
    "pdfUrl": "http://publication.pravo.gov.ru/file/pdf?eoNumber=1",
    "retrievedAt": "2026-10-05",
    "sha256": "0" * 64,
}


def line(text: str, x: float, y: float, height: float = 0.02) -> dict[str, Any]:
    return {"text": text, "confidence": 1.0, "bbox": [x, y - height / 2, 0.1, height]}


def blueprint(**changes: Any) -> FormBlueprint:
    field: dict[str, Any] = {
        "id": "patient",
        "label": "Фамилия пациента",
        "type": "text",
        "required": False,
        "rule": {"status": "defined", "paragraphIds": ["3.6", "1.6"]},
        "_anchor": "Фамилия пациента",
    }
    base = FormBlueprint(
        form_id="test.rx",
        form_number="000-1/у",
        title="Тест",
        order_number="1н",
        order_date="2025-01-02",
        order_title="Тестовый приказ",
        registration={"authority": "Минюст", "number": "1", "date": "2025-01-03"},
        effective_from="2025-09-01",
        effective_until=None,
        blank_appendix=2,
        blank_pages=(1,),
        rules_appendix=3,
        rules_pages=(2,),
        footnote_below={},
        corrections=(),
        fields=[field],
        code_lists={},
        sequential_lists={},
        sections=[{"id": "s", "title": "S", "fieldIds": ["patient"]}],
        layout={"page": {}, "blocks": []},
        notes=[],
        extra_rules=(RulesSection(1, "Порядок назначения", (3,)),),
        rules_title="Порядок оформления",
    )
    return replace(base, **changes)


def write_ocr(path: Path, pages: list[list[dict[str, Any]]]) -> None:
    path.write_text(
        json.dumps({"pages": [{"page": n + 1, "lines": p} for n, p in enumerate(pages)]}),
        encoding="utf-8",
    )


def test_paragraph_numbers_of_two_appendices_stay_apart(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [
            [line("Фамилия пациента", 0.1, 0.5)],
            [
                line("6. В графе «Фамилия» указываются фамилия и инициалы.", 0.1, 0.9),
                line("7. Другое.", 0.1, 0.88),
            ],
            [
                line("6. Назначение оформляется на имя пациента.", 0.1, 0.9),
                line("7. Запрещается.", 0.1, 0.88),
            ],
        ],
    )
    schema = prepare_form(blueprint(), SOURCE, ocr)
    by_id = {rule["id"]: rule for rule in schema["rules"]}
    assert list(by_id) == ["1.6", "3.6"]
    assert by_id["3.6"]["text"].startswith("6. В графе «Фамилия» указываются")
    assert by_id["3.6"]["clause"] == "6"
    assert by_id["3.6"]["appendix"] == {"number": 3, "title": "Порядок оформления"}
    assert by_id["3.6"]["spans"] == [{"pdfPage": 2, "firstLine": 0, "lastLine": 0}]
    assert by_id["1.6"]["text"] == "6. Назначение оформляется на имя пациента."
    assert by_id["1.6"]["appendix"] == {"number": 1, "title": "Порядок назначения"}
    assert by_id["1.6"]["spans"] == [{"pdfPage": 3, "firstLine": 0, "lastLine": 0}]


def test_single_appendix_blueprints_keep_bare_ids_and_no_appendix(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [[line("Фамилия пациента", 0.1, 0.5)], [line("6. Указывается фамилия.", 0.1, 0.9)], []],
    )
    field = {**blueprint().fields[0], "rule": {"status": "defined", "paragraphIds": ["6"]}}
    schema = prepare_form(
        blueprint(extra_rules=(), fields=[field], rules_title="Порядок заполнения"), SOURCE, ocr
    )
    assert [rule["id"] for rule in schema["rules"]] == ["6"]
    assert "appendix" not in schema["rules"][0]
    assert "clause" not in schema["rules"][0]


def test_a_page_number_printed_low_does_not_join_the_paragraph(tmp_path: Path) -> None:
    rows = [
        Row(7, 0, "2", 0.5, 0.952, 1.0),
        Row(7, 1, "лекарственных препаратов.", 0.1, 0.92, 1.0),
        Row(7, 2, "1. Новый пункт", 0.1, 0.90, 1.0),
    ]
    assert [row.text for row in body_rows(rows)] == ["лекарственных препаратов.", "1. Новый пункт"]
    # a number-like line deep in the page is text, not a page number
    assert [row.text for row in body_rows([Row(7, 0, "10", 0.5, 0.5, 1.0)])] == ["10"]


def test_captions_are_searched_only_in_the_region_of_the_form(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [
            [
                line("Оборотная сторона предыдущего бланка", 0.1, 0.9),
                line("Фамилия пациента", 0.1, 0.3),
            ],
            [line("6. Указывается.", 0.1, 0.9)],
            [line("6. Указывается.", 0.1, 0.9)],
        ],
    )
    # caption sits at y=0.3: found in the lower half, absent from the upper one
    prepare_form(blueprint(blank_regions={1: (0.0, 0.5)}), SOURCE, ocr)
    with pytest.raises(FormSourceError, match="printed caption"):
        prepare_form(blueprint(blank_regions={1: (0.5, 1.0)}), SOURCE, ocr)


# ------------------------------------------------------------------ the three committed blanks

REPO = Path(__file__).resolve().parents[3]
SCHEMAS = REPO / "apps/app/src/features/forms/schemas"
RAW = REPO / "data/raw/medical-forms"
SHA = "fee584611033934a601644b7423390b201125f917ed85d382b4236b162e83c7e"
FORMS: dict[str, tuple[str, str, tuple[int, ...]]] = {
    "107-1u": ("ru.minzdrav.1094n.107-1u", "107-1/у", (23, 24)),
    "148-1u-88": ("ru.minzdrav.1094n.148-1u-88", "148-1/у-88", (24, 25)),
    "148-1u-04l": ("ru.minzdrav.1094n.148-1u-04l", "148-1/у-04(л)", (25, 26)),
}


def committed(key: str) -> dict[str, Any]:
    form_id = FORMS[key][0]
    path = SCHEMAS / f"{form_id.replace('.', '-')}.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("key", sorted(FORMS))
def test_blank_is_tied_to_order_1094n_and_its_dates(key: str) -> None:
    form_id, number, pages = FORMS[key]
    schema = committed(key)
    source = schema["source"]
    assert schema["id"] == form_id
    assert schema["formNumber"] == number
    assert source["orderNumber"] == "1094н"
    assert source["orderDate"] == "2021-11-24"
    assert source["registration"] == {
        "authority": "Министерство юстиции Российской Федерации",
        "number": "66124",
        "date": "2021-11-30",
    }
    assert source["sha256"] == SHA
    assert source["pdfPages"] == 43
    assert source["effectiveFrom"] == "2022-03-01"
    assert source["effectiveUntil"] == "2028-03-01"
    assert source["blankAppendix"] == {"number": 2, "pdfPages": list(pages)}
    assert source["rulesAppendix"] == {"number": 3, "pdfPages": list(range(27, 35))}
    assert "01.03.2022 по 01.03.2028" in schema["edition"]


@pytest.mark.parametrize("key", sorted(FORMS))
def test_every_cited_paragraph_names_its_appendix_and_clause(key: str) -> None:
    schema = committed(key)
    for rule in schema["rules"]:
        appendix, clause = rule["id"].split(".", 1)
        assert rule["appendix"]["number"] == int(appendix)
        assert rule["clause"] == clause
        assert rule["appendix"]["number"] in (1, 3)
        assert rule["text"].startswith(f"{clause}. ")
        assert all(span["pdfPage"] in (*range(6, 18), *range(27, 35)) for span in rule["spans"])
    ids = {rule["id"] for rule in schema["rules"]}
    for field in schema["fields"]:
        rule = field["rule"]
        if rule["status"] == "undefined":
            assert rule["paragraphIds"] == [] and rule.get("note"), field["id"]
        else:
            assert rule["paragraphIds"] and set(rule["paragraphIds"]) <= ids, field["id"]


@pytest.mark.parametrize("key", sorted(FORMS))
def test_cited_texts_carry_no_recogniser_artefacts(key: str) -> None:
    for rule in committed(key)["rules"]:
        text = rule["text"]
        assert "/y" not in text and "Nº" not in text and "ATX" not in text, rule["id"]
        assert "NO5" not in text and "NOS" not in text and "!*" not in text, rule["id"]
        assert " - " not in text, rule["id"]
        assert "  " not in text and not text.endswith(("*", '"', "'")), rule["id"]


def test_corrected_clauses_read_as_printed_in_the_order() -> None:
    texts = {rule["id"]: rule["text"] for rule in committed("148-1u-04l")["rules"]}
    assert (
        texts["3.15"] == {rule["id"]: rule["text"] for rule in committed("107-1u")["rules"]}["3.15"]
    )
    schema_107 = {rule["id"]: rule["text"] for rule in committed("107-1u")["rules"]}
    assert (
        "(код N05A), анксиолитикам (код N05B), снотворным и седативным средствам (код N05C)"
        in (schema_107["3.15"])
    )
    assert "(указывается прописью на рецептурном бланке формы № 107/у-НП);" in schema_107["3.11"]
    assert "из аптечной организации или индивидуальным предпринимателем" in schema_107["1.23"]
    assert "медицинского работника, а также печатью" in schema_107["1.23"]
    assert schema_107["3.1"].count("формы формы") == 1  # the order prints the word twice
    assert schema_107["3.1"].endswith("изготавливаются исключительно типографским способом.")
    assert "субъекта Российской Федерации, соответствующий" in schema_107["3.1"]


def test_each_blank_cites_the_clauses_of_its_own_lines() -> None:
    cited = {key: {rule["id"] for rule in committed(key)["rules"]} for key in FORMS}
    assert {"3.1", "3.2", "3.6", "3.7", "3.10", "3.11", "3.14", "3.15", "3.17", "1.23"} <= cited[
        "107-1u"
    ]
    assert {"3.9", "1.20"} <= cited["148-1u-88"] and "1.23" not in cited["148-1u-88"]
    assert {"3.5", "3.8", "3.9", "3.18", "1.21", "1.22"} <= cited["148-1u-04l"]
    assert "1.23" not in cited["148-1u-04l"] and "3.8" not in cited["107-1u"]


@pytest.mark.parametrize("key", sorted(FORMS))
def test_prefill_is_declared_and_never_reaches_signatures_or_stamps(key: str) -> None:
    schema = committed(key)
    fields = {field["id"]: field for field in schema["fields"]}
    for field in fields.values():
        if field["type"] in ("signature", "stamp"):
            assert "prefill" not in field, field["id"]
    for name in ("patientFullName", "doctorFullName"):
        assert fields[name]["prefill"]["format"] == "initials"
        assert fields[name]["required"] is True
    assert fields["patientFullName"]["prefill"]["sources"] == ["patient.fullName"]
    assert fields["doctorFullName"]["prefill"]["sources"] == ["clinician.fullName"]
    assert fields["patientBirthDate"]["prefill"] == {"sources": ["patient.birthDate"]}
    assert fields["recipeDate"]["prefill"] == {"sources": ["today"]}


def test_blank_specific_fields_and_latin_captions_stay_verbatim() -> None:
    f107 = {field["id"]: field for field in committed("107-1u")["fields"]}
    assert {"prescription1", "prescription2", "prescription3"} <= set(f107)
    assert f107["prescription1"]["required"] and not f107["prescription2"]["required"]
    f88 = {field["id"]: field for field in committed("148-1u-88")["fields"]}
    assert f88["addressOrCard"]["rule"]["paragraphIds"] == ["3.9"]
    assert f88["prescription"]["label"] == "Rp:"
    f04 = {field["id"]: field for field in committed("148-1u-04l")["fields"]}
    assert [option["value"] for option in f04["fundingSource"]["options"]] == ["1", "2", "3"]
    assert [option["value"] for option in f04["validity"]["options"]] == ["15", "30", "90"]
    assert f04["dtd"]["label"] == "D.t.d." and f04["signa"]["label"] == "Signa:"
    assert f04["nosologyCode"]["prefill"] == {"sources": ["episode.diagnosis.icd10"]}
    assert f04["omsPolicyNumber"]["prefill"]["sources"] == ["patient.omsPolicy.number"]
    assert f04["snils"]["prefill"]["sources"] == ["patient.snils"]
    assert f04["signa"]["rule"]["status"] == "by-line"


def printed_text(schema: dict[str, Any]) -> str:
    chunks: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("kind") in ("text", "stamp") and "text" in value:
                chunks.append(str(value["text"]))
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(schema["layout"])
    return " ".join(chunks)


def test_the_print_reproduces_the_pages_of_the_order() -> None:
    for key, sheets in (("107-1u", 2), ("148-1u-88", 2), ("148-1u-04l", 2)):
        schema = committed(key)
        blocks = schema["layout"]["blocks"]
        breaks = [block["id"] for block in blocks if block.get("pageBreakBefore")]
        assert len(breaks) == sheets - 1, key
        assert schema["layout"]["page"]["orientation"] == "portrait"
    text_04l = printed_text(committed("148-1u-04l"))
    assert "Министерство здравоохранения" in text_04l and "МЕСТО ДЛЯ ШТРИХКОДА*" in text_04l
    assert "<*> В случае изготовления рецептурного бланка" in text_04l
    assert "(линия отрыва)" in text_04l and "Корешок рецептурного бланка" in text_04l
    assert "(дата оформления-рецепта)" in printed_text(committed("148-1u-88"))
    assert "руб.|коп.| Rp." in printed_text(committed("107-1u"))


@pytest.mark.parametrize("key", sorted(FORMS))
def test_the_notes_say_the_print_is_a_draft_and_the_size_is_not_stated(key: str) -> None:
    notes = " ".join(committed(key)["notes"])
    assert "черновик-образец" in notes and "юридической силы не имеет" in notes
    assert "Приказ не указывает размер этих бланков" in notes
    assert "01.03.2022 по 01.03.2028" in notes


@pytest.mark.skipif(
    not (RAW / "0001202111300115.ocr.json").exists(),
    reason="official PDF and its OCR text are private raw data",
)
@pytest.mark.parametrize("key", sorted(FORMS))
def test_committed_schema_matches_a_fresh_build_from_the_raw_source(key: str) -> None:
    source = json.loads((RAW / "0001202111300115.source.json").read_text(encoding="utf-8"))
    rebuilt = prepare_form(load_blueprint(key), source, RAW / "0001202111300115.ocr.json")
    assert rebuilt == committed(key)


@pytest.mark.skipif(
    not (RAW / "0001202111300115.pdf").exists(),
    reason="official PDF and its OCR text are private raw data",
)
def test_mask_scan_keeps_only_the_share_of_a_shared_page(tmp_path: Path) -> None:
    out = mask_scan("148-1u-88", tmp_path)
    ocr = json.loads((out / "0001202111300115.ocr.json").read_text(encoding="utf-8"))
    pages = {entry["page"]: entry["lines"] for entry in ocr["pages"]}
    on_24 = " ".join(line["text"] for line in pages[24])
    assert "Министерство здравоохранения" in on_24 and "Оборотная сторона" not in on_24
    assert "Приготовил" not in on_24 and "Форма рецептурного бланка" not in on_24
    on_25 = " ".join(line["text"] for line in pages[25])
    assert "Оборотная сторона" in on_25 and "Серия" not in on_25 and "СНИЛС" not in on_25
    # pages outside the blank are untouched
    assert len(pages[30]) == len(
        {
            e["page"]: e["lines"]
            for e in json.loads((RAW / "0001202111300115.ocr.json").read_text("utf-8"))["pages"]
        }[30]
    )
    split_107 = mask_scan("107-1u", tmp_path / "107")
    ocr_107 = json.loads((split_107 / "0001202111300115.ocr.json").read_text(encoding="utf-8"))
    validity = [
        line["text"] for entry in ocr_107["pages"] if entry["page"] == 23 for line in entry["lines"]
    ]
    assert "(указать количсство дней)" in validity  # the merged recogniser line is split in two
    assert not any("точение 60 дней, до 1 года (указать" in text for text in validity)
