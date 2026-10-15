// «МКБ-11» search section (owner decision 2026-10-15). Every case of tools/benchmarks/icd11-queries.json
// runs through ScopedMedicalCore('icd11') over the released core plus the optional МКБ-11 module, as
// the app does for a lookup (`mode: 'lexical'`, `analysisMode: 'lookup'`):
//
//   codes / words / icd10   the WHO rubric the query means is among the first `top` cards, and every
//                           card of the section is an ICD-11 card;
//   isolation               no other scope lists an ICD-11 card (the ICD-10 section and the clinical
//                           analysis stay free of it), while «Все источники» still does.
//
//   bun tools/benchmarks/src/run-icd11-queries.ts [--check] [--show]
//
// The module is a local release asset (`bun run content:module:icd11`, `data/build/icd11-module/release`
// in the main checkout, or `ICD11_DB=<decoded module database>`); without it the run is skipped and
// exits 0. The decoded copy (260 MB) is written to a temporary directory and removed afterwards.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { SearchResponse } from '@localmed/contracts';
import {
  icd11TitleCode,
  isIcd11DocumentId,
} from '../../../apps/app/src/features/icd11/icd11-document';
import {
  ScopedMedicalCore,
  type SearchScope,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const check = args.includes('--check');
const show = args.includes('--show');

interface Case {
  readonly id: string;
  readonly query: string;
  readonly expect: string;
  readonly top: number;
}
const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/icd11-queries.json'), 'utf8'),
) as {
  readonly codes: readonly Case[];
  readonly words: readonly Case[];
  readonly icd10: readonly Case[];
  readonly isolation: {
    readonly query: string;
    readonly scopesWithoutIcd11: readonly SearchScope[];
    readonly icd10Query: string;
  };
};

/** An agent worktree reads the ignored release copies from the main checkout. */
const dataRoot = REPOSITORY_ROOT.includes(`${sep}.claude${sep}worktrees${sep}`)
  ? resolve(REPOSITORY_ROOT, '../../..')
  : REPOSITORY_ROOT;
const releaseDirectory = resolve(dataRoot, 'data/build/icd11-module/release');
const packed = existsSync(releaseDirectory)
  ? readdirSync(releaseDirectory).find((name) => name.endsWith('.db.gz'))
  : undefined;
const provided = process.env['ICD11_DB'];
if (!provided && !packed) {
  console.log('skipped: no МКБ-11 module database (ICD11_DB, or data/build/icd11-module/release).');
  process.exit(0);
}

const scratch = mkdtempSync(resolve(tmpdir(), 'minimed-icd11-'));
let databasePath = provided ?? '';
if (!provided && packed) {
  databasePath = resolve(scratch, 'icd11.db');
  writeFileSync(databasePath, gunzipSync(readFileSync(resolve(releaseDirectory, packed))));
}

const rows: { id: string; kind: string; passed: boolean; detail: string }[] = [];
let core: Awaited<ReturnType<typeof openRealCorpus>>['core'] | undefined;
try {
  const corpus = await openRealCorpus({
    installedModules: [{ moduleId: 'minimed.reference.icd11.ru', path: databasePath }],
  });
  core = corpus.core;
  const search = async (query: string, scope: SearchScope): Promise<SearchResponse> => {
    const response = await new ScopedMedicalCore(corpus.core, scope).search({
      query,
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 20,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(`${query}: ${response.error.message}`);
    return response.value;
  };

  for (const [kind, cases] of [
    ['code', fixture.codes],
    ['word', fixture.words],
    ['icd10', fixture.icd10],
  ] as const) {
    for (const item of cases) {
      const response = await search(item.query, 'icd11');
      const titles = response.groups.map((group) => group.title);
      const rank = response.groups.findIndex(
        (group) => icd11TitleCode(group.title) === item.expect,
      );
      const strangers = response.groups.filter((group) => !isIcd11DocumentId(group.documentId));
      const failures: string[] = [];
      if (rank < 0 || rank >= item.top) {
        failures.push(
          `${item.expect} ${rank < 0 ? 'missing' : `at ${rank + 1}`} (needs top ${item.top}); first: ${titles[0] ?? 'none'}`,
        );
      }
      if (strangers.length > 0) failures.push(`${strangers.length} cards from other sources`);
      rows.push({
        id: item.id,
        kind,
        passed: failures.length === 0,
        detail: failures.length === 0 ? `${item.expect} at ${rank + 1}` : failures.join('; '),
      });
      if (show)
        console.log(
          `\n${item.query}\n${titles
            .slice(0, 5)
            .map((t) => `  ${t}`)
            .join('\n')}`,
        );
    }
  }

  for (const scope of fixture.isolation.scopesWithoutIcd11) {
    for (const query of [fixture.isolation.query, fixture.isolation.icd10Query]) {
      const response = await search(query, scope);
      const icd11 = response.groups.filter((group) => isIcd11DocumentId(group.documentId));
      rows.push({
        id: `isolation-${scope}-${query}`,
        kind: 'isolation',
        passed: icd11.length === 0,
        detail:
          icd11.length === 0
            ? `${response.groups.length} groups, no ICD-11`
            : `${icd11.length} ICD-11 cards`,
      });
    }
  }
  const everywhere = await search(fixture.isolation.query, 'all');
  const listed = everywhere.groups.filter((group) => isIcd11DocumentId(group.documentId)).length;
  rows.push({
    id: 'isolation-all-lists-icd11',
    kind: 'isolation',
    passed: listed > 0,
    detail: `${listed} ICD-11 cards in «Все источники»`,
  });

  for (const row of rows) {
    console.log(
      `${row.passed ? 'ok  ' : 'FAIL'} ${row.kind.padEnd(9)} ${row.id.padEnd(36)} ${row.detail}`,
    );
  }
  const kinds = ['code', 'word', 'icd10', 'isolation'] as const;
  console.log(
    `\nsummary ${JSON.stringify(
      Object.fromEntries(
        kinds.map((kind) => {
          const own = rows.filter((row) => row.kind === kind);
          return [kind, `${own.filter((row) => row.passed).length}/${own.length}`];
        }),
      ),
    )}; documents ${corpus.documents.size}`,
  );
} finally {
  await core?.close();
  rmSync(scratch, { recursive: true, force: true });
}
if (check && rows.some((row) => !row.passed)) process.exit(1);
