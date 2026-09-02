from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.esklp_grls_crosswalk import build_esklp_crosswalk


def _write_pack(path: Path, records: list[dict[str, object]]) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "CREATE TABLE documents (id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL)"
        )
        connection.executemany(
            "INSERT INTO documents(id, metadata_json) VALUES (?, ?)",
            [(record["documentId"], json.dumps(record, ensure_ascii=False)) for record in records],
        )
        connection.commit()
    finally:
        connection.close()


def _mnn(
    document_id: str,
    standardized_inn: str,
    trade_name: str,
    registration_number: str,
    *,
    smnn_code: str,
    dosage_form: str,
    strength: str,
    klp_code: str,
) -> dict[str, object]:
    return {
        "documentId": document_id,
        "contentMode": "esklp-mnn",
        "standardizedInn": standardized_inn,
        "smnnNodes": [
            {
                "smnnCode": smnn_code,
                "standardizedInn": standardized_inn,
                "dosageForm": dosage_form,
                "strength": strength,
                "tradeNames": [
                    {
                        "tradeName": trade_name,
                        "registrationNumber": registration_number,
                        "dosageForm": dosage_form,
                        "strength": strength,
                    }
                ],
                "klpPositions": [
                    {
                        "klpCode": klp_code,
                        "tradeName": trade_name,
                        "registrationNumber": registration_number,
                        "dosageForm": dosage_form,
                        "strength": strength,
                    }
                ],
            }
        ],
    }


def test_exact_registration_keeps_nurofen_variants_separate(tmp_path: Path) -> None:
    pack = tmp_path / "esklp.db"
    _write_pack(
        pack,
        [
            _mnn(
                "esklp.mnn.ibuprofen",
                "ИБУПРОФЕН",
                "Нурофен",
                "ЛП-NUROFEN",
                smnn_code="SMNN-SUSPENSION",
                dosage_form="СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
                strength="100 мг/5 мл",
                klp_code="KLP-NUROFEN",
            ),
            _mnn(
                "esklp.mnn.ibuprofen-codeine",
                "ИБУПРОФЕН+КОДЕИН",
                "Нурофен плюс",
                "П N012229/01",
                smnn_code="SMNN-PLUS",
                dosage_form="ТАБЛЕТКИ",
                strength="200 мг+10 мг",
                klp_code="KLP-PLUS",
            ),
            _mnn(
                "esklp.mnn.ibuprofen-paracetamol",
                "ИБУПРОФЕН+ПАРАЦЕТАМОЛ",
                "Нурофен Интенсив",
                "ЛП-INTENSIVE",
                smnn_code="SMNN-INTENSIVE",
                dosage_form="ТАБЛЕТКИ",
                strength="400 мг",
                klp_code="KLP-INTENSIVE",
            ),
        ],
    )

    crosswalk = build_esklp_crosswalk([pack])

    nurofen = crosswalk.resolve("ЛП-NUROFEN", "Нурофен")
    plus = crosswalk.resolve("П N012229/01", "Нурофен плюс")
    intensive = crosswalk.resolve("ЛП-INTENSIVE", "Нурофен Интенсив")
    assert nurofen is not None and nurofen.status == "matched"
    assert plus is not None and plus.status == "matched"
    assert intensive is not None and intensive.status == "matched"
    assert nurofen.mnn_document_id == "esklp.mnn.ibuprofen"
    assert plus.mnn_document_id == "esklp.mnn.ibuprofen-codeine"
    assert intensive.mnn_document_id == "esklp.mnn.ibuprofen-paracetamol"
    trademarked = crosswalk.resolve("ЛП-NUROFEN", "Нурофен®")
    assert trademarked is not None and trademarked.status == "matched"
    assert {
        nurofen.registration_number,
        plus.registration_number,
        intensive.registration_number,
    } == {
        "ЛП-NUROFEN",
        "П N012229/01",
        "ЛП-INTENSIVE",
    }


