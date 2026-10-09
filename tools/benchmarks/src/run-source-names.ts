// Search by source name and the drug overview line (QA R5 and S6, 2026-10-09). Every case of
// tools/benchmarks/source-name-queries.json runs through ScopedMedicalCore over the released corpus,
// as the app does for a lookup (`mode: 'lexical'`, `analysisMode: 'lookup'`):
//
//   sources    the query names a source: the source and the words left over are read as expected,
//              every result belongs to the source, and the expected document is among the first
//              results; the same query with `sourceNames: false` is run as the baseline.
//   negatives  the query is an ordinary text search: no source is read.
//   overview   a bare drug name opens with an overview line, not with the identity line.
//
//   bun tools/benchmarks/src/run-source-names.ts [--check] [--show]
//
// `--check` exits with 1 when a case fails (the labels are hand-made and deterministic: any miss is
// a regression). Cases whose `needs` packs are not mounted are skipped and counted.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SearchResponse, SearchResultGroup } from '@localmed/contracts';
import { normalizeSurfaceText } from '@localmed/search-lexical';

import {
  ScopedMedicalCore,
  type SearchScope,
  SOURCE_COLLECTIONS,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { sourceCatalogOf } from '../../../apps/app/src/features/search/source-names';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const check = args.includes('--check');
const show = args.includes('--show');

interface Need {
  readonly needs?: readonly string[];
}
interface SourceCase extends Need {
  readonly id: string;
  readonly query: string;
  readonly source: string;
  readonly remainder: string;
  readonly minDocuments?: number;
  readonly expectTitleInTop?: { title: string; top: number; prefix?: boolean };
  readonly expectIdInTop?: { id: string; top: number };
  readonly expectTargetInTop?: { target: string; top: number };
  readonly expectNonEmpty?: boolean;
}
interface NegativeCase extends Need {
  readonly id: string;
  readonly query: string;
}
interface OverviewCase extends Need {
  readonly id: string;
  readonly query: string;
  readonly scope: SearchScope;
  readonly firstGroupTitle?: string;
  readonly keepsFirstSnippet?: boolean;
}
const fixture = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/source-name-queries.json'), 'utf8'),
) as {
  readonly sources: readonly SourceCase[];
  readonly negatives: readonly NegativeCase[];
  readonly overview: readonly OverviewCase[];
};

const { core, corpus, target, documents } = await openRealCorpus({ companions: true });
const mounted = new Set(corpus);
const skipped: string[] = [];
const runnable = <T extends Need & { readonly id: string }>(cases: readonly T[]): readonly T[] =>
  cases.filter((item) => {
    const missing = (item.needs ?? []).filter((pack) => !mounted.has(pack));
    if (missing.length > 0) skipped.push(`${item.id} (needs ${missing.join(', ')})`);
    return missing.length === 0;
  });

const search = async (
  query: string,
  scope: SearchScope,
  sourceNames: boolean,
): Promise<SearchResponse> => {
  const response = await new ScopedMedicalCore(core, scope).search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
    ...(sourceNames ? {} : { sourceNames: false }),
  });
  if (!response.ok) throw new Error(`${query}: ${response.error.message}`);
  return response.value;
};

const descriptors = await core.listSearchDocuments?.();
if (!descriptors?.ok) throw new Error('The corpus lists no search documents.');
const catalog = sourceCatalogOf(descriptors.value, SOURCE_COLLECTIONS);
const sourceDocumentIds = (id: string): ReadonlySet<string> =>
  new Set(
    catalog.sources
      .filter((source) => id.split('+').includes(source.id))
      .flatMap((source) => source.documentIds),
  );

const normalized = (value: string): string => normalizeSurfaceText(value);
function titleInTop(
  groups: readonly SearchResultGroup[],
  expected: { title: string; top: number; prefix?: boolean },
): boolean {
  return groups.slice(0, expected.top).some((group) => {
    const title = normalized(group.title.replace(/^Для [^·]+· /u, ''));
    const wanted = normalized(expected.title);
    return expected.prefix ? title.startsWith(wanted) : title === wanted;
  });
}
function idInTop(groups: readonly SearchResultGroup[], id: string, top: number): boolean {
  return groups.slice(0, top).some((group) => group.documentId === id);
}
function targetInTop(groups: readonly SearchResultGroup[], wanted: string, top: number): boolean {
  return groups.slice(0, top).some((group) => target(group.documentId) === wanted);
}

interface Row {
  readonly id: string;
  readonly kind: string;
  readonly passed: boolean;
  readonly detail: string;
  /** Sources only: did the expected document show among the first results, without the intent? */
  readonly baselineHit?: boolean;
  readonly hit?: boolean;
  /** Sources only: how many of the first five results of the plain-words search belong to the source. */
  readonly plainFromSource?: number;
}
const rows: Row[] = [];

