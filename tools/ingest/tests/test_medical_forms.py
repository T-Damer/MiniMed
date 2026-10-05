from __future__ import annotations

import hashlib
import json
import re
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_form_070u import BLUEPRINT
from localmed_ingest.medical_forms import (
    FORM_BLUEPRINT_MODULES,
    Correction,
    FormBlueprint,
    FormSourceError,
    Row,
    anchor_found,
    apply_corrections,
    build_rows,
    correct_text,
    join_rows,
    load_blueprint,
    load_ocr_pages,
    normalise_code,
    prepare_form,
    sha256_file,
    split_list,
    split_paragraphs,
)

REPO = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO / "apps/app/src/features/forms/schemas/ru-minzdrav-274n-070u.json"
RAW = REPO / "data/raw/medical-forms"


def line(text: str, x: float, y: float, height: float = 0.02) -> dict[str, Any]:
    return {"text": text, "confidence": 1.0, "bbox": [x, y - height / 2, 0.1, height]}


def test_rows_rebuild_printed_lines_from_scrambled_fragments() -> None:
    # The scanner reports the small words of a line after the long one that follows it.
    fragments = load_ocr_pages(
        {
            "pages": [
                {
                    "page": 1,
                    "lines": [
                        line("накопленных", 0.13, 0.90),
                        line("данной медицинской организации", 0.20, 0.88),
                        line("из МИС", 0.13, 0.86),
                        line("в", 0.13, 0.885),
                    ],
                }
            ]
        }
    )[1]
    rows = build_rows(1, fragments)
    assert [row.text for row in rows] == [
        "накопленных",
        "в данной медицинской организации",
        "из МИС",
    ]
    assert [row.index for row in rows] == [0, 1, 2]


def test_footnote_fragments_and_bullets_are_dropped() -> None:
    fragments = load_ocr_pages(
        {
            "pages": [
                {
                    "page": 4,
                    "lines": [
                        line("• диагнозов по", 0.5, 0.5),
                        line("•", 0.2, 0.5),
                        line("4 Пункты 3 и 6 Порядка", 0.12, 0.10),
                    ],
                }
            ]
        },
        {4: 0.12},
    )[4]
    assert [fragment.text for fragment in fragments] == ["диагнозов по"]


def test_join_rows_repairs_hyphenated_compounds_only() -> None:
    assert join_rows(["санаторно-", "курортное лечение"]) == "санаторно-курортное лечение"
    assert join_rows(["срок -", "30 дней"]) == "срок - 30 дней"
    assert join_rows(["один", "", "два"]) == "один два"


def make_rows(*texts: str) -> list[Row]:
    return [Row(30, index, text, 0.1, 0.9 - index * 0.02, 1.0) for index, text in enumerate(texts)]


def test_paragraphs_split_on_numbers_and_keep_continuations() -> None:
    rows = make_rows(
        "6.10. В строке «СНИЛС»",
        "указывается номер.",
        "6.11. Строки «Диагноз»",
        "заполняются.",
        "В строке «Диагноз» указывается код.",
        "7. В месте печати",
    )
    paragraphs = split_paragraphs(rows)
    assert [paragraph.number for paragraph in paragraphs] == ["6.10", "6.11", "7"]
    assert paragraphs[1].text.endswith("указывается код.")
    assert paragraphs[1].spans() == [{"pdfPage": 30, "firstLine": 2, "lastLine": 4}]


def test_list_items_normalise_ocr_lookalike_codes_and_keep_duplicates_once() -> None:
    rows = make_rows(
        "6.4. В строке указывается код:",
        "«0I» - Алтайский край",
        "«1O» - Амурская область",
        "«/8» - Ярославская область",
        "«82» - Республика Дагестан",
        "«82» - Республика Дагестан",
        "«71 100» - Югра",
    )
    intro, items = split_list(rows)
    assert len(intro) == 1
    assert [item.code for item in items] == ["01", "10", "78", "82", "71 100"]
    assert normalise_code("б") == "6"


def test_item_continuation_lines_join_into_the_label() -> None:
    rows = make_rows("«3» - ветераны боевых действий,", "указанные в пункте 1;", "«4» - прочие")
    _, items = split_list(rows)
    assert items[0].label == "ветераны боевых действий, указанные в пункте 1"


