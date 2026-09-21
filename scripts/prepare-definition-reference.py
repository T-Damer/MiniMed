"""Prepare the public draft reference for local DEV installation; never publish it.

Run with the locked ingest environment. The owner PDF and owner-derived overlays
are intentionally not accepted as inputs by this application integration helper.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path

from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference


def sha256(path: Path) -> str:
    with path.open('rb') as stream:
        return 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--built-at', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', args.version):
        parser.error('Use an immutable lowercase alphanumeric version, separated by dots or hyphens.')
    root = Path(__file__).resolve().parent.parent
    source = root / 'content/definition-drafts'
    clinical = json.loads((source / 'clinical-source-excerpts-2026.09.21.json').read_text())
    inputs = [source / name for name in ('catalog.json', 'ruwiktionary-2026.9.16.json', 'prepared-source-excerpts-2026.09.21.json')]
    for part in clinical['parts']:
        path = source / part['path']
        if path.resolve().parent != source.resolve() or path.stat().st_size != part['bytes'] or sha256(path) != 'sha256:' + part['sha256']:
            raise ValueError('Clinical source shard receipt mismatch.')
        inputs.append(path)
    destination = root / 'apps/app/public/content/definition-reference'
    file_name = f'minimed.definition.reference.{args.version}.db'
    database = destination / file_name
    archive = destination / (file_name + '.gz')
    report_path = destination / (file_name + '.report.json')
    if database.exists() or archive.exists() or report_path.exists():
        raise ValueError('Use a new version; existing source editions are immutable.')
    edition = 'minimed.definition.reference.' + args.version
    report = build_compact_definition_reference(
        tuple(inputs), database, input_root=root, edition_id=edition,
        version=args.version, built_at=args.built_at, compact_metadata=False,
    )
    if report['schemaVersion'] != 7 or report['entries'] != 18133 or report['logicalRoundTripEqual'] is not True:
        raise ValueError('Unexpected reference corpus or representation.')
    with database.open('rb') as source_bytes, archive.open('xb') as out:
        with gzip.GzipFile(filename='', mode='wb', fileobj=out, mtime=0) as compressed:
            while block := source_bytes.read(1024 * 1024):
                compressed.write(block)
    # Verify actual transport decoding, not only a metadata checksum.
    with gzip.open(archive, 'rb') as decoded:
        decoded_hash = 'sha256:' + hashlib.file_digest(decoded, 'sha256').hexdigest()
    checksum = sha256(database)
    if decoded_hash != checksum:
        raise ValueError('Reference transport round-trip failed.')
    receipts = json.dumps(report['receipts'], sort_keys=True, separators=(',', ':')).encode()
    source_set = 'sha256:' + hashlib.sha256(receipts).hexdigest()
    module = {
        'id': 'minimed.definition.reference.ru', 'version': args.version,
        'kind': 'reference', 'collection': 'definition-reference',
        'title': 'Словарь терминов, симптомов и синдромов',
        'description': '18 133 исходные записи: русские определения, фрагменты и контекст с точными ссылками. Предварительная редакция, требующая проверки.',
        'required': False, 'releaseState': 'preview', 'specialties': [],
        'populations': [], 'tags': ['definitions', 'requires-review'],
        'compatibility': {'minAppVersion': '0.6.39', 'maxAppVersion': None, 'schemaVersion': 7, 'coreCatalogVersion': '1'},
        'sourceSetDigest': source_set, 'dependencies': [],
        'sizes': {'downloadBytes': archive.stat().st_size, 'installedBytes': database.stat().st_size, 'sourceAssetsDownloadBytes': None, 'precision': 'exact'},
        'capabilities': {'search': True, 'fullText': True, 'structuredTables': False, 'images': False, 'originalPdf': False, 'structuredKnowledge': False, 'calculations': False},
        'artifacts': [{'id': 'reference-index', 'kind': 'index', 'required': True, 'url': None, 'sha256': sha256(archive), 'sizeBytes': archive.stat().st_size, 'compression': 'gzip', 'decodedSha256': checksum, 'decodedSizeBytes': database.stat().st_size, 'sourceSetDigest': source_set}],
        'documents': [], 'previewDocumentCount': report['sources'],
        'definitionReference': {'contract': 1, 'editionId': edition, 'entries': report['entries']},
    }
    descriptor = root / 'apps/app/src/features/modules/catalog.definition-reference.local.json'
    descriptor.write_text(json.dumps({'module': module, 'fileName': archive.name}, ensure_ascii=False, indent=2) + '\n')
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'entries': report['entries'], 'installedBytes': database.stat().st_size, 'downloadBytes': archive.stat().st_size, 'sqliteSha256': checksum, 'publicationState': 'local-dev'}, indent=2))


if __name__ == '__main__':
    main()
