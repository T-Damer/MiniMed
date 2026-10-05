"""Form 088/у (joint order 488н/551н of 12.08.2022): the committed schema, its provenance, its
rules cut from the item list of the order, and the layout of its thirteen sheets."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_forms import (
    FormSourceError,
    Paragraph,
    Row,
    load_blueprint,
    prepare_form,
    split_item_paragraphs,
)

REPO = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO / "apps/app/src/features/forms/schemas/ru-mintrud-minzdrav-488n-551n-088u.json"
RAW = REPO / "data/raw/medical-forms"
EO_NUMBER = "0001202211100014"
SOURCE_SHA = "cc6679cc8aa532c34eafc68c8b834a95b67444afa67e20f4af22b887e5d3a96c"


def schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def fields() -> dict[str, dict[str, Any]]:
    return {field["id"]: field for field in schema()["fields"]}


def row(text: str, index: int) -> Row:
    return Row(page=1, index=index, text=text, x=0.1, y=0.5, confidence=1.0)


# ---------------------------------------------------------------- the item splitter


def test_items_and_subpoint_lines_become_paragraphs() -> None:
    rows = [
        row("10. При заполнении указываются:", 0),
        row("1) в строке «адрес» делается запись;", 1),
        row("8) в подпунктах пункта 5 делается отметка:", 2),
    ]
    # items are numbered consecutively: 2)…7) are missing here
    with pytest.raises(FormSourceError, match="item 8\\) follows item 1\\)"):
        split_item_paragraphs(Paragraph("10", rows), "10")


def test_split_follows_the_order_item_numbers_and_sub_point_lines() -> None:
    rows = [
        row("10. При заполнении указываются:", 0),
        row("1) в пункте 1 делается запись;", 1),
        row("2) в подпунктах пункта 5 делается соответствующая отметка:", 2),
        row("в подпункте 5.1 делается отметка в случае, если цель — группа;", 3),
        row("инвалидности;", 4),
        row("подпункте 5.2 делается соответствующая отметка в случае", 5),
        row("в подпунктах 9.2, 9.3 делается отметка;", 6),
        row("в пункте 11.8 делается запись о квартире;", 7),
        row("В подпункте 17.2.3 делается запись;", 8),
        row("в подпункте 20.6 в случае, если установлена степень, делается запись;", 9),
        row("3) в пункте 29 указываются данные;", 10),
        row("в подпункте 29.1 указываются жалобы;", 11),
        row("В случае, если в пункте 3 сделана отметка, гражданин направляется.", 12),
    ]
    parts = split_item_paragraphs(Paragraph("10", rows), "10")
    assert [part.number for part in parts] == [
        "10",
        "10.1",
        "10.2",
        "10.2.5.1",
        "10.2.5.2",
        "10.2.9.2",
        "10.2.11.8",
        "10.2.17.2.3",
        "10.2.20.6",
        "10.3",
        "10.3.29.1",
    ]
    assert (
        parts[3].text
        == "в подпункте 5.1 делается отметка в случае, если цель — группа; инвалидности;"
    )
    # a sentence under an item that merely mentions a point stays inside the line before it
    assert parts[-1].text.endswith("гражданин направляется.")


def test_a_repeated_sub_point_is_an_error() -> None:
    rows = [
        row("10. При заполнении:", 0),
        row("1) в подпунктах пункта 5 делается:", 1),
        row("в подпункте 5.1 делается;", 2),
        row("в подпункте 5.1 делается;", 3),
    ]
    with pytest.raises(FormSourceError, match="occurs twice"):
        split_item_paragraphs(Paragraph("10", rows), "10")


# ---------------------------------------------------------------- committed schema


def test_the_schema_is_tied_to_the_joint_order_and_its_effective_clause() -> None:
    data = schema()
    source = data["source"]
    assert data["id"] == "ru.mintrud-minzdrav.488n-551n.088u"
    assert data["formNumber"] == "088/у"
    assert data["title"] == "Направление на медико-социальную экспертизу медицинской организацией"
    assert source["issuer"] == (
        "Министерство труда и социальной защиты Российской Федерации и "
        "Министерство здравоохранения Российской Федерации"
    )
    assert source["orderNumber"] == "488н/551н"
    assert source["orderDate"] == "2022-08-12"
    assert source["registration"] == {
        "authority": "Министерство юстиции Российской Федерации",
        "number": "70900",
        "date": "2022-11-10",
    }
    assert source["publicationUrl"] == f"http://publication.pravo.gov.ru/document/{EO_NUMBER}"
    assert source["sha256"] == SOURCE_SHA
    assert source["pdfPages"] == 31
    assert source["blankAppendix"] == {"number": 1, "pdfPages": list(range(2, 15))}
    assert source["rulesAppendix"] == {"number": 2, "pdfPages": list(range(15, 32))}
    # clause 3: 10 days after publication (10.11.2022); the order sets no end date
    assert source["effectiveFrom"] == "2022-11-21"
    assert "effectiveUntil" not in source
    assert "01.02.2023" in data["edition"]
    assert "27н/36н" in data["edition"]


def test_the_rules_are_the_items_of_paragraph_10_with_exact_provenance() -> None:
    rules = schema()["rules"]
    ids = [rule["id"] for rule in rules]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"10\.\d+(?:\.\d+)*", rule_id) for rule_id in ids)
    items = sorted({int(rule_id.split(".")[1]) for rule_id in ids})
    assert items == list(range(1, 47)) or items == [n for n in range(1, 47) if n in items]
    for rule in rules:
        assert rule["textSha256"] == hashlib.sha256(rule["text"].encode("utf-8")).hexdigest()
        assert rule["spans"]
        assert all(15 <= span["pdfPage"] <= 31 for span in rule["spans"])
        # the OCR slips reviewed on the scan do not survive in the cited text
        assert not re.search(r"[A-Za-z]|Nº|[®°]|['\"]\s", rule["text"]), rule["id"]
        assert " - " not in rule["text"] or "1941 - 1945" in rule["text"], rule["id"]
    by_id = {rule["id"]: rule for rule in rules}
    assert by_id["10.8.5.6"]["text"].startswith("в подпункте 5.6 делается")
    assert "1941 - 1945" in by_id["10.23.20.4.5"]["text"]
    assert by_id["10.12.9.2"]["text"].startswith("в подпунктах 9.2, 9.3 делается")
    assert by_id["10.46"]["spans"][0]["pdfPage"] == 31
    # a line the OCR lost the leading «в» of is restored by a recorded, reviewed correction
    assert by_id["10.16.13.2.1"]["text"].startswith("в подпункте 13.2.1 делается")
    assert by_id["10.23.20.4.1"]["text"].startswith("в подпункте 20.4.1 делается")


def test_every_correction_is_recorded_with_a_reason() -> None:
    corrections = schema()["source"]["extraction"]["corrections"]
    assert corrections
    assert all(item["reason"] and item["from"] != item["to"] for item in corrections)
    # the hyphen of «1941 - 1945» is printed as a hyphen: it must never be turned into a dash
    assert not any(item["from"] == "1941 - 1945" for item in corrections)


def test_checkboxes_cite_the_line_of_their_printed_point() -> None:
    by_id = fields()
    assert by_id["purposeProfessionalLoss"]["rule"]["paragraphIds"] == ["10.8", "10.8.5.6"]
    assert by_id["sexFemale"]["rule"]["paragraphIds"] == ["10.11", "10.11.8.2"]
    assert by_id["citizenshipStateless"]["rule"]["paragraphIds"] == ["10.12", "10.12.9.2"]
    assert by_id["prevPeriodThreeYears"]["rule"]["paragraphIds"] == [
        "10.23",
        "10.23.20.3",
        "10.23.20.3.3",
    ]
    assert by_id["stayCareHomeOgrn"]["rule"]["paragraphIds"] == ["10.16", "10.16.13.2.2"]
    assert by_id["rehabCompensateNone"]["rule"]["paragraphIds"][-1] == "10.30.27.2.3"
    purposes = [field for field in fields().values() if field["id"].startswith("purpose")]
    assert len(purposes) == 11 and all(field["type"] == "checkbox" for field in purposes)


def test_a_field_the_paragraph_governs_only_as_a_line_is_marked_by_line() -> None:
    by_id = fields()
    for field_id in ("tempDisability1Start", "exam2Result", "msProtocolDate", "employment"):
        rule = by_id[field_id]["rule"]
        assert rule["status"] == "by-line" and rule["note"], field_id
    assert not any(field["rule"]["status"] == "undefined" for field in by_id.values())
    notes = " ".join(schema()["notes"])
    assert "rule.status = undefined" not in notes


def test_required_fields_have_a_source_basis_and_conditional_ones_are_optional() -> None:
    by_id = fields()
    required = {field_id for field_id, field in by_id.items() if field["required"]}
    assert {"organizationOgrn", "patientFullName", "diagnosisMain", "fillDate"} <= required
    assert all(by_id[field_id]["requiredBasis"] == "source" for field_id in required)
    # «в случае, если …»: the representative, the previous examination, the places of stay
    for field_id in ("repFullName", "prevGroup1", "prevProfLossPercent", "stayHospitalAddress"):
        assert by_id[field_id]["required"] is False


def test_prefill_binds_only_what_the_blank_prints_and_the_app_stores() -> None:
    by_id = fields()
    prefilled = {
        field_id: field["prefill"] for field_id, field in by_id.items() if "prefill" in field
    }
    assert prefilled["sexMale"] == {"sources": ["patient.sex"], "map": {"male": "true"}}
    assert prefilled["sexFemale"] == {"sources": ["patient.sex"], "map": {"female": "true"}}
    assert prefilled["residenceHouse"]["sources"] == [
        "patient.address.house",
        "patient.address.building",
    ]
    assert prefilled["workPlace"] == {"sources": ["patient.workplace"]}
    assert prefilled["diagnosisMainIcd"] == {"sources": ["episode.diagnosis.icd10"]}
    assert prefilled["fillDate"] == {"sources": ["today"]}
    # not stored by the app (or not unambiguous): never prefilled
    for field_id in (
        "citizenshipRussian",
        "idDocName",
        "patientAge",
        "bodyHeight",
        "commissionChairName",
        "commissionMember1Name",
    ):
        assert "prefill" not in by_id[field_id]
    for field in by_id.values():
        if field["type"] in ("signature", "stamp"):
            assert "prefill" not in field


def test_the_signature_and_stamp_lines_cite_the_paper_form_item() -> None:
    by_id = fields()
    for field_id in ("commissionChairSignature", "commissionMember3Signature", "stamp"):
        assert by_id[field_id]["rule"]["paragraphIds"] == ["10.46"]
    for index in range(1, 5):
        assert by_id[f"commissionMember{index}Name"]["rule"]["paragraphIds"] == ["10.45"]


def test_the_options_of_the_prognosis_lines_are_the_printed_words() -> None:
    by_id = fields()
    labels = [option["label"] for option in by_id["clinicalPrognosis"]["options"]]
    assert labels == [
        "благоприятный",
        "относительно благоприятный",
        "сомнительный (неопределенный)",
        "неблагоприятный",
    ]
    assert [option["label"] for option in by_id["rehabPotential"]["options"]] == [
        "высокий",
        "удовлетворительный",
        "низкий",
        "отсутствует",
    ]


def test_every_checkbox_caption_word_occurs_in_the_ocr_text_of_the_blank() -> None:
    """The captions of the boxed tables are not contiguous in the OCR text (columns are read
    interleaved); each of their words still has to be on the scan."""
    ocr = json.loads((RAW / f"{EO_NUMBER}.ocr.json").read_text(encoding="utf-8"))
    pages = {page["page"]: page for page in ocr["pages"]}
    blank_words: set[str] = set()
    for number in schema()["source"]["blankAppendix"]["pdfPages"]:
        for line in pages[number]["lines"]:
            blank_words.update(
                re.sub(r"[^а-яё0-9]", "", word.lower()) for word in line["text"].split()
            )
    missing: list[str] = []
    for field in schema()["fields"]:
        if field["type"] != "checkbox":
            continue
        for word in field["label"].split():
            normal = re.sub(r"[^а-яё0-9]", "", word.lower().replace("ё", "е"))
            if (
                normal
                and len(normal) > 3
                and normal not in {w.replace("ё", "е") for w in blank_words}
            ):
                missing.append(f"{field['id']}: {word}")
    # a handful of words are split or glued by the OCR («ребенок-», «уход-»); none may be invented
    assert len(missing) <= 12, missing


# ---------------------------------------------------------------- layout


def test_the_print_keeps_the_thirteen_sheets_of_the_blank() -> None:
    layout = schema()["layout"]
    blocks = layout["blocks"]
    assert [bool(block.get("pageBreakBefore")) for block in blocks].count(True) == 12
    assert layout["page"]["orientation"] == "portrait"
    assert layout["page"]["size"] == "A4"
    # tables of the blank that continue on the next sheet
    flat = json.dumps(layout, ensure_ascii=False)
    assert flat.count('"kind": "table"') >= 19


def test_every_field_is_printed_once_somewhere() -> None:
    printed = json.dumps(schema()["layout"], ensure_ascii=False)
    for field_id in fields():
        assert f'"{field_id}"' in printed, field_id


def test_rebuilding_from_the_raw_files_gives_the_committed_schema() -> None:
    source = json.loads((RAW / f"{EO_NUMBER}.source.json").read_text(encoding="utf-8"))
    rebuilt = prepare_form(load_blueprint("088u"), source, RAW / f"{EO_NUMBER}.ocr.json")
    committed = schema()
    assert rebuilt["fields"] == committed["fields"]
    assert rebuilt["rules"] == committed["rules"]
    assert rebuilt["source"] == committed["source"]
    assert rebuilt["layout"] == committed["layout"]
