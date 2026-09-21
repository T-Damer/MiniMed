"""Bind supplied etymology/name spans, without inferring translations or person identity."""
from __future__ import annotations

import sqlite3
from collections import defaultdict

from .definition_reference_pack import Projection, digest, encoded, number, obj, seq, text


def _offset(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 262144:
        raise ValueError('Invalid annotation code-point offset')
    return value


def write_reference_annotations(database: sqlite3.Connection, projection: Projection) -> dict[str, int]:
    owners: dict[tuple[str, str], set[str]] = defaultdict(set)
    for entry in projection.entries.values():
        for _, chunk_id in entry.links:
            owners[(entry.receipt, chunk_id)].add(entry.id)
    span_count = 0
    link_count = 0
    for receipt, raw in projection.annotations.items():
        annotations = obj(raw)
        # Numeric source IDs belong to this precise input, never to another shard/owner file.
        local_blocks = projection.annotation_block_maps.get(receipt, {})
        spans: list[tuple[str, str, dict[str, object], str | None]] = []
        for value in seq(annotations.get('etymologyStatements', []), 10000):
            row = obj(value)
            if row.get('reviewStatus') != 'requires-review':
                raise ValueError('Unsupported etymology review state')
            spans.append(('etymology', 'Происхождение: формулировка источника', row, text(row.get('sourceStatement'), 4096)))
        for value in seq(annotations.get('historicalMentions', []), 10000):
            row = obj(value)
            if (row.get('reviewStatus') != 'requires-review' or row.get('identityStatus') != 'unresolved'
                    or row.get('biography') is not None or row.get('discoveryClaim') is not None):
                raise ValueError('A source name does not establish a biography or discovery claim')
            label = text(row.get('sourceName'), 256)
            references = seq(row.get('references'), 1000)
            if not references:
                raise ValueError('Historical mention needs a source span')
            for ref in references:
                spans.append(('historical-mention', label, obj(ref), None))
        seen: set[str] = set()
        for kind, label, row, expected in spans:
            chunk_id = local_blocks.get(number(row.get('block')))
            if chunk_id is None:
                raise ValueError('Unresolved input-local annotation block')
            _, chunk = projection.chunks[chunk_id]
            start, end = _offset(row.get('start')), _offset(row.get('end'))
            if not 0 <= start < end <= len(chunk.original_text) or end - start > 4096:
                raise ValueError('Annotation span is outside its source block')
            actual = chunk.original_text[start:end]
            if expected is not None and actual != expected:
                raise ValueError('Etymology statement differs from the supplied source span')
            associated = owners.get((receipt, chunk_id), set())
            if not associated:
                raise ValueError('Annotation has no card/source-context membership')
            identity = 'reference.annotation.' + digest(encoded([receipt, chunk_id, kind, label, start, end]))
            if identity in seen:
                continue
            seen.add(identity)
            stored = database.execute('SELECT original_text FROM chunks WHERE id = ?', (chunk_id,)).fetchone()
            if stored is None or stored[0] != chunk.original_text:
                raise ValueError('Annotation source no longer matches the projected SQLite block')
            database.execute(
                'INSERT INTO definition_reference_annotation_spans VALUES (?, ?, ?, ?, ?, ?, ?)',
                (identity, receipt, chunk_id, kind, label, start, end),
            )
            for entity_id in sorted(associated):
                database.execute('INSERT INTO definition_reference_annotation_links VALUES (?, ?)', (entity_id, identity))
                link_count += 1
            span_count += 1
    return {'spans': span_count, 'links': link_count}
