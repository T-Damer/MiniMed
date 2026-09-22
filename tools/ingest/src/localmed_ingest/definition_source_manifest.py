"""Small source manifest for a growing DEV dictionary. No backward-compatibility formats."""

from __future__ import annotations

import json
from pathlib import Path

from .definition_reference_pack import MAX_INPUT_BYTES, contained, digest, encoded, number, obj, seq, text


def describe_input(root: Path, path: Path) -> dict[str, object]:
    actual = contained(root, path)
    allowed = (root / 'content/definition-drafts').resolve(strict=True)
    if not actual.is_relative_to(allowed) or actual.suffix != '.json':
        raise ValueError('Only declared repository definition sources are application inputs')
    raw = actual.read_bytes()
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError('Source manifest input is too large')
    payload = obj(json.loads(raw))
    if (payload.get('reviewStatus') != 'requires-review'
            or payload.get('publicationState') != 'local-dev'):
        raise ValueError('Source manifest cannot promote a draft edition')
    for value in seq(payload.get('sources'), 1000):
        source = obj(value)
        if source.get('sourceType') == 'owner-pdf':
            raise ValueError('Owner-source text is not a public repository input')
    entries = seq(payload.get('terms'), 50000)
    if not entries:
        raise ValueError('A definition source cannot be empty')
    return {
        'path': actual.relative_to(root.resolve()).as_posix(),
        'sha256': digest(raw.decode('utf-8')), 'bytes': len(raw), 'entries': len(entries),
    }


def write_source_manifest(root: Path, paths: tuple[Path, ...], output: Path) -> dict[str, object]:
    rows = [describe_input(root, path) for path in paths]
    if not 1 <= len(rows) <= 32 or len({row['path'] for row in rows}) != len(rows):
        raise ValueError('Expected 1..32 unique definition sources')
    manifest = {
        'version': 1, 'publicationState': 'local-dev', 'reviewStatus': 'requires-review',
        'entries': sum(number(row['entries']) for row in rows), 'inputs': rows,
    }
    output.write_text(encoded(manifest) + '\n', encoding='utf-8')
    return manifest


def read_source_manifest(root: Path, manifest_path: Path) -> tuple[tuple[Path, ...], int]:
    path = contained(root, manifest_path)
    if path.stat().st_size > 65536:
        raise ValueError('Source manifest exceeds its size budget')
    manifest = obj(json.loads(path.read_bytes()))
    if (manifest.get('version') != 1 or manifest.get('publicationState') != 'local-dev'
            or manifest.get('reviewStatus') != 'requires-review'):
        raise ValueError('Unsupported source manifest')
    rows = seq(manifest.get('inputs'), 32)
    if not rows:
        raise ValueError('Source manifest is empty')
    paths: list[Path] = []
    count = 0
    seen: set[Path] = set()
    for value in rows:
        row = obj(value)
        relative = Path(text(row.get('path')))
        if relative.is_absolute():
            raise ValueError('Source input must be repository-relative')
        actual = contained(root, relative)
        if actual in seen or describe_input(root, relative) != row:
            raise ValueError('Duplicate or mismatched definition source receipt')
        seen.add(actual)
        paths.append(actual)
        count += number(row.get('entries'))
    if count != number(manifest.get('entries')):
        raise ValueError('Definition source total disagrees with per-input counts')
    return tuple(paths), count