def test_systematic_and_reviewed_corrections_are_logged() -> None:
    applied: list[Correction] = []
    rows = apply_corrections(make_rows("№ и Nº 025/у", "закон Nº 26-Ф3"), applied)
    assert [row.text for row in rows] == ["№ и № 025/у", "закон № 26-ФЗ"]
    assert {correction.source for correction in applied} == {"Nº", "Ф3"}

    reviewed = (Correction(35, "организации В санаторий", "организации в санаторий", "capital"),)
    log: list[Correction] = []
    assert correct_text("организации В санаторий", {35}, reviewed, log) == "организации в санаторий"
    assert correct_text("организации В санаторий", {34}, reviewed, log) == "организации В санаторий"
    assert len(log) == 1


def test_anchor_search_tolerates_ocr_slips_and_rejects_absent_text() -> None:
    page = (
        "Справка Nº для получения путевки на санаторно-курортное лечение\nПол: муж. - 1, жен. - 2"
    )
    assert anchor_found("Пол: муж. - 1, жен. - 2", page)
    assert anchor_found("для получения путёвки на санаторно-курортное лечение", page)
    assert not anchor_found("Место работы или учёбы пациента", page)


def mini_blueprint() -> FormBlueprint:
    field: dict[str, Any] = {
        "id": "snils",
        "label": "Страховой номер",
        "type": "text",
        "required": True,
        "requiredBasis": "source",
        "rule": {"status": "defined", "paragraphIds": ["6.10"]},
        "_anchor": "Страховой номер индивидуального лицевого счета",
    }
    return FormBlueprint(
        form_id="test.form",
        form_number="000/у",
        title="Тест",
        order_number="1н",
        order_date="2025-01-02",
        order_title="Тестовый приказ",
        registration={"authority": "Минюст", "number": "1", "date": "2025-01-03"},
        effective_from="2025-09-01",
        effective_until="2031-09-01",
        blank_appendix=1,
        blank_pages=(1,),
        rules_appendix=2,
        rules_pages=(2,),
        footnote_below={},
        corrections=(),
        fields=[field],
        code_lists={},
        sequential_lists={},
        sections=[{"id": "s", "title": "S", "fieldIds": ["snils"]}],
        layout={"page": {}, "blocks": []},
        notes=[],
    )


def write_ocr(path: Path, blank: list[dict[str, Any]], rules: list[dict[str, Any]]) -> None:
    path.write_text(
        json.dumps({"pages": [{"page": 1, "lines": blank}, {"page": 2, "lines": rules}]}),
        encoding="utf-8",
    )


def test_prepare_form_cuts_the_governing_paragraph_with_its_span(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [line("Страховой номер индивидуального лицевого счета:", 0.1, 0.5)],
        [
            line("6.10. В строке «Страховой номер»", 0.1, 0.9),
            line("указывается СНИЛС пациента.", 0.1, 0.88),
            line("6.11. Другое", 0.1, 0.86),
        ],
    )
    source = {
        "publicationUrl": "http://publication.pravo.gov.ru/document/1",
        "pdfUrl": "http://publication.pravo.gov.ru/file/pdf?eoNumber=1",
        "retrievedAt": "2026-10-05",
        "sha256": "0" * 64,
    }
    schema = prepare_form(mini_blueprint(), source, ocr)
    assert [rule["id"] for rule in schema["rules"]] == ["6.10"]
    rule = schema["rules"][0]
    assert rule["text"] == "6.10. В строке «Страховой номер» указывается СНИЛС пациента."
    assert rule["spans"] == [{"pdfPage": 2, "firstLine": 0, "lastLine": 1}]
    assert schema["source"]["extraction"]["blankLabelsVerified"] == 1
    assert schema["source"]["extraction"]["ocrSha256"] == sha256_file(ocr)
    assert "_anchor" not in schema["fields"][0]


def test_prepare_form_fails_when_a_caption_or_paragraph_is_missing(tmp_path: Path) -> None:
    source = {"publicationUrl": "x", "pdfUrl": "x", "retrievedAt": "2026-10-05", "sha256": "0" * 64}
    ocr = tmp_path / "ocr.json"
    write_ocr(ocr, [line("Совсем другая строка", 0.1, 0.5)], [line("6.10. Текст", 0.1, 0.9)])
    with pytest.raises(FormSourceError, match="printed caption"):
        prepare_form(mini_blueprint(), source, ocr)
    write_ocr(
        ocr,
        [line("Страховой номер индивидуального лицевого счета", 0.1, 0.5)],
        [line("6.11. Текст", 0.1, 0.9)],
    )
    with pytest.raises(FormSourceError, match=r"paragraph 6\.10"):
        prepare_form(mini_blueprint(), source, ocr)


