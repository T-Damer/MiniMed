"""STATE DOSE1: the core's medication pointers lose the glued placeholder in their section titles."""

from __future__ import annotations

import json
import sqlite3

from localmed_ingest.esklp_strength_repair import (
    index_text,
    repair_pointer_pack,
    repair_pointer_title,
)
from localmed_ingest.sqlite_builder import schema_sql

CODE = "21.20.10.232-000033-1-00013-0000000000000"
FORM = "ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ПРИЕМА ВНУТРЬ"


def test_a_pointer_title_without_the_placeholder() -> None:
    text = f"- ТН: Колдакт Хот Дринк; форма/дозировка: {FORM} (325 мг + 10 мг + 20 мг)"
    assert repair_pointer_title(f"{CODE} — {FORM} — 1.0325 мг+10 мг+20 мг", text) == (
        f"{CODE} — {FORM} — 325 мг+10 мг+20 мг"
    )
    # A dosage the registry does not state leaves the title with its form.
    assert repair_pointer_title(
        f"{CODE} — ЭЛИКСИР — 1.0~", "- ТН: X; форма/дозировка: ЭЛИКСИР"
    ) == (f"{CODE} — ЭЛИКСИР")
    # A real dosage and a glued one the text does not confirm stay.
    assert repair_pointer_title(f"{CODE} — КАПСУЛЫ — 1.0мг", "- ТН: X") is None
    assert repair_pointer_title(f"{CODE} — КАПСУЛЫ — 30.0мг", "- ТН: X") is None
    assert repair_pointer_title(f"{CODE} — КАПСУЛЫ — 1.025 мг+6.25 мг/мл", "- ТН: X") is None


def test_a_title_is_repaired_by_what_the_module_repair_did_to_its_card() -> None:
    # The pointer's own text lists the dosage in other units; the card's repair is the evidence.
    changes = {"1.025 мг+6.25 мг/мл": "25 мг+6.25 мг/мл", "1.0~": None}
    assert repair_pointer_title(
        f"{CODE} — СУСПЕНЗИЯ — 1.025 мг+6.25 мг/мл", "- ТН: X", changes
    ) == (f"{CODE} — СУСПЕНЗИЯ — 25 мг+6.25 мг/мл")
    assert repair_pointer_title(f"{CODE} — СУСПЕНЗИЯ — 1.025 мг+6.25 мг/мл", "- ТН: X") is None
    assert (
        repair_pointer_title(f"{CODE} — ЭЛИКСИР — 1.0~", "- ТН: X", changes) == f"{CODE} — ЭЛИКСИР"
    )


def test_the_pointer_pack_is_repaired_in_place_with_its_ids_and_anchors() -> None:
    connection = sqlite3.connect(":memory:")
    connection.executescript(schema_sql(include_indexes=False))
    connection.execute(
        "INSERT INTO content_packs(id, version, schema_version, title, checksum, installed_at, enabled) "
        "VALUES ('p', '1', 2, 'p', '', '2026-10-15', 1)"
    )
    pointer = "core.catalog.pointer.medication.esklp.mnn.x-1"
    connection.execute(
        "INSERT INTO documents(id, content_pack_id, title, short_title, source_type, status, "
        "specialty_json, metadata_json, current_version_id) "
        "VALUES (?, 'p', 'ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН', NULL, 'core_catalog_pointer', 'active', "
        "'[]', '{}', 'v1')",
        (pointer,),
    )
    connection.execute(
        "INSERT INTO document_versions(id, document_id, version_label, source_checksum, extracted_at) "
        "VALUES ('v1', ?, '1', 'sha256:x', '2026-10-15')",
        (pointer,),
    )
    title = f"{CODE} — {FORM} — 1.0325 мг+10 мг+20 мг"
    connection.execute(
        "INSERT INTO sections(id, document_version_id, title, normalized_title, depth, order_index, "
        "anchor, path_json) VALUES ('s1', 'v1', ?, ?, 1, 0, 'a#s1', ?)",
        (title, index_text(title), json.dumps([title], ensure_ascii=False)),
    )
    text = (
        f"- ТН: Колдакт Хот Дринк; форма/дозировка: {FORM} (325 мг + 10 мг + 20 мг)\n"
        f"- ТН: ТераФлю; форма/дозировка: {FORM} (НЕ УКАЗАНО)"
    )
    connection.execute(
        "INSERT INTO chunks(id, document_version_id, section_id, order_index, original_text, "
        "normalized_text, anchor, metadata_json) VALUES ('c1', 'v1', 's1', 0, ?, ?, 'a#c1', '{}')",
        (
            text,
            index_text(f"ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН {title} {text}"),
        ),
    )

    report = repair_pointer_pack(connection)

    assert report == {"sectionsRetitled": 1, "chunksChanged": 1}
    row = connection.execute(
        "SELECT title, anchor, path_json, normalized_title FROM sections WHERE id = 's1'"
    ).fetchone()
    assert row[0] == f"{CODE} — {FORM} — 325 мг+10 мг+20 мг"
    assert row[1] == "a#s1"
    assert json.loads(row[2]) == [row[0]]
    assert row[3] == index_text(row[0])
    chunk = connection.execute("SELECT original_text, normalized_text FROM chunks").fetchone()
    assert "НЕ УКАЗАНО" not in chunk[0]
    assert chunk[0].endswith(f"- ТН: ТераФлю; форма/дозировка: {FORM}")
    assert "0325" not in chunk[1]
    assert repair_pointer_pack(connection) == {"sectionsRetitled": 0, "chunksChanged": 0}