for (const item of runnable(fixture.sources)) {
  const response = await search(item.query, 'all', true);
  const scope = response.sourceScope;
  const failures: string[] = [];
  if (!scope) failures.push('no source read');
  else {
    if (normalized(scope.label) !== normalized(item.source))
      failures.push(`source «${scope.label}»`);
    if (normalized(scope.remainder) !== normalized(item.remainder)) {
      failures.push(`remainder «${scope.remainder}»`);
    }
    if (item.minDocuments && scope.documentCount < item.minDocuments) {
      failures.push(`only ${scope.documentCount} documents`);
    }
    const inSource = sourceDocumentIds(scope.id);
    const strangers = response.groups.filter((group) => !inSource.has(group.documentId));
    if (strangers.length > 0) failures.push(`${strangers.length} results from other sources`);
    if (item.remainder === '' && response.groups.length > 0)
      failures.push('a bare name found text');
  }
  const wantsHit = Boolean(
    item.expectTitleInTop || item.expectIdInTop || item.expectTargetInTop || item.expectNonEmpty,
  );
  const found = (groups: readonly SearchResultGroup[]): boolean =>
    (item.expectTitleInTop ? titleInTop(groups, item.expectTitleInTop) : true) &&
    (item.expectIdInTop ? idInTop(groups, item.expectIdInTop.id, item.expectIdInTop.top) : true) &&
    (item.expectTargetInTop
      ? targetInTop(groups, item.expectTargetInTop.target, item.expectTargetInTop.top)
      : true) &&
    (item.expectNonEmpty ? groups.length > 0 : true);
  const hit = found(response.groups);
  if (wantsHit && !hit) failures.push('expected document missing from the first results');
  const plain = await search(item.query, 'all', false);
  const plainFromSource = scope
    ? plain.groups.slice(0, 5).filter((group) => sourceDocumentIds(scope.id).has(group.documentId))
        .length
    : 0;
  rows.push({
    id: item.id,
    kind: 'source',
    passed: failures.length === 0,
    detail:
      (failures.length === 0 ? `${scope?.label} · ${scope?.documentCount}` : failures.join('; ')) +
      ` · as plain words: ${wantsHit ? (found(plain.groups) ? 'found, ' : 'missed, ') : ''}${plainFromSource}/5 from the source`,
    ...(wantsHit ? { hit, baselineHit: found(plain.groups) } : {}),
    plainFromSource,
  });
  if (show) {
    console.log(
      `\n${item.query}\n${response.groups
        .slice(0, 5)
        .map((group) => `  ${group.title}`)
        .join('\n')}`,
    );
  }
}

for (const item of runnable(fixture.negatives)) {
  const response = await search(item.query, 'all', true);
  const read = response.sourceScope;
  rows.push({
    id: item.id,
    kind: 'negative',
    passed: !read,
    detail: read ? `read as source «${read.label}»` : `plain, ${response.groups.length} groups`,
  });
}

for (const item of runnable(fixture.overview)) {
  const response = await search(item.query, item.scope, true);
  const first = response.groups[0];
  const lead = first?.results[0];
  const failures: string[] = [];
  if (!first || !lead) failures.push('no result');
  else if (item.keepsFirstSnippet) {
    // A dose form in the query asks for its own passage: the overview must not push it down.
    if (!/суспенз/iu.test(`${lead.snippet} ${lead.sectionPath.join(' ')}`)) {
      failures.push(`leads with «${lead.sectionPath.join(' > ')}»`);
    }
  } else {
    if (
      item.firstGroupTitle &&
      !normalized(first.title).includes(normalized(item.firstGroupTitle))
    ) {
      failures.push(`first card «${first.title}»`);
    }
    if (/Стандартизированное МНН/u.test(lead.snippet)) failures.push('leads with the МНН line');
    const section = lead.sectionPath.at(-1) ?? '';
    if (!/^(?:Фармако|Показания)/iu.test(section)) failures.push(`leads with «${section}»`);
  }
  rows.push({
    id: item.id,
    kind: 'overview',
    passed: failures.length === 0,
    detail:
      failures.length === 0
        ? `${first?.title} · ${lead?.sectionPath.at(-1)}: ${lead?.snippet.slice(0, 60).replace(/\s+/gu, ' ')}`
        : failures.join('; '),
  });
}

for (const row of rows) {
  console.log(
    `${row.passed ? 'ok  ' : 'FAIL'} ${row.kind.padEnd(8)} ${row.id.padEnd(30)} ${row.detail}`,
  );
}
const kinds = ['source', 'negative', 'overview'] as const;
const summary = Object.fromEntries(
  kinds.map((kind) => {
    const own = rows.filter((row) => row.kind === kind);
    return [kind, `${own.filter((row) => row.passed).length}/${own.length}`];
  }),
);
const withHits = rows.filter((row) => row.hit !== undefined);
console.log(
  `\nsummary ${JSON.stringify(summary)}; expected document in the first results: ${withHits.filter((row) => row.hit).length}/${withHits.length} with the source name read, ${withHits.filter((row) => row.baselineHit).length}/${withHits.length} as plain words`,
);
const sourceRows = rows.filter((row) => row.plainFromSource !== undefined);
console.log(
  `first five results from the named source: ${sourceRows.length} queries, as plain words ${(sourceRows.reduce((sum, row) => sum + (row.plainFromSource ?? 0), 0) / (5 * Math.max(1, sourceRows.length))).toFixed(2)}, with the source name read 1.00 (the filter)`,
);
if (skipped.length > 0) console.log(`skipped: ${skipped.join('; ')}`);
console.log(`corpus: ${corpus.join(', ')}; documents ${documents.size}`);
await core.close();
if (check && rows.some((row) => !row.passed)) process.exit(1);
