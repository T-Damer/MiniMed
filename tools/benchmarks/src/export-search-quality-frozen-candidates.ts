import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import type { SearchDocumentDescriptor, SearchResultGroup } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import {
  findNormalizedPhraseIndex,
  normalizeSurfaceText,
  searchSubjectText,
} from '@localmed/search-lexical';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import {
  loadSearchQualityFixtures,
  type SearchQualityFixture,
} from './search-quality-dataset';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);

for (const arg of args) {
  if (!/^--(?:core|pack|fixtures|legacy-pilot|leakage-fixtures|output|report|mode|limit)=.+/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}

const projectPath = (value: string | undefined, fallback: string): string =>
  resolve(root, value ?? fallback);
const corePath = projectPath(option('core'), 'data/build/rf-public-pilot.db');
const packs = args
  .filter((arg) => arg.startsWith('--pack='))
  .map((arg) => projectPath(arg.slice(7), ''));
const fixturePath = projectPath(option('fixtures'), 'tools/benchmarks/search-quality-v2.json');
const legacyPilotPath = option('legacy-pilot')
  ? projectPath(option('legacy-pilot'), 'tools/benchmarks/pilot-rf-queries.json')
  : undefined;
const leakageFixturePath = projectPath(
  option('leakage-fixtures'),
  'tools/benchmarks/search-quality-v2.json',
);
const trainingExport = legacyPilotPath !== undefined;
const outputPath = projectPath(
  option('output'),
  trainingExport
    ? 'data/build/search-quality-linear-training-candidates.jsonl'
    : 'data/build/search-quality-v2-frozen-candidates.jsonl',
);
const reportPath = projectPath(
  option('report'),
  trainingExport
    ? 'data/build/search-quality-linear-training-candidates-report.json'
    : 'data/build/search-quality-v2-frozen-candidates-report.json',
);
const mode = option('mode') ?? 'hybrid';
if (mode !== 'lexical' && mode !== 'hybrid') {
  throw new Error('--mode must be lexical or hybrid.');
}
const limit = Number(option('limit') ?? '40');
if (!Number.isInteger(limit) || limit < 20 || limit > 100) {
  throw new Error('--limit must be an integer between 20 and 100.');
}

const inputPaths = [
  corePath,
  ...packs,
  trainingExport ? (legacyPilotPath as string) : fixturePath,
  ...(trainingExport ? [leakageFixturePath] : []),
];
for (const path of inputPaths) {
  if (!existsSync(path)) throw new Error(`Frozen-candidate input does not exist: ${path}`);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
interface LegacyPilotFixture {
  readonly id: string;
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly expectedSectionTypes: readonly string[];
  readonly category: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function maskLeakageTerms(query: string, terms: readonly string[]): string {
  let masked = query;
  for (const term of [...new Set(terms)].toSorted((left, right) => right.length - left.length)) {
    const expression = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?=$|[^\\p{L}\\p{N}])`,
      'giu',
    );
    masked = masked.replace(expression, '$1[диагноз]');
  }
  return masked
    .replace(/(?:\[диагноз\]\s*){2,}/gu, '[диагноз] ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function inferredGoal(sectionTypes: readonly string[]): SearchQualityFixture['goal'] {
  if (sectionTypes.includes('routing')) return 'routing';
  if (sectionTypes.includes('treatment')) return 'treatment';
  if (sectionTypes.includes('diagnostics')) return 'diagnostics';
  return 'diagnosis-navigation';
}

function loadLegacyTrainingFixtures(
  path: string,
  leakagePath: string,
): readonly SearchQualityFixture[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Legacy pilot fixture must be an array.');
  const leakageFixtures = loadSearchQualityFixtures(leakagePath);
  const leakageByDocument = new Map<string, Set<string>>();
  for (const fixture of leakageFixtures) {
    for (const target of fixture.relevance) {
      let terms = leakageByDocument.get(target.documentId);
      if (!terms) {
        terms = new Set<string>();
        leakageByDocument.set(target.documentId, terms);
      }
      for (const term of fixture.leakageTerms) terms.add(term);
    }
  }

  return raw.map((value, index): SearchQualityFixture => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Legacy pilot fixture ${index} must be an object.`);
    }
    const row = value as Record<string, unknown>;
    const id = String(row.id ?? '').trim();
    const query = String(row.query ?? '').trim();
    const expectedDocumentIds = Array.isArray(row.expectedDocumentIds)
      ? row.expectedDocumentIds.filter((item): item is string => typeof item === 'string')
      : [];
    const expectedSectionTypes = Array.isArray(row.expectedSectionTypes)
      ? row.expectedSectionTypes.filter((item): item is string => typeof item === 'string')
      : [];
    const category = String(row.category ?? 'legacy').trim() || 'legacy';
    if (!id || !query || expectedDocumentIds.length === 0 || expectedSectionTypes.length === 0) {
      throw new Error(`Legacy pilot fixture ${index} is incomplete.`);
    }

    const leakageTerms = [
      ...new Set(
        expectedDocumentIds.flatMap((documentId) => [
          ...(leakageByDocument.get(documentId) ?? []),
        ]),
      ),
    ];
    const maskedQuery = maskLeakageTerms(query, leakageTerms);
    if (!maskedQuery) throw new Error(`${id}: masking removed the entire training query.`);
    const normalizedMasked = normalizeSurfaceText(maskedQuery);
    const leaked = leakageTerms.find(
      (term) => findNormalizedPhraseIndex(normalizedMasked, normalizeSurfaceText(term)) >= 0,
    );
    if (leaked) throw new Error(`${id}: masked training query still leaks "${leaked}".`);

    return {
      id: `legacy-train.${id}`,
      query: maskedQuery,
      origin: 'legacy-pilot-training',
      family: category,
      goal: inferredGoal(expectedSectionTypes),
      answerability: 'focused',
      relevance: expectedDocumentIds.map((documentId) => ({
        documentId,
        grade: 3,
        sectionTypes: expectedSectionTypes,
      })),
      leakageTerms,
      forbiddenDocumentIds: [],
      rationale:
        'Legacy source-grounded query used only for reranker training after direct answer-term masking.',
    };
  });
}