# ----------------------------------------------------------------------- committed 070/у schema


def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_committed_schema_is_tied_to_the_official_source() -> None:
    schema = load_schema()
    source = schema["source"]
    assert schema["formNumber"] == "070/у"
    assert source["orderNumber"] == "274н"
    assert source["registration"]["number"] == "82433"
    assert source["publicationUrl"].startswith("http://publication.pravo.gov.ru/")
    assert source["sha256"] == "e385d12af60d1aa9a54f4e493addd10d21b764413c697d8eba43358f58a5dd3c"
    assert source["blankAppendix"] == {"number": 5, "pdfPages": [29]}


def test_every_defined_rule_cites_a_paragraph_and_undefined_ones_none() -> None:
    schema = load_schema()
    paragraph_ids = {rule["id"] for rule in schema["rules"]}
    for field in schema["fields"]:
        rule = field["rule"]
        if rule["status"] == "undefined":
            assert rule["paragraphIds"] == [], field["id"]
            assert rule.get("note"), field["id"]
        else:
            assert rule["paragraphIds"], field["id"]
            assert set(rule["paragraphIds"]) <= paragraph_ids, field["id"]


def test_code_lists_are_complete_and_prefill_is_declared_not_coded() -> None:
    schema = load_schema()
    fields = {field["id"]: field for field in schema["fields"]}
    assert [option["value"] for option in fields["climateCode"]["options"]] == [
        str(code) for code in range(1, 10)
    ]
    assert len(fields["regionCode"]["options"]) == 89
    assert len({option["value"] for option in fields["regionCode"]["options"]}) == 89
    assert fields["patientSex"]["prefill"] == {
        "sources": ["patient.sex"],
        "map": {"male": "1", "female": "2"},
    }
    assert fields["formDate"]["prefill"] == {"sources": ["today"]}
    assert fields["diagnosisIcd"]["required"] is True
    assert fields["comorbidities"]["required"] is False
    assert all(field["type"] != "signature" or "prefill" not in field for field in schema["fields"])


@pytest.mark.skipif(
    not (RAW / "0001202505300033.ocr.json").exists(),
    reason="official PDF and its OCR text are private raw data",
)
def test_committed_schema_matches_a_fresh_build_from_the_raw_source(tmp_path: Path) -> None:
    source = json.loads((RAW / "0001202505300033.source.json").read_text(encoding="utf-8"))
    rebuilt = prepare_form(BLUEPRINT, source, RAW / "0001202505300033.ocr.json")
    assert rebuilt == load_schema()


# ------------------------------------------------------------------ all forms of order 274н

SCHEMAS_DIR = REPO / "apps/app/src/features/forms/schemas"
SOURCE_SHA = "e385d12af60d1aa9a54f4e493addd10d21b764413c697d8eba43358f58a5dd3c"
FORMS = {
    "070u": ("070/у", 5, 6, 1),
    "072u": ("072/у", 7, 8, 2),
    "076u": ("076/у", 9, 10, 2),
    "079u": ("079/у", 11, 12, 2),
    "025-1u": ("025-1/у", 3, 4, 2),
}


def schema_for(key: str) -> dict[str, Any]:
    blueprint = load_blueprint(key)
    return json.loads((SCHEMAS_DIR / blueprint.schema_filename).read_text(encoding="utf-8"))


def test_every_blueprint_has_a_committed_schema_and_a_registry_entry() -> None:
    assert set(FORMS) == set(FORM_BLUEPRINT_MODULES)
    registry = json.loads((REPO / "tools/ingest/medical-form-sources.json").read_text("utf-8"))
    registered = {form["key"] for source in registry["sources"] for form in source["forms"]}
    assert registered == set(FORMS)
    assert registry["sources"][0]["sha256"] == SOURCE_SHA


