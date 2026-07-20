#!/usr/bin/env bash
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git fetch origin agent/drug-knowledge-graph main
cp packages/search-lexical/src/analysis.ts /tmp/mobile-analysis.ts

git merge --no-commit --no-ff origin/agent/drug-knowledge-graph || true

# Keep the public clinical corpus and tests from the validated alpha.6 line.
git checkout HEAD -- \
  apps/app/public/content/core-demo.db \
  apps/app/public/content/core-demo-report.json \
  packages/storage-sqlite/tests/sqlite-medical-store.test.ts

git rm -f --ignore-unmatch \
  .github/foundation-staging-marker.txt \
  data/build/clinical-case-benchmark.json \
  data/build/core-demo-report.json \
  data/build/core-demo.db \
  data/build/search-benchmark.json

# Compose commands and parsing rather than taking stale whole-file versions.
git checkout HEAD -- package.json packages/search-lexical/src/analysis.ts
python3 - <<'PY'
import json
import subprocess
from pathlib import Path

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
scripts = package['scripts']
additions = {
    'content:collect:drugs': 'uv run --project tools/ingest medbase collect-drugs --catalog data/raw/drug-sources.yaml --input-root data/raw --output-root data/raw/collected-drugs --cache-root .cache/localmed/drugs --report data/build/drug-source-report.json',
    'content:ai:export': 'uv run --project tools/ingest medbase ai-export --input data/intermediate/private-pilot --output data/intermediate/chatgpt-tasks.jsonl',
    'content:ai:import': 'uv run --project tools/ingest medbase ai-import',
    'content:knowledge:approve': 'uv run --project tools/ingest medbase knowledge-approve',
    'content:knowledge:lint': 'uv run --project tools/ingest medbase knowledge-lint',
}
reordered = {}
for key, value in scripts.items():
    reordered[key] = value
    if key == 'content:sync:inputs':
        reordered.update(additions)
package['scripts'] = reordered
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

mobile = Path('/tmp/mobile-analysis.ts').read_text(encoding='utf-8')
source_path = Path('packages/search-lexical/src/analysis.ts')
source = subprocess.check_output(
    ['git', 'show', 'origin/agent/drug-knowledge-graph:packages/search-lexical/src/analysis.ts'],
    text=True,
)

reverse_pattern = r"    /(\d{1,3})\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)\s*,?\s*(?:мальчик|девочка|ребенок|ребёнок|пациент|пациентка|мужчина|женщина|младенец)/giu,"
if reverse_pattern not in source:
    lines = source.splitlines()
    insertion_index = next(
        index + 1
        for index, line in enumerate(lines)
        if 'младенец)' in line and '(\\d{1,3})' in line
    )
    lines.insert(insertion_index, reverse_pattern)
    source = '\n'.join(lines) + '\n'

if 'const SYMPTOM_PATTERNS' not in source:
    start = mobile.index('const SYMPTOM_PATTERNS')
    end = mobile.index('function extractKnownTerms', start)
    source = source.replace(
        'function extractKnownTerms',
        mobile[start:end] + 'function extractKnownTerms',
        1,
    )
if 'extractSymptoms(query, facts);' not in source:
    source = source.replace(
        '  extractNegations(query, aliases, facts);\n',
        '  extractNegations(query, aliases, facts);\n  extractSymptoms(query, facts);\n',
        1,
    )
source_path.write_text(source, encoding='utf-8')
PY

git add \
  package.json \
  packages/search-lexical/src/analysis.ts \
  apps/app/public/content/core-demo.db \
  apps/app/public/content/core-demo-report.json \
  packages/storage-sqlite/tests/sqlite-medical-store.test.ts

if git ls-files -u | grep -q 'packages/storage-sqlite/src/generated/schema.ts'; then
  git checkout --theirs packages/storage-sqlite/src/generated/schema.ts
  git add packages/storage-sqlite/src/generated/schema.ts
fi

unresolved="$(git diff --name-only --diff-filter=U)"
if [[ -n "$unresolved" ]]; then
  echo 'Unresolved merge files:' >&2
  printf '%s\n' "$unresolved" >&2
  exit 1
fi

pnpm install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
pnpm check --write
uv run --project tools/ingest ruff format tools/ingest/src tools/ingest/tests
uv run --project tools/ingest ruff check --fix tools/ingest/src tools/ingest/tests
pnpm verify

# `verify` compiles the synthetic test fixture into the app path; never commit it over the real pack.
git checkout HEAD -- \
  apps/app/public/content/core-demo.db \
  apps/app/public/content/core-demo-report.json

git add -A
git commit -m 'feat(drugs): integrate offline knowledge foundation with alpha 6'
git push origin HEAD:agent/drug-foundation-final