function metadataStrings(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function maximumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
}

function compactEvidence(group: SearchResultGroup): string {
  const best = group.results.toSorted((left, right) => right.finalScore - left.finalScore)[0];
  if (!best) return '';
  return best.snippet.replace(/\s+/gu, ' ').trim().slice(0, 700);
}

function relevantTarget(fixture: SearchQualityFixture, documentId: string) {
  return fixture.relevance.find((target) => target.documentId === documentId);
}

function surfaceFlags(
  query: string,
  document: SearchDocumentDescriptor | undefined,
): {
  readonly exactTitle: boolean;
  readonly exactNavigationAlias: boolean;
  readonly exactDeclaredAlias: boolean;
} {
  const subject = normalizeSurfaceText(searchSubjectText(query)).trim();
  if (!subject || !document) {
    return {
      exactTitle: false,
      exactNavigationAlias: false,
      exactDeclaredAlias: false,
    };
  }
  const matches = (values: readonly string[]): boolean =>
    values.some((value) => normalizeSurfaceText(value).trim() === subject);
  return {
    exactTitle: normalizeSurfaceText(document.title).trim() === subject,
    exactNavigationAlias: matches(metadataStrings(document.metadata, 'navigationAliases')),
    exactDeclaredAlias: matches(metadataStrings(document.metadata, 'declaredAliases')),
  };
}

const fixtures = trainingExport
  ? loadLegacyTrainingFixtures(legacyPilotPath as string, leakageFixturePath)
  : loadSearchQualityFixtures(fixturePath);
const stores = await Promise.all(
  [corePath, ...packs].map(async (path, index) => ({
    moduleId: `${index}:${basename(path)}`,
    store: await SqliteMedicalStore.createFromBytes(new Uint8Array(readFileSync(path))),
    required: true,
    searchWeight: index === 0 ? 1.1 : 1,
  })),
);
const store =
  stores.length === 1 && stores[0]
    ? stores[0].store
    : new MultiMedicalStore(stores);
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const searchDocuments = await store.listSearchDocuments?.();
const documents =
  searchDocuments ??
  (await store.listDocuments()).map(({ id, title, shortTitle, sourceType, metadata }) => ({
    id,
    title,
    shortTitle,
    sourceType,
    metadata,
  }));
const documentsById = new Map(documents.map((document) => [document.id, document]));

const lines: string[] = [];
const fixtureReports: {
  id: string;
  candidateCount: number;
  relevantCandidateCount: number;
  relevantDocumentCount: number;
  missingRelevantDocumentIds: string[];
  modeUsed: string;
  elapsedMs: number;
}[] = [];