@pytest.mark.parametrize("key", sorted(FORMS))
def test_committed_schema_is_tied_to_the_official_order(key: str) -> None:
    number, blank_appendix, rules_appendix, blank_pages = FORMS[key]
    schema = schema_for(key)
    source = schema["source"]
    assert schema["formNumber"] == number
    assert source["orderNumber"] == "274н"
    assert source["sha256"] == SOURCE_SHA
    assert source["publicationUrl"] == "http://publication.pravo.gov.ru/document/0001202505300033"
    assert source["blankAppendix"]["number"] == blank_appendix
    assert source["rulesAppendix"]["number"] == rules_appendix
    assert len(source["blankAppendix"]["pdfPages"]) == blank_pages
    # every printed caption was located in the OCR, or was confirmed on the scan and listed
    assert source["extraction"]["blankLabelsVerified"] > 0
    assert source["extraction"]["note"]


@pytest.mark.parametrize("key", sorted(FORMS))
def test_every_rule_status_is_honest_in_every_form(key: str) -> None:
    schema = schema_for(key)
    paragraph_ids = {rule["id"] for rule in schema["rules"]}
    for field in schema["fields"]:
        rule = field["rule"]
        if rule["status"] == "undefined":
            assert rule["paragraphIds"] == [], field["id"]
            assert rule.get("note"), field["id"]
        else:
            assert rule["paragraphIds"], field["id"]
            assert set(rule["paragraphIds"]) <= paragraph_ids, field["id"]
        assert field["type"] not in ("signature", "stamp") or "prefill" not in field
        if field["required"]:
            assert field.get("requiredBasis") in ("source", "editorial"), field["id"]


@pytest.mark.parametrize("key", sorted(FORMS))
def test_cited_paragraphs_carry_a_span_and_a_checksum(key: str) -> None:
    for rule in schema_for(key)["rules"]:
        assert rule["spans"], rule["id"]
        assert rule["textSha256"] == hashlib.sha256(rule["text"].encode("utf-8")).hexdigest()
        # no footnote marks or OCR look-alikes left in the cut paragraph
        assert not re.search(r"[®°]|[A-Za-z]+[а-я]|[а-я][A-Za-z]", rule["text"]), rule["id"]


def test_sanatorium_cards_share_the_code_lists_of_the_order() -> None:
    for key, region_paragraph in (("072u", "7.4"), ("076u", "7.7")):
        fields = {field["id"]: field for field in schema_for(key)["fields"]}
        assert len(fields["regionCode"]["options"]) == 89, key
        assert [option["value"] for option in fields["climateCode"]["options"]] == [
            str(code) for code in range(1, 10)
        ]
        assert [option["value"] for option in fields["socialSupportCode"]["options"]] == [
            str(code) for code in range(1, 11)
        ]
        assert fields["regionCode"]["rule"]["paragraphIds"][-1] == region_paragraph
        # the dash of the printed lists, the lost opening « and the Latin СССР are repaired
        labels = {option["value"]: option["label"] for option in fields["regionCode"]["options"]}
        assert labels["32"].endswith("Кузбасс") and " – " in labels["32"]
        assert labels["97"] == "Чувашская Республика"
        assert "СССР" in fields["socialSupportCode"]["options"][3]["label"]


def test_072u_binds_known_lines_and_leaves_the_return_coupon_to_the_sanatorium() -> None:
    fields = {field["id"]: field for field in schema_for("072u")["fields"]}
    assert fields["mainDiagnosis"]["prefill"] == {"sources": ["episode.diagnosis.text"]}
    assert fields["mainDiagnosis"]["required"] is True
    assert fields["mainDiagnosisIcd"]["required"] is True
    assert fields["treatmentDone"]["required"] is False
    assert fields["treatmentDone"]["rule"]["status"] == "by-line"
    assert fields["headOfDepartmentSignature"]["type"] == "signature"


def test_076u_adds_the_child_lines() -> None:
    fields = {field["id"]: field for field in schema_for("076u")["fields"]}
    for field_id in (
        "educationType",
        "vaccine3Name",
        "tuberculosisExamDate",
        "accessibleEnvironment",
        "noInfectionContact",
        "pediculosisExam",
        "helminthExam",
    ):
        assert field_id in fields
    assert fields["accessibleEnvironment"]["rule"]["paragraphIds"] == ["7.14"]


def test_079u_has_no_policy_and_marks_citizenship_as_undefined() -> None:
    fields = {field["id"]: field for field in schema_for("079u")["fields"]}
    assert "omsPolicyNumber" not in fields and "snils" not in fields
    assert fields["citizenship"]["rule"]["status"] == "undefined"
    assert fields["citizenship"]["prefill"] == {"sources": ["patient.citizenship"]}
    assert fields["noContraindications"]["required"] is True
    assert fields["anthropometryNote"]["multiple"] is True


