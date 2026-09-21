from __future__ import annotations

import copy
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_annotated_pack import build_annotated_definition_reference
from localmed_ingest.definition_reference_annotations import (
    load_annotation_projection,
    write_reference_annotations,
)
from localmed_ingest.definition_reference_pack import digest, encoded, obj, seq


BODY = '🔬 Пример: alpha означает «первый». Упомянут Example.'
ORIGIN = 'alpha означает «первый»'


def fixture(key: str = 'one', body: str = BODY) -> dict[str, object]:
    start = body.index('alpha')
    end = start + len(ORIGIN)
    name_start = body.index('Example')
    return {
        'version': 3, 'id': f'fixture.{key}', 'reviewStatus': 'requires-review',
        'publicationState': 'local-dev', 'textKind': 'source-excerpt',
        'sources': [{
            'id': 1, 'title': f'Synthetic source {key}', 'baseUrl': 'https://example.org/test/',
            'sourceType': 'fixture', 'authority': 'third-party', 'releaseEligible': False,
        }],
        'blocks': [{
            'id': 1, 'source': 1, 'text': body, 'textSha256': digest(body),
            'path': 'chapter', 'locator': 'Synthetic block 1',
        }],
        'terms': [{
            'id': f'fixture.{key}.term', 'title': f'Term {key}', 'kind': 'term', 'aliases': [],
            'blockIds': [1], 'coverage': 'definition',
        }],
        'etymologyStatements': [{
            'block': 1, 'start': start, 'end': end, 'sourceStatement': body[start:end],
            'reviewStatus': 'requires-review',
        }],
        'historicalMentions': [{
            'id': 'mention.local', 'sourceName': 'Example', 'identityStatus': 'unresolved',
            'biography': None, 'discoveryClaim': None, 'reviewStatus': 'requires-review',
            'references': [{'block': 1, 'start': name_start, 'end': name_start + 7}],
        }],
    }


def origin(payload: dict[str, object]) -> dict[str, object]:
    return obj(seq(payload['etymologyStatements'], 100)[0])


def history(payload: dict[str, object]) -> dict[str, object]:
    return obj(seq(payload['historicalMentions'], 100)[0])


def write(root: Path, payload: object, name: str = 'input.json') -> Path:
    path = root / name
    path.write_text(encoded(payload), encoding='utf-8')
    return Path(name)


def build(root: Path, payload: object) -> tuple[Path, dict[str, object]]:
    path = root / 'annotated.db'
    report = build_annotated_definition_reference(
        (write(root, payload),), path, input_root=root, edition_id='fixture.edition',
        version='0.1.0', built_at='2026-09-22',
    )
    return path, report


def test_exact_source_spans_and_no_medical_promotion(tmp_path: Path) -> None:
    path, report = build(tmp_path, fixture())
    assert report['annotations'] == {'spans': 2, 'links': 2}
    assert report['existingLogicalRowsUnchanged'] is True
    with closing(sqlite3.connect(path)) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert db.execute('SELECT schema_version FROM content_packs').fetchone() == (9,)
        assert db.execute('SELECT count(*) FROM knowledge_facts').fetchone() == (0,)
        assert db.execute('SELECT count(*) FROM knowledge_relations').fetchone() == (0,)
        rows = db.execute(
            'SELECT a.kind, substr(c.original_text, a.start_offset + 1, a.end_offset - a.start_offset) '
            'FROM definition_reference_annotation_spans a JOIN chunks c ON c.id=a.chunk_id '
            'ORDER BY a.kind'
        ).fetchall()
        assert rows == [('etymology', ORIGIN), ('historical-mention', 'Example')]
        assert db.execute('SELECT original_text FROM chunks WHERE original_text=?', (BODY,)).fetchone() == (BODY,)


def test_same_numeric_ids_in_two_input_namespaces_do_not_cross(tmp_path: Path) -> None:
    inputs = (write(tmp_path, fixture('one'), 'a.json'), write(tmp_path, fixture('two', BODY + ' Other.'), 'b.json'))
    projection, maps = load_annotation_projection(inputs, tmp_path)
    assert len(maps) == 2
    assert len({values[1] for values in maps.values()}) == 2
    output = tmp_path / 'base.db'
    projection.build(output, edition_id='fixture.edition', version='0.1.0', built_at='2026-09-22')
    with closing(sqlite3.connect(output)) as db, db:
        counts = write_reference_annotations(db, projection, maps)
        assert counts == {'spans': 4, 'links': 4}
        assert db.execute(
            "SELECT count(*) FROM definition_reference_annotation_links l "
            "JOIN definition_reference_annotation_spans a ON a.id=l.annotation_id "
            "JOIN knowledge_entities e ON e.id=l.entity_id "
            "WHERE a.input_sha256 != json_extract(e.metadata_json, '$.inputSha256')"
        ).fetchone() == (0,)