for (const fixture of fixtures) {
  const availableRelevance = fixture.relevance.filter((target) => documentsById.has(target.documentId));
  if (availableRelevance.length === 0) {
    fixtureReports.push({
      id: fixture.id,
      candidateCount: 0,
      relevantCandidateCount: 0,
      relevantDocumentCount: 0,
      missingRelevantDocumentIds: fixture.relevance.map((target) => target.documentId),
      modeUsed: 'unavailable',
      elapsedMs: 0,
    });
    continue;
  }

  const response = await core.search({
    query: fixture.query,
    mode,
    analysisMode: 'clinical',
    filters: {},
    limit,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);

  const candidateIds = new Set(response.value.groups.map((group) => group.documentId));
  const relevantCandidateCount = availableRelevance.filter((target) =>
    candidateIds.has(target.documentId),
  ).length;
  fixtureReports.push({
    id: fixture.id,
    candidateCount: response.value.groups.length,
    relevantCandidateCount,
    relevantDocumentCount: availableRelevance.length,
    missingRelevantDocumentIds: availableRelevance
      .filter((target) => !candidateIds.has(target.documentId))
      .map((target) => target.documentId),
    modeUsed: response.value.modeUsed,
    elapsedMs: response.value.elapsedMs,
  });

  for (const [index, group] of response.value.groups.entries()) {
    const document = documentsById.get(group.documentId);
    const target = relevantTarget(fixture, group.documentId);
    const sectionTypes = [
      ...new Set(
        group.results
          .map((result) => result.sectionType)
          .filter((sectionType): sectionType is string => sectionType !== null),
      ),
    ];
    const matchedTerms = [...new Set(group.results.flatMap((result) => result.matchedTerms))];
    const matchedBranches = [...new Set(group.results.flatMap((result) => result.matchedBranches))];
    const surfaces = surfaceFlags(fixture.query, document);

    lines.push(
      JSON.stringify({
        schemaVersion: 1,
        fixtureId: fixture.id,
        query: fixture.query,
        origin: fixture.origin,
        family: fixture.family,
        goal: fixture.goal,
        answerability: fixture.answerability,
        analysis: {
          primaryIntent: response.value.analysis.intent?.primary ?? null,
          secondaryIntents: response.value.analysis.intent?.secondary ?? [],
          intentConfidence: response.value.analysis.intent?.confidence ?? 0,
          needsClarification: response.value.analysis.intent?.needsClarification ?? false,
          ageFacts: response.value.analysis.clinicalContext?.age.map((fact) => fact.normalizedValue) ?? [],
          positiveFindingCount:
            response.value.analysis.clinicalContext?.positiveFindings.length ?? 0,
          negativeFindingCount:
            response.value.analysis.clinicalContext?.negativeFindings.length ?? 0,
          currentMedicineCount:
            response.value.analysis.clinicalContext?.currentMedicines.length ?? 0,
          branchKinds: [
            ...new Set(response.value.analysis.branches.map((branch) => branch.kind)),
          ],
        },
        retrieval: {
          requestedMode: mode,
          modeUsed: response.value.modeUsed,
          originalRank: index + 1,
          groupBestScore: group.bestScore,
          maximumLexicalScore: maximum(group.results.map((result) => result.lexicalScore)),
          maximumSemanticScore: maximumNullable(
            group.results.map((result) => result.semanticScore),
          ),
          maximumFinalScore: maximum(group.results.map((result) => result.finalScore)),
          resultCount: group.results.length,
          matchedTermCount: matchedTerms.length,
          matchedBranchCount: matchedBranches.length,
          sectionTypes,
          topSectionType: group.results[0]?.sectionType ?? null,
          terminologyMatch: group.terminologyMatch ?? null,
          exactTitle: surfaces.exactTitle,
          exactNavigationAlias: surfaces.exactNavigationAlias,
          exactDeclaredAlias: surfaces.exactDeclaredAlias,
        },
        candidate: {
          documentId: group.documentId,
          conceptId: group.conceptId ?? null,
          canonicalName: document?.title ?? group.title,
          shortTitle: document?.shortTitle ?? null,
          sourceType: document?.sourceType ?? null,
          navigationAliases: metadataStrings(document?.metadata, 'navigationAliases'),
          declaredAliases: metadataStrings(document?.metadata, 'declaredAliases'),
          ageGroups: metadataStrings(document?.metadata, 'ageGroups'),
          evidence: compactEvidence(group),
        },
        label: {
          relevanceGrade: target?.grade ?? 0,
          expectedSectionTypes: target?.sectionTypes ?? [],
          forbidden: fixture.forbiddenDocumentIds.includes(group.documentId),
        },
      }),
    );
  }
}

await core.close();

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');

const missingRelevantPairs = fixtureReports.reduce(
  (sum, fixture) => sum + fixture.missingRelevantDocumentIds.length,
  0,
);
const report = {
  schemaVersion: 1,
  dataset: trainingExport
    ? 'minimed-search-quality-linear-training-candidates'
    : 'minimed-search-quality-v2-frozen-candidates',
  generatedAt: new Date().toISOString(),
  retrievalProfile: mode,
  candidateLimit: limit,
  fixture: {
    kind: trainingExport ? 'legacy-pilot-masked-training' : 'graded-challenge',
    path: trainingExport ? (legacyPilotPath as string) : fixturePath,
    sha256: sha256(trainingExport ? (legacyPilotPath as string) : fixturePath),
    leakageFixturePath: trainingExport ? leakageFixturePath : null,
    leakageFixtureSha256: trainingExport ? sha256(leakageFixturePath) : null,
    count: fixtures.length,
  },
  corpus: {
    contentPackIds: initialized.value.contentPackIds,
    paths: [corePath, ...packs].map((path) => ({ path, sha256: sha256(path) })),
  },
  output: {
    path: outputPath,
    candidatePairCount: lines.length,
  },
  coverage: {
    missingRelevantPairs,
    fixturesWithMissingRelevantCandidates: fixtureReports.filter(
      (fixture) => fixture.missingRelevantDocumentIds.length > 0,
    ).length,
    fixtures: fixtureReports,
  },
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      outputPath,
      reportPath,
      retrievalProfile: mode,
      candidateLimit: limit,
      candidatePairCount: lines.length,
      missingRelevantPairs,
    },
    null,
    2,
  ),
);

if (missingRelevantPairs > 0) {
  console.error(
    `Frozen candidate export is incomplete: ${missingRelevantPairs} relevant document(s) are missing.`,
  );
  process.exitCode = 1;
}