def test_025_1u_has_the_numbered_items_and_the_tables() -> None:
    schema = schema_for("025-1u")
    fields = {field["id"]: field for field in schema["fields"]}
    assert schema["layout"]["page"]["orientation"] == "landscape"
    assert fields["surname"]["prefill"]["words"] == {"from": 0, "count": 1}
    assert fields["patronymic"]["prefill"]["words"] == {"from": 2}
    assert fields["workplace"]["prefill"] == {"sources": ["patient.workplace"]}
    assert fields["idDocType"]["rule"]["status"] == "undefined"
    assert fields["stayLocality"]["rule"]["status"] == "undefined"
    assert fields["prelimComplicationsSign"]["rule"]["status"] == "undefined"
    assert [option["value"] for option in fields["socialSupportCode"]["options"]] == [
        str(code) for code in range(1, 11)
    ]
    assert len([f for f in fields if f.startswith("visitDate")]) == 17
    assert len([f for f in fields if re.fullmatch(r"prescription\d[A-Z]\w+", f)]) == 30
    tables = [
        segment
        for block in schema["layout"]["blocks"]
        for column in block["columns"]
        for line in column["rows"]
        for segment in line["segments"]
        if segment["kind"] == "table"
    ]
    assert len(tables) == 2
    # the order's own wording is quoted where the OCR garbled the line
    texts = {rule["id"]: rule["text"] for rule in schema["rules"]}
    assert "со средним медицинским образованием" in texts["9.11"]
    assert texts["9.21"].startswith("9.21. В строке 27")
    assert "A00 - T98" in texts["9.13"]


@pytest.mark.skipif(
    not (RAW / "0001202505300033.ocr.json").exists(),
    reason="official PDF and its OCR text are private raw data",
)
@pytest.mark.parametrize("key", sorted(FORMS))
def test_every_committed_schema_matches_a_fresh_build(key: str) -> None:
    source = json.loads((RAW / "0001202505300033.source.json").read_text(encoding="utf-8"))
    blueprint = load_blueprint(key)
    assert prepare_form(blueprint, source, RAW / "0001202505300033.ocr.json") == schema_for(key)


def test_a_stale_reviewed_line_correction_fails_the_build(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [line("Страховой номер индивидуального лицевого счета", 0.1, 0.5)],
        [line("6.10. Текст абзаца", 0.1, 0.9)],
    )
    source = {"publicationUrl": "x", "pdfUrl": "x", "retrievedAt": "2026-10-05", "sha256": "0" * 64}
    stale = replace(
        mini_blueprint(),
        row_corrections=(
            Correction(2, "уже исправлено", "x", "the line changed in a new edition"),
        ),
    )
    with pytest.raises(FormSourceError, match="no longer applies"):
        prepare_form(stale, source, ocr)


def test_a_caption_the_ocr_dropped_needs_a_reviewed_entry(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(ocr, [line("Совсем другая строка", 0.1, 0.5)], [line("6.10. Текст", 0.1, 0.9)])
    source = {"publicationUrl": "x", "pdfUrl": "x", "retrievedAt": "2026-10-05", "sha256": "0" * 64}
    reviewed = replace(
        mini_blueprint(),
        scan_reviewed_captions=("Страховой номер индивидуального лицевого счета",),
    )
    schema = prepare_form(reviewed, source, ocr)
    extraction = schema["source"]["extraction"]
    assert extraction["blankLabelsVerified"] == 0
    assert extraction["captionsReviewedOnScan"] == [
        "Страховой номер индивидуального лицевого счета"
    ]


def test_a_row_correction_repairs_a_paragraph_marker_and_is_logged(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [line("Страховой номер индивидуального лицевого счета", 0.1, 0.5)],
        [line("6.9. Раньше", 0.1, 0.92), line("6.10 В строке «Страховой номер»", 0.1, 0.9)],
    )
    source = {"publicationUrl": "x", "pdfUrl": "x", "retrievedAt": "2026-10-05", "sha256": "0" * 64}
    fixed = replace(
        mini_blueprint(),
        row_corrections=(Correction(2, "6.10 В строке", "6.10. В строке", "lost dot"),),
    )
    schema = prepare_form(fixed, source, ocr)
    assert schema["rules"][0]["text"].startswith("6.10. В строке")
    assert schema["source"]["extraction"]["corrections"][0]["reason"] == "lost dot"