def test_one_registration_preserves_multiple_smnn_presentations_and_klp_codes(
    tmp_path: Path,
) -> None:
    pack = tmp_path / "esklp.db"
    record = _mnn(
        "esklp.mnn.ibuprofen",
        "ИБУПРОФЕН",
        "Нурофен",
        "ЛП-SAME",
        smnn_code="SMNN-SUSPENSION",
        dosage_form="СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
        strength="100 мг/5 мл",
        klp_code="KLP-SUSPENSION",
    )
    nodes = record["smnnNodes"]
    assert isinstance(nodes, list)
    nodes.append(
        {
            "smnnCode": "SMNN-PACKAGE",
            "standardizedInn": "ИБУПРОФЕН",
            "dosageForm": "СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
            "strength": "100 мг/5 мл",
            "tradeNames": [
                {
                    "tradeName": "Нурофен",
                    "registrationNumber": "ЛП-SAME",
                    "dosageForm": "СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
                    "strength": "100 мг/5 мл",
                }
            ],
            "klpPositions": [
                {
                    "klpCode": "KLP-PACKAGE",
                    "tradeName": "Нурофен",
                    "registrationNumber": "ЛП-SAME",
                    "dosageForm": "СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
                    "strength": "100 мг/5 мл",
                }
            ],
        }
    )
    _write_pack(pack, [record])

    entry = build_esklp_crosswalk([pack]).resolve("ЛП-SAME", "Нурофен")

    assert entry is not None and entry.status == "matched"
    assert len(entry.presentations) == 2
    assert {item.smnn_code for item in entry.presentations} == {
        "SMNN-SUSPENSION",
        "SMNN-PACKAGE",
    }
    assert {code for item in entry.presentations for code in item.klp_codes} == {
        "KLP-SUSPENSION",
        "KLP-PACKAGE",
    }


def test_different_registrations_never_merge_same_mnn_presentation_shape(
    tmp_path: Path,
) -> None:
    pack = tmp_path / "esklp.db"
    first = _mnn(
        "esklp.mnn.ibuprofen",
        "ИБУПРОФЕН",
        "Нурофен",
        "ЛП-FIRST",
        smnn_code="SMNN-TABLETS",
        dosage_form="ТАБЛЕТКИ",
        strength="200 мг",
        klp_code="KLP-FIRST",
    )
    second = _mnn(
        "esklp.mnn.ibuprofen",
        "ИБУПРОФЕН",
        "Нурофен",
        "ЛП-SECOND",
        smnn_code="SMNN-TABLETS",
        dosage_form="ТАБЛЕТКИ",
        strength="200 мг",
        klp_code="KLP-SECOND",
    )
    first_nodes = first["smnnNodes"]
    second_nodes = second["smnnNodes"]
    assert isinstance(first_nodes, list) and isinstance(second_nodes, list)
    first_nodes.extend(second_nodes)
    _write_pack(pack, [first])

    crosswalk = build_esklp_crosswalk([pack])

    first_entry = crosswalk.resolve("ЛП-FIRST", "Нурофен")
    second_entry = crosswalk.resolve("ЛП-SECOND", "Нурофен")
    assert first_entry is not None and second_entry is not None
    assert [item.registration_number for item in first_entry.presentations] == ["ЛП-FIRST"]
    assert [item.registration_number for item in second_entry.presentations] == ["ЛП-SECOND"]
    assert {item.klp_codes[0] for item in first_entry.presentations} == {"KLP-FIRST"}
    assert {item.klp_codes[0] for item in second_entry.presentations} == {"KLP-SECOND"}


def test_different_mnn_and_incompatible_trade_name_are_not_silently_linked(
    tmp_path: Path,
) -> None:
    pack = tmp_path / "esklp.db"
    first = _mnn(
        "esklp.mnn.first",
        "ПЕРВЫЙ МНН",
        "ТН один",
        "ЛП-CONFLICT",
        smnn_code="SMNN-1",
        dosage_form="ТАБЛЕТКИ",
        strength="10 мг",
        klp_code="KLP-1",
    )
    second = _mnn(
        "esklp.mnn.second",
        "ВТОРОЙ МНН",
        "ТН два",
        "ЛП-CONFLICT",
        smnn_code="SMNN-2",
        dosage_form="ТАБЛЕТКИ",
        strength="10 мг",
        klp_code="KLP-2",
    )
    _write_pack(pack, [first, second])

    crosswalk = build_esklp_crosswalk([pack])
    conflicting = crosswalk.resolve("ЛП-CONFLICT", "ТН один")
    incompatible = crosswalk.resolve("ЛП-CONFLICT", "Другой препарат")

    assert conflicting is not None and conflicting.status == "ambiguous"
    assert len(conflicting.standardized_inns) == 2
    assert incompatible is not None and incompatible.status == "ambiguous"
    assert any("отсутствует" in reason for reason in incompatible.ambiguity_reasons)


