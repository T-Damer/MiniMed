#!/usr/bin/env bash
set -euo pipefail

source_branch='agent/mobile-ux-0.3.0-alpha.6'
target_branch='agent/mobile-ux-alpha6-clean-staging'

git fetch origin "$source_branch" main

git checkout "origin/$source_branch" -- \
  .github/dependabot.yml \
  apps/app/android/app/build.gradle \
  apps/app/android/app/src/main/AndroidManifest.xml \
  apps/app/android/app/src/main/java/dev/localmed/search/MainActivity.java \
  apps/app/android/app/src/main/res/drawable/minimed_launcher.xml \
  apps/app/android/app/src/main/res/values/styles.xml \
  apps/app/index.html \
  apps/app/package.json \
  apps/app/public/favicon.svg \
  apps/app/src/app/App.tsx \
  apps/app/src/components/AppGlyph.tsx \
  apps/app/src/components/BrandMark.tsx \
  apps/app/src/features/history/SearchHistoryView.tsx \
  apps/app/src/features/library/DocumentLibrary.tsx \
  apps/app/src/features/library/KnowledgeGraph.tsx \
  apps/app/src/features/search/SearchWorkspace.tsx \
  apps/app/src/main.tsx \
  apps/app/src/state/search-history.ts \
  apps/app/src/styles/mobile-shell.css \
  apps/landing/package.json \
  apps/landing/public/favicon.svg \
  apps/landing/src/pages/index.astro \
  package.json \
  packages/search-lexical/src/analysis.ts \
  packages/search-lexical/tests/query.test.ts \
  pnpm-lock.yaml

python3 - <<'PY'
from pathlib import Path
from textwrap import dedent

Path('.github/dependabot.yml').write_text(
    dedent(
        '''\
        version: 2
        updates:
          - package-ecosystem: npm
            directory: /
            schedule:
              interval: weekly
            groups:
              javascript-minor-and-patch:
                update-types:
                  - minor
                  - patch
            ignore:
              - dependency-name: typescript
                update-types:
                  - version-update:semver-major
          - package-ecosystem: github-actions
            directory: /
            schedule:
              interval: weekly
            groups:
              github-actions:
                patterns:
                  - "*"
          - package-ecosystem: pip
            directory: /tools/ingest
            schedule:
              interval: weekly
        '''
    ),
    encoding='utf-8',
)

strings = Path('apps/app/android/app/src/main/res/values/strings.xml')
strings.write_text(
    strings.read_text(encoding='utf-8').replace('LocalMed Search', 'MiniMed'),
    encoding='utf-8',
)

graph = Path('apps/app/src/features/library/KnowledgeGraph.tsx')
graph.write_text(
    graph.read_text(encoding='utf-8').replace(
        '  readonly selectedId?: string;\n',
        '  readonly selectedId?: string | undefined;\n',
    ),
    encoding='utf-8',
)

analysis = Path('packages/search-lexical/src/analysis.ts')
analysis_text = analysis.read_text(encoding='utf-8')
old = r"    /(\d{1,3})\s*(дн(?:я|ей)?|день|дней|недел(?:я|и|ь|ю)?|месяц(?:а|ев)?|лет|год(?:а|ов)?)\s*,?\s*(?:мальчик|девочка|ребенок|ребёнок|пациент|пациентка|мужчина|женщина|младенец)/giu,"
new = r"    /(\d{1,3})\s*(месяц(?:а|ев)?|лет|год(?:а|ов)?)\s*,?\s*(?:мальчик|девочка|ребенок|ребёнок|пациент|пациентка|мужчина|женщина|младенец)/giu,"
if old not in analysis_text:
    raise SystemExit('reverse age pattern not found')
analysis.write_text(analysis_text.replace(old, new, 1), encoding='utf-8')

tests = Path('packages/search-lexical/tests/query.test.ts')
test_text = tests.read_text(encoding='utf-8')
title = 'does not confuse illness duration before sex with patient age'
if title not in test_text:
    addition = '''
  it('does not confuse illness duration before sex with patient age', () => {
    const plan = analyzeClinicalQuery('5 дней, мальчик, кашляет', aliases);
    expect(plan.analysis.facts.some((fact) => fact.kind === 'age')).toBe(false);
    expect(plan.analysis.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'duration' }),
        expect.objectContaining({ kind: 'sex', normalizedValue: 'мужской' }),
        expect.objectContaining({ kind: 'symptom', normalizedValue: 'кашель' }),
      ]),
    );
  });
'''
    marker = '\n});\n'
    index = test_text.rfind(marker)
    if index < 0:
        raise SystemExit('test suite closing marker not found')
    tests.write_text(test_text[:index] + addition + test_text[index:], encoding='utf-8')
PY

pnpm install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
pnpm check --write
pnpm verify

git diff --quiet -- .github/workflows || {
  echo 'The alpha.6 product pass unexpectedly modified a workflow file.' >&2
  git diff -- .github/workflows
  exit 1
}

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A
git diff --cached --quiet && exit 0
git commit -m 'feat(app): stage verified MiniMed 0.3.0-alpha.6 product tree'
git push origin "HEAD:$target_branch"
