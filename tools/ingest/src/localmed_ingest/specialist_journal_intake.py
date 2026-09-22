"""Reproject original journal fragments to a new reviewed-for-structure draft selection."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import tempfile
from collections import Counter
from pathlib import Path

from .definition_reference_pack import Projection, encoded, normalized_name, obj, seq, text
from .specialist_journal_reference import MAX_PAGE_BYTES, project_article


def compose(collection: Path, output: Path) -> dict[str, object]:
    if output.exists():
        raise ValueError('Use a new immutable journal projection path')
    original_report = collection / 'collection-report.json'
    collected = obj(json.loads(original_report.read_bytes()))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='journal-intake-', dir=output.parent) as temporary:
        staged = Path(temporary) / 'prepared'
        staged.mkdir()
        counts: Counter[str] = Counter()
        outcomes: list[dict[str, object]] = []
        for value in seq(collected.get('articles'), 24):
            row = obj(value)
            if row.get('status') != 'prepared-requires-review':
                outcomes.append({'url': row.get('url'), 'status': row.get('status'), 'reason': row.get('reason')})
                continue
            evidence = (collection / text(row.get('evidence'))).resolve(strict=True)
            if not evidence.is_relative_to(collection.resolve()):
                raise ValueError('Source archive escaped the explicit collection')
            if hashlib.sha256(evidence.read_bytes()).hexdigest() != row.get('evidenceSha256'):
                raise ValueError('Original source archive checksum changed')
            with gzip.open(evidence, 'rb') as handle:
                raw = handle.read(MAX_PAGE_BYTES + 1)
            if len(raw) > MAX_PAGE_BYTES:
                raise ValueError('Source archive expansion exceeds budget')
            payload = project_article(json.loads(raw))
            encoded_payload = encoded(payload).encode()
            projection = Projection()
            projection.add(payload, hashlib.sha256(encoded_payload).hexdigest())
            stem = text(row.get('journal')).lower() + '-' + text(row.get('articleId'))
            filename = stem + '.json'
            (staged / filename).write_bytes(encoded_payload)
            terms = [obj(item) for item in seq(payload['terms'], 5000)]
            blocks = [obj(item) for item in seq(payload['blocks'], 5000)]
            source = obj(seq(payload['sources'], 100)[0])
            before = [text(item) for item in seq(row.get('proposedTitles'), 5000)]
            names = {text(term['title']) for term in terms}
            counts.update({
                'articles': 1, 'records': len(terms), 'articleOverviews': 1,
                'definitionCandidates': sum(t['coverage'] == 'explicit-definition' for t in terms),
                'sectionCards': sum(t['coverage'] == 'section-excerpt' for t in terms),
                'criterionLists': sum(t['coverage'] == 'criterion-list' for t in terms),
                'blocks': len(blocks), 'tables': sum(len(seq(b['tables'], 1000)) for b in blocks),
            })
            outcomes.append({
                'status': 'selected-requires-clinical-review', 'articleId': row['articleId'],
                'journal': source['journal'], 'title': source['title'], 'doi': source['doi'],
                'publicationDate': source['publicationDate'], 'articleType': source['articleType'],
                'license': source['license'], 'nonCommercialOnly': source['nonCommercialOnly'],
                'evidence': row['evidence'], 'evidenceSha256': row['evidenceSha256'],
                'prepared': filename, 'preparedSha256': hashlib.sha256(encoded_payload).hexdigest(),
                'records': len(terms), 'names': sorted(names),
                'distinctNormalizedNames': len({normalized_name(name) for name in names}),
                'previousCandidateNamesNotSelected': [name for name in before if name not in names],
                'blocks': len(blocks), 'extraction': payload['extraction'],
            })
        if not counts['articles']:
            raise ValueError('No article remained in the source selection')
        result = {
            'version': 1, 'counts': dict(counts), 'articles': outcomes,
            'acquisitionReportSha256': hashlib.sha256(original_report.read_bytes()).hexdigest(),
            'rawEvidenceUnchanged': True, 'networkRequests': 0,
            'boundary': (
                'Structure/source-fidelity intake, not clinical review. '
                'Article overviews and section cards are counted separately from definition clauses. '
                'Old source classification and terminology are retained, not harmonized.'
            ),
        }
        (staged / 'intake-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.rename(staged, output)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(encoded(compose(args.collection, args.output)))


if __name__ == '__main__':
    main()
