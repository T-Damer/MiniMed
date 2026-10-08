from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from localmed_ingest.definition_reference_pack import Projection
from localmed_ingest.kim_definitions import extract, first_sentence, lead_definition


def test_first_sentence_skips_abbreviations_and_initials() -> None:
    text = "Толерантность (лат. tolerantia) – ослабление эффекта, т.е. привыкание. Далее текст."
    assert first_sentence(text) == (
        "Толерантность (лат. tolerantia) – ослабление эффекта, т.е. привыкание."
    )
    assert first_sentence("Без точки в конце") is None


def test_lead_requires_the_title_then_a_dash() -> None:
    lead = lead_definition(
        "**Депрессия** – психическое расстройство, проявляющееся снижением настроения. Причины.",
        "Депрессия",
    )
    assert lead == (
        "Депрессия",
        "Депрессия – психическое расстройство, проявляющееся снижением настроения.",
    )
    # A lead about something else, or without a definition shape, is not a definition.
    assert lead_definition("**Мигрень** – головная боль. Ещё.", "Депрессия") is None
    assert (
        lead_definition("**Депрессия** часто встречается у взрослых людей. Ещё.", "Депрессия")
        is None
    )


def test_dash_inside_bold_hyphen_variants_and_latin_lookalikes() -> None:
    assert lead_definition(
        "**Лейшманиоз**представляет собой инфекцию с механизмом. А.", "Лейшманиозы"
    )
    assert lead_definition(
        "**Синдром Элерса-Данлоса** – наследственная дисплазия ткани. А.",
        "Синдром Элерса - Данлоса",
    )
    assert lead_definition(
        "**Вирусный гепатит A** (болезнь Боткина) – острое поражение печени. А.", "Гепатит A"
    )
    assert lead_definition(
        "**Синдром Дориана Грея –**это психический феномен старения. А.", "Синдром Дориана Грея"
    )


def _module(path: Path) -> None:
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(
            "CREATE TABLE documents(id TEXT, title TEXT, metadata_json TEXT);"
            "CREATE TABLE document_versions(id TEXT, document_id TEXT, source_checksum TEXT);"
            "CREATE TABLE sections(id TEXT, document_version_id TEXT, title TEXT);"
            "CREATE TABLE chunks(id TEXT, section_id TEXT, order_index INT, "
            "original_text TEXT, anchor TEXT);"
        )
        metadata = json.dumps(
            {
                "officialSourceUrl": "https://www.krasotaimedicina.ru/diseases/psychiatric/depression",
                "fetchedAt": "2026-09-03T06:14:28Z",
                "entityType": "disease",
            }
        )
        connection.execute("INSERT INTO documents VALUES('d1','Депрессия',?)", (metadata,))
        connection.execute("INSERT INTO document_versions VALUES('v1','d1','sha256:abc')")
        connection.execute("INSERT INTO sections VALUES('s1','v1','Краткое описание')")
        connection.execute(
            "INSERT INTO chunks VALUES('c1','s1',0,?,'d1@v/краткое-описание#chunk-1')",
            ("**Депрессия** – психическое расстройство, проявляющееся снижением настроения.",),
        )
        connection.commit()


def test_extract_records_field_anchor_and_loads_as_a_draft_input(tmp_path: Path) -> None:
    database = tmp_path / "kim.db"
    _module(database)
    shard, report = extract(database, accessed="2026-09-04")
    (block,) = shard["blocks"]
    assert block["field"] == "psychiatry"
    assert block["anchor"] == "d1@v/краткое-описание#chunk-1"
    assert block["path"] == "diseases/psychiatric/depression"
    assert report["counts"]["extracted"] == 1
    projection = Projection()
    projection.add(shard, "2" * 64)
    (entry,) = projection.entries.values()
    assert entry.title == "Депрессия"
