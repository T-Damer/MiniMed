from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_form_070u import BLUEPRINT
from localmed_ingest.medical_forms import (
    Correction,
    FormBlueprint,
    FormSourceError,
    Row,
    anchor_found,
    apply_corrections,
    build_rows,
    correct_text,
    join_rows,
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
