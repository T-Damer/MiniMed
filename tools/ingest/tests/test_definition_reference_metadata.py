from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference
from localmed_ingest.definition_reference_layout import reference_content_digest
from localmed_ingest.definition_reference_metadata import (
    MARKER,
    compact_reference_metadata,
    encode_metadata,
    metadata_digest,
)
from localmed_ingest.definition_reference_pack import obj, seq
from test_definition_reference_pack import fixture, write_input


def repeated_fixture() -> dict[str, object]:
    payload = fixture()
    for block in seq(payload['blocks'], 100):
        obj(block).update({
            'documentId': 'source.fixture.' + 'a' * 200,
            'documentVersionId': 'edition.fixture.' + 'b' * 200,
            'nested': {'source': 'source.fixture.' + 'a' * 200, 'null': None},
        })
    return payload


def build_metadata(root: Path, *, compact: bool, filename: str) -> tuple[Path, dict[str, object]]:
    write_input(root, repeated_fixture())
    output = root / filename
    report = build_compact_definition_reference(
        (Path('input.json'),), output, input_root=root, edition_id='fixture.reference',
        version='1', built_at='2026-09-21', compact_metadata=compact,
    )
    return output, report


def test_complete_logical_tables_survive_metadata_encoding(tmp_path: Path) -> None:
    old_path, _ = build_metadata(tmp_path, compact=False, filename='old.db')
    new_path, report = build_metadata(tmp_path, compact=True, filename='new.db')
    with closing(sqlite3.connect(old_path)) as old, closing(sqlite3.connect(new_path)) as new:
        assert reference_content_digest(old, compact=True) == reference_content_digest(
            new, compact=True, restored_metadata=True
        )
        assert new.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        assert new.execute('PRAGMA foreign_key_check').fetchall() == []
        assert new.execute("SELECT value FROM app_metadata WHERE key='schema_version'").fetchone() == ('8',)
        assert new.execute('SELECT count(*) FROM definition_reference_metadata_programs').fetchone()[0] > 0
    assert report['logicalRoundTripEqual'] is True
    assert report['postVacuumFtsIntegrity'] == 'ok'
    assert obj(report['metadataCompaction'])['exactRoundTripEqual'] is True


def test_json_serialization_not_just_parsed_values_is_preserved(tmp_path: Path) -> None:
    path, _ = build_metadata(tmp_path, compact=False, filename='raw.db')
    shared = json.dumps('long \\ escaped " string ' + 'x' * 220)
    with closing(sqlite3.connect(path)) as db, db:
        ids = db.execute('SELECT id FROM chunks ORDER BY id').fetchall()
        for index, (identity,) in enumerate(ids):
            raw = (' { "definitionReference": 1, "x": ' + shared + ', "y": ' + shared
                   + ', "a": [null,true,false,1.0,3e+4,-0,"\\uD83D\\uDE00","\\u0000"],'
                   + ' "unicode": "é ё", "ordinal": ' + str(index) + ' } ')
            db.execute('UPDATE chunks SET metadata_json=? WHERE id=?', (raw, identity))
        before = metadata_digest(db, restored=False)
        result = compact_reference_metadata(db)
        assert result['encodedChunks'] == len(ids)
        assert metadata_digest(db, restored=True) == before
        assert db.execute('SELECT count(*) FROM chunks WHERE metadata_json=?', (MARKER,)).fetchone()[0] == len(ids)


@pytest.mark.parametrize('program', [
    '["start",999999999,"end"]', '["start",{},"end"]',
    '["start",true,"end"]', '["start",1.0,"end"]',
])
def test_dangling_or_invalid_program_returns_no_partial_metadata(
    tmp_path: Path, program: str,
) -> None:
    path, _ = build_metadata(tmp_path, compact=True, filename='corrupt.db')
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('UPDATE definition_reference_metadata_programs SET program_json=?', (program,))
        assert db.execute(
            'SELECT count(*) FROM definition_reference_chunks WHERE metadata_json IS NULL'
        ).fetchone()[0] > 0
        with pytest.raises(ValueError, match='Unresolved'):
            metadata_digest(db, restored=True)


def test_missing_program_or_dictionary_never_becomes_empty_object(tmp_path: Path) -> None:
    path, _ = build_metadata(tmp_path, compact=True, filename='missing.db')
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('DELETE FROM definition_reference_metadata_fragments')
        assert db.execute('SELECT count(*) FROM definition_reference_chunks WHERE metadata_json IS NULL').fetchone()[0] > 0
        db.execute('DELETE FROM definition_reference_metadata_programs')
        assert db.execute('SELECT count(*) FROM definition_reference_chunks WHERE metadata_json IS NULL').fetchone()[0] > 0


def test_program_limits_and_nonprofitable_tokens_stay_inline() -> None:
    token = json.dumps('z' * 200)
    raw = '[' + ','.join([token] * 100) + ']'
    assert encode_metadata(raw, {token: 1}) is None
    assert encode_metadata('{"small":"one"}', {'"one"': 1}) is None
    assert encode_metadata('{"small":"one"}', {}) is None


def test_bad_view_rolls_back_all_source_mutations(tmp_path: Path) -> None:
    path, _ = build_metadata(tmp_path, compact=False, filename='rollback.db')
    with closing(sqlite3.connect(path)) as db, db:
        before = metadata_digest(db, restored=False)
        db.execute('DROP VIEW definition_reference_chunks')
        db.execute("CREATE VIEW definition_reference_chunks AS SELECT id, 'wrong' AS metadata_json FROM chunks")
        with pytest.raises(ValueError, match='exact source'):
            compact_reference_metadata(db)
        assert metadata_digest(db, restored=False) == before
        assert db.execute('SELECT count(*) FROM definition_reference_metadata_fragments').fetchone() == (0,)
        assert db.execute('SELECT count(*) FROM definition_reference_metadata_programs').fetchone() == (0,)


@pytest.mark.parametrize('change', [
    {'publicationState': 'published'}, {'reviewStatus': 'reviewed'},
    {'linkLayout': 'unknown'}, {'metadataLayout': 'already-transformed'},
])
def test_only_explicit_new_draft_layout_is_accepted(tmp_path: Path, change: dict[str, str]) -> None:
    path, _ = build_metadata(tmp_path, compact=False, filename='state.db')
    with closing(sqlite3.connect(path)) as db, db:
        row = db.execute("SELECT value FROM app_metadata WHERE key='definition_reference'").fetchone()
        manifest = obj(json.loads(row[0]))
        manifest.update(change)
        db.execute("UPDATE app_metadata SET value=? WHERE key='definition_reference'", (json.dumps(manifest),))
        before = metadata_digest(db, restored=False)
        with pytest.raises(ValueError, match='Only new'):
            compact_reference_metadata(db)
        assert metadata_digest(db, restored=False) == before


def test_repeated_metadata_encoding_and_existing_output_are_rejected(tmp_path: Path) -> None:
    path, _ = build_metadata(tmp_path, compact=True, filename='immutable.db')
    before = path.read_bytes()
    with closing(sqlite3.connect(path)) as db, pytest.raises(ValueError, match='start empty'):
        compact_reference_metadata(db)
    with pytest.raises(ValueError, match='immutable'):
        build_metadata(tmp_path, compact=True, filename='immutable.db')
    assert path.read_bytes() == before
