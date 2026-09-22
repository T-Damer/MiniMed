"""Compact new journal batches without duplicating bibliography or losing local references.

The per-article source projections remain authoring evidence. Only bounded bundles become
runtime manifest inputs; no term, source text, table or clinical meaning is rewritten.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .definition_reference_pack import Projection, digest, encoded, normalized_name, number, obj, seq, text
from .definition_source_manifest import read_source_manifest, write_source_manifest
from .definition_source_policy import require_active_definition_source

MAX_BUNDLE_BYTES = 8 * 1024 * 1024


def remap_article(payload: object, sources: dict[int, int], blocks: dict[int, int]) -> dict[str, object]:
    """Remap only declared numeric fields; missing references fail instead of being guessed."""
    result = copy.deepcopy(obj(payload))
    if result.get('version') != 3 or result.get('textKind') != 'source-excerpt':
        raise ValueError('Expected a V3 journal source projection')
    if result.get('etymologyStatements') or result.get('historicalMentions'):
        raise ValueError('Source annotations require their dedicated mapping adapter')
    try:
        for value in seq(result.get('sources'), 1000):
            row = obj(value)
            row['id'] = sources[number(row['id'])]
        for value in seq(result.get('blocks'), 100000):
            row = obj(value)
            row['id'] = blocks[number(row['id'])]
            row['source'] = sources[number(row['source'])]
            if 'sourceSpan' in row:
                span = obj(row['sourceSpan'])
                span['parentBlock'] = blocks[number(span['parentBlock'])]
        for value in seq(result.get('terms'), 50000):
            row = obj(value)
            for key in ('blockIds', 'detailBlocks'):
                if key in row:
                    row[key] = [blocks[number(v)] for v in seq(row[key], 100000)]
            if 'labelEvidence' in row:
                evidence = obj(row['labelEvidence'])
                evidence['block'] = blocks[number(evidence['block'])]
    except KeyError as error:
        raise ValueError('A journal local numeric reference is unresolved') from error
    return result


def bundle_articles(articles: list[dict[str, object]], stem: str) -> list[dict[str, object]]:
    if not articles or len(articles) > 96:
        raise ValueError('Expected 1..96 admitted source articles')
    results: list[dict[str, object]] = []
    ids: set[str] = set()

    def empty(index: int) -> dict[str, object]:
        return {'version': 3, 'id': f'{stem}.part.{index}', 'textKind': 'source-excerpt',
                'publicationState': 'local-dev', 'reviewStatus': 'requires-review',
                'sources': [], 'blocks': [], 'terms': []}

    current = empty(1)
    for payload in articles:
        require_active_definition_source(payload)
        source_rows = [obj(v) for v in seq(payload.get('sources'), 1000)]
        block_rows = [obj(v) for v in seq(payload.get('blocks'), 100000)]
        term_rows = [obj(v) for v in seq(payload.get('terms'), 50000)]
        if (not source_rows or not block_rows or not term_rows or
                any(row.get('sourceType') != 'specialist-journal' for row in source_rows)):
            raise ValueError('Only complete admitted specialist article projections can be bundled')
        local_sources = [number(row['id']) for row in source_rows]
        local_blocks = [number(row['id']) for row in block_rows]
        if len(set(local_sources)) != len(local_sources) or len(set(local_blocks)) != len(local_blocks):
            raise ValueError('Duplicate local journal identity')
        term_ids = [text(row['id']) for row in term_rows]
        if len(set(term_ids)) != len(term_ids) or ids.intersection(term_ids):
            raise ValueError('A source record was selected twice')
        for attempt in range(2):
            source_start = len(seq(current['sources'], 1000))
            block_start = len(seq(current['blocks'], 100000))
            smap = {value: source_start + i + 1 for i, value in enumerate(local_sources)}
            bmap = {value: block_start + i + 1 for i, value in enumerate(local_blocks)}
            remapped = remap_article(payload, smap, bmap)
            restored = remap_article(remapped, {v: k for k, v in smap.items()}, {v: k for k, v in bmap.items()})
            if restored != payload:
                raise ValueError('Numeric bundling changed source structure, wording or provenance')
            trial = {**current,
                     'sources': [*seq(current['sources'], 1000), *seq(remapped['sources'], 1000)],
                     'blocks': [*seq(current['blocks'], 100000), *seq(remapped['blocks'], 100000)],
                     'terms': [*seq(current['terms'], 50000), *seq(remapped['terms'], 50000)]}
            if len(encoded(trial).encode('utf-8')) <= MAX_BUNDLE_BYTES:
                current = trial
                break
            if not seq(current['terms'], 50000) or attempt == 1:
                raise ValueError('Single source article exceeds its bounded bundle budget')
            results.append(current)
            current = empty(len(results) + 1)
        ids.update(term_ids)
    results.append(current)
    for payload in results:
        projection = Projection()
        projection.add(payload, digest(encoded(payload)))
    return results


def load_selected(selected: Path) -> tuple[dict[str, object], list[dict[str, object]]]:
    report = obj(json.loads((selected / 'selection-report.json').read_bytes()))
    articles: list[dict[str, object]] = []
    for value in seq(report.get('articles'), 96):
        row = obj(value)
        if row.get('status') != 'selected-requires-clinical-review':
            continue
        path = (selected / text(row['prepared'])).resolve(strict=True)
        if path.parent != selected.resolve():
            raise ValueError('Selected article path escapes its directory')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != row.get('preparedSha256'):
            raise ValueError('Selected article no longer matches its receipt')
        articles.append(obj(json.loads(raw)))
    return report, articles


def activate_bundles(root: Path, selected: Path, stem: str) -> dict[str, object]:
    root = root.resolve()
    manifest_path = root / 'content/definition-drafts/source-inputs.json'
    previous = manifest_path.read_bytes()
    paths, before_count = read_source_manifest(root, manifest_path)
    previous_rows = seq(obj(json.loads(previous))['inputs'], 32)
    report, articles = load_selected(selected)
    payloads = bundle_articles(articles, stem)
    destination = selected / 'bundles'
    if destination.exists():
        raise ValueError('Bundled source output must be a new immutable directory')
    if len(paths) + len(payloads) > 32:
        raise ValueError('This batch exceeds the existing source manifest limit')
    old_ids: set[str] = set()
    old_names: set[str] = set()
    for path in paths:
        for value in seq(obj(json.loads(path.read_bytes()))['terms'], 50000):
            term = obj(value)
            old_ids.add(text(term['id']))
            old_names.add(normalized_name(text(term['title'])))
    new_ids: set[str] = set()
    new_names: set[str] = set()
    known_names: set[str] = set()
    for payload in payloads:
        for value in seq(payload['terms'], 50000):
            term = obj(value)
            identity = text(term['id'])
            if identity in old_ids or identity in new_ids:
                raise ValueError('Already active or repeated journal source identity')
            new_ids.add(identity)
            name = normalized_name(text(term['title']))
            (known_names if name in old_names else new_names).add(name)
    destination.mkdir()
    additions: list[Path] = []
    for index, payload in enumerate(payloads, 1):
        path = destination / f'articles-{index:02d}.json'
        path.write_text(encoded(payload), encoding='utf-8')
        additions.append(path)
    staged = selected / 'next-source-inputs.json'
    next_manifest = write_source_manifest(root, (*paths, *additions), staged)
    if number(next_manifest['entries']) != before_count + len(new_ids):
        raise ValueError('Bundled source record count differs from the final manifest')
    if manifest_path.read_bytes() != previous:
        raise ValueError('Source selection changed during this batch')
    manifest_path.write_bytes(staged.read_bytes())
    staged.unlink()
    report['refresh'] = {
        'previousRecords': before_count, 'addedRecords': len(new_ids),
        'combinedRecords': before_count + len(new_ids), 'newNormalizedNames': len(new_names),
        'existingNormalizedNamesWithNewSource': len(known_names),
        'previousInputs': previous_rows,
        'newInputs': [path.relative_to(root).as_posix() for path in additions],
        'previousManifestSha256': hashlib.sha256(previous).hexdigest(),
        'activeManifestSha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        'bundleStem': stem, 'bundleCount': len(payloads), 'numericRoundTripExact': True,
    }
    (selected / 'selection-report.json').write_text(encoded(report) + '\n', encoding='utf-8')
    return report


def verify_bundles(selected: Path) -> None:
    report, articles = load_selected(selected)
    refresh = obj(report['refresh'])
    expected = bundle_articles(articles, text(refresh['bundleStem']))
    paths = sorted((selected / 'bundles').glob('articles-*.json'))
    if len(expected) != len(paths):
        raise ValueError('Missing or unexpected specialist bundle file')
    for payload, path in zip(expected, paths, strict=True):
        if path.read_bytes() != encoded(payload).encode('utf-8'):
            raise ValueError('Runtime bundle differs from exact per-article source replay')