def test_different_mnn_document_ids_conflict_even_with_same_inn(tmp_path: Path) -> None:
    pack = tmp_path / "esklp.db"
    first = _mnn(
        "esklp.mnn.ibuprofen.first",
        "ИБУПРОФЕН",
        "Нурофен первый",
        "ЛП-SAME-INN",
        smnn_code="SMNN-FIRST",
        dosage_form="ТАБЛЕТКИ",
        strength="200 мг",
        klp_code="KLP-FIRST",
    )
    second = _mnn(
        "esklp.mnn.ibuprofen.second",
        "ИБУПРОФЕН",
        "Нурофен второй",
        "ЛП-SAME-INN",
        smnn_code="SMNN-SECOND",
        dosage_form="ТАБЛЕТКИ",
        strength="200 мг",
        klp_code="KLP-SECOND",
    )
    _write_pack(pack, [first, second])

    entry = build_esklp_crosswalk([pack]).resolve("ЛП-SAME-INN", "Нурофен первый")

    assert entry is not None and entry.status == "ambiguous"
    assert entry.standardized_inns == ["ИБУПРОФЕН"]
    assert set(entry.mnn_document_ids) == {
        "esklp.mnn.ibuprofen.first",
        "esklp.mnn.ibuprofen.second",
    }
    assert entry.mnn_document_id is None
    assert entry.standardized_inn is None
    assert any("разными документами МНН" in reason for reason in entry.ambiguity_reasons)


def test_directory_input_ignores_unrelated_json_report(tmp_path: Path) -> None:
    directory = tmp_path / "packs"
    directory.mkdir()
    pack = directory / "esklp.db"
    _write_pack(
        pack,
        [
            _mnn(
                "esklp.mnn.paracetamol",
                "ПАРАЦЕТАМОЛ",
                "Парацетамол",
                "ЛП-DIRECTORY",
                smnn_code="SMNN-PARA",
                dosage_form="ТАБЛЕТКИ",
                strength="500 мг",
                klp_code="KLP-PARA",
            )
        ],
    )
    (directory / "module-build-report.json").write_text(
        json.dumps({"documents": 1}), encoding="utf-8"
    )

    entry = build_esklp_crosswalk([directory]).resolve("ЛП-DIRECTORY", "Парацетамол")

    assert entry is not None and entry.status == "matched"


def test_json_catalog_is_supported_without_writing_back(tmp_path: Path) -> None:
    catalog = tmp_path / "esklp.json"
    record = _mnn(
        "esklp.mnn.paracetamol",
        "ПАРАЦЕТАМОЛ",
        "Парацетамол",
        "ЛП-PARA",
        smnn_code="SMNN-PARA",
        dosage_form="ТАБЛЕТКИ",
        strength="500 мг",
        klp_code="KLP-PARA",
    )
    catalog.write_text(json.dumps({"records": [record]}, ensure_ascii=False), encoding="utf-8")

    crosswalk = build_esklp_crosswalk([catalog])

    entry = crosswalk.resolve("ЛП-PARA", "Парацетамол")
    assert entry is not None and entry.status == "matched"
    assert entry.mnn_document_id == "esklp.mnn.paracetamol"
    assert catalog.read_text(encoding="utf-8") == json.dumps(
        {"records": [record]}, ensure_ascii=False
    )


def test_missing_input_is_explicit() -> None:
    with pytest.raises(ValueError, match="At least one ESKLP"):
        build_esklp_crosswalk([])
