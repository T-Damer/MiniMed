from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from pydantic import TypeAdapter

from localmed_ingest.medication_aliases import build_medication_aliases
from localmed_ingest.models import Alias


def _write_documents(path: Path, rows: list[tuple[str, str, dict[str, object]]]) -> None:
    with closing(sqlite3.connect(path)) as connection:
        connection.execute(
            "CREATE TABLE documents(id TEXT, title TEXT, short_title TEXT, metadata_json TEXT)"
        )
        connection.execute("CREATE TABLE aliases(canonical_term TEXT, alias TEXT)")
        connection.executemany(
            "INSERT INTO documents VALUES (?, ?, NULL, ?)",
            [(doc_id, title, json.dumps(metadata)) for doc_id, title, metadata in rows],
        )
        connection.execute("INSERT INTO aliases VALUES ('Метамизол натрия', 'Уже известный')")
        connection.commit()


def test_alias_projection_preserves_evidence_and_never_splits_combination_inn(
    tmp_path: Path,
) -> None:
    core, allmed, grls = (tmp_path / name for name in ("core.db", "allmed.db", "grls.json"))
    _write_documents(
        core,
        [
            (
                "core.met",
                "Метамизол натрия",
                {
                    "catalogFamily": "medication",
                    "targetDocumentId": "esklp.met",
                    "moduleIds": ["medications"],
                },
            ),
            (
                "core.caf",
                "Кофеин",
                {"catalogFamily": "medication", "targetDocumentId": "esklp.caf"},
            ),
        ],
    )
    _write_documents(
        allmed,
        [
            ("allmed.1", "Анальгин", {"linkedMnnDocumentId": "esklp.met"}),
            ("allmed.2", "Уже известный", {"linkedMnnDocumentId": "esklp.met"}),
            ("allmed.3", "Без связи", {"linkedMnnDocumentId": "esklp.absent"}),
        ],
    )
    records = [
        ("Анальгин", ["Метамизол натрия"], "active"),
        ("Другое имя", ["Метамизол натрия"], "active"),
        ("Комбинация", ["Метамизол натрия", "Кофеин"], "active"),
        ("Архивное имя", ["Метамизол натрия"], "withdrawn"),
    ]
    grls.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "records": [
                    {
                        "registrationNumber": f"ЛП-{index}",
                        "tradeName": name,
                        "inn": inn,
                        "status": status,
                    }
                    for index, (name, inn, status) in enumerate(records)
                ],
            }
        ),
        encoding="utf-8",
    )
    originals = [path.read_bytes() for path in (core, allmed, grls)]
    result = build_medication_aliases(core, allmed, grls)
    aliases = TypeAdapter(list[Alias]).validate_python(result["aliases"])
    assert {(alias.alias, alias.canonical_term) for alias in aliases} == {
        ("Анальгин", "Метамизол натрия"),
        ("Другое имя", "Метамизол натрия"),
    }
    assert result["aliasCount"] == 2
    assert result["newSurfaceCount"] == 2
    evidence = TypeAdapter(dict[str, list[dict[str, object]]]).validate_python(result["evidence"])
    assert len(evidence[next(alias.id for alias in aliases if alias.alias == "Анальгин")]) == 2
    unresolved = TypeAdapter(list[dict[str, object]]).validate_python(result["unresolved"])
    assert {item["name"] for item in unresolved} == {"Без связи", "Комбинация"}
    assert build_medication_aliases(core, allmed, grls) == result
    assert [path.read_bytes() for path in (core, allmed, grls)] == originals