def test_identical_source_block_can_be_shared_without_merging_receipts(tmp_path: Path) -> None:
    first = fixture()
    second = copy.deepcopy(first)
    obj(seq(second['terms'], 10)[0])['id'] = 'fixture.other.term'
    inputs = (write(tmp_path, first, 'a.json'), write(tmp_path, second, 'b.json'))
    projection, maps = load_annotation_projection(inputs, tmp_path)
    assert len({values[1] for values in maps.values()}) == 1
    output = tmp_path / 'base.db'
    projection.build(output, edition_id='fixture.edition', version='0.1.0', built_at='2026-09-22')
    with closing(sqlite3.connect(output)) as db, db:
        assert write_reference_annotations(db, projection, maps) == {'spans': 4, 'links': 4}


def test_duplicate_source_spans_do_not_inflate_count(tmp_path: Path) -> None:
    payload = fixture()
    seq(payload['etymologyStatements'], 100).append(copy.deepcopy(origin(payload)))
    _, report = build(tmp_path, payload)
    assert report['annotations'] == {'spans': 2, 'links': 2}


@pytest.mark.parametrize(('field', 'value'), [
    ('block', 999), ('block', True), ('start', -1), ('start', True),
    ('end', 262145), ('end', 0), ('sourceStatement', 'Invented replacement'),
    ('reviewStatus', 'reviewed'),
])
def test_invalid_origin_does_not_publish(tmp_path: Path, field: str, value: object) -> None:
    payload = fixture()
    origin(payload)[field] = value
    with pytest.raises(ValueError):
        build(tmp_path, payload)
    assert not (tmp_path / 'annotated.db').exists()


@pytest.mark.parametrize(('field', 'value'), [
    ('identityStatus', 'resolved'), ('biography', 'Invented biography'),
    ('discoveryClaim', 'Invented priority'), ('references', []), ('reviewStatus', 'reviewed'),
])
def test_unreviewed_name_does_not_acquire_biography(tmp_path: Path, field: str, value: object) -> None:
    payload = fixture()
    history(payload)[field] = value
    with pytest.raises(ValueError):
        build(tmp_path, payload)


def test_context_membership_is_retained_but_unrelated_card_has_no_link(tmp_path: Path) -> None:
    payload = fixture()
    blocks = seq(payload['blocks'], 100)
    blocks.append({'id': 2, 'source': 1, 'text': 'Other definition', 'textSha256': digest('Other definition'), 'path': 'chapter', 'locator': 'Block 2'})
    terms = seq(payload['terms'], 10)
    terms.append({'id': 'fixture.unrelated', 'title': 'Other', 'kind': 'term', 'aliases': [], 'blockIds': [2], 'coverage': 'definition'})
    first = obj(terms[0])
    first['blockIds'] = [2]
    first['detailBlocks'] = [1]
    path, _ = build(tmp_path, payload)
    with closing(sqlite3.connect(path)) as db:
        assert db.execute('SELECT DISTINCT entity_id FROM definition_reference_annotation_links').fetchall() == [('fixture.one.term',)]


def test_missing_membership_rejects_annotation(tmp_path: Path) -> None:
    payload = fixture()
    seq(payload['blocks'], 100).append({'id': 2, 'source': 1, 'text': 'Other', 'textSha256': digest('Other'), 'path': 'chapter', 'locator': 'Block 2'})
    obj(seq(payload['terms'], 10)[0])['blockIds'] = [2]
    with pytest.raises(ValueError, match='membership'):
        build(tmp_path, payload)


def test_failure_rolls_back_prior_inserted_spans(tmp_path: Path) -> None:
    payload = fixture()
    obj(seq(history(payload)['references'], 100)[0])['end'] = 99999
    inputs = (write(tmp_path, payload),)
    projection, maps = load_annotation_projection(inputs, tmp_path)
    path = tmp_path / 'base.db'
    projection.build(path, edition_id='fixture.edition', version='0.1.0', built_at='2026-09-22')
    with closing(sqlite3.connect(path)) as db, db:
        with pytest.raises(ValueError):
            write_reference_annotations(db, projection, maps)
        for table in ('definition_reference_annotation_spans', 'definition_reference_annotation_links'):
            assert db.execute(f'SELECT count(*) FROM {table}').fetchone() == (0,)


def test_modified_source_text_cannot_receive_old_annotation(tmp_path: Path) -> None:
    inputs = (write(tmp_path, fixture()),)
    projection, maps = load_annotation_projection(inputs, tmp_path)
    path = tmp_path / 'base.db'
    projection.build(path, edition_id='fixture.edition', version='0.1.0', built_at='2026-09-22')
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('UPDATE chunks SET original_text=?', ('changed',))
        with pytest.raises(ValueError, match='SQLite block'):
            write_reference_annotations(db, projection, maps)


def test_no_annotations_is_an_explicit_empty_capability(tmp_path: Path) -> None:
    payload = fixture()
    payload.pop('etymologyStatements')
    payload.pop('historicalMentions')
    _, report = build(tmp_path, payload)
    assert report['annotations'] == {'spans': 0, 'links': 0}


def test_existing_output_remains_immutable(tmp_path: Path) -> None:
    path, _ = build(tmp_path, fixture())
    original = path.read_bytes()
    with pytest.raises(ValueError, match='immutable'):
        build(tmp_path, fixture())
    assert path.read_bytes() == original
