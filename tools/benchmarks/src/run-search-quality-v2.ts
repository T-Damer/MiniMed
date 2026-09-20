import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';

import { createBunFileMedicalStore } from './bun-sqlite-medical-store';
import {
  aggregateSearchQuality,
  evaluateSearchQuality,
  loadSearchQualityFixtures,
  type SearchQualityEvaluation,
  type SearchQualityFixture,
} from './search-quality-dataset';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string) =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
for (const arg of args) {
  if (!/^--(?:core|pack|fixtures|report|profiles)=.+/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}

const corePath = resolve(option('core') ?? resolve(root, 'data/build/rf-public-pilot.db'));
const packs = args.filter((arg) => arg.startsWith('--pack=')).map((arg) => resolve(arg.slice(7)));
const fixturePath = resolve(
  option('fixtures') ?? resolve(root, 'tools/benchmarks/search-quality-v2.json'),
);
const reportPath = resolve(option('report') ?? resolve(root, 'data/build/search-quality-v2-report.json'));
const profileNames = (option('profiles') ?? 'lexical,hybrid')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (
  profileNames.length === 0 ||
  profileNames.some((profile) => profile !== 'lexical' && profile !== 'hybrid')
) {
  throw new Error('--profiles must contain lexical and/or hybrid.');
}

for (const path of [corePath, ...packs, fixturePath]) {
  if (!existsSync(path)) throw new Error(`Search-quality input does not exist: ${path}`);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fixtureWithAvailableTargets(
  fixture: SearchQualityFixture,
  availableDocumentIds: ReadonlySet<string>,
): {
  readonly fixture: SearchQualityFixture | null;
  readonly missingRelevantDocumentIds: readonly string[];
} {
  const availableTargets = fixture.relevance.filter((target) =>
    availableDocumentIds.has(target.documentId),
  );
  const missingRelevantDocumentIds = fixture.relevance
    .filter((target) => !availableDocumentIds.has(target.documentId))
    .map((target) => target.documentId);
  if (availableTargets.length === 0) return { fixture: null, missingRelevantDocumentIds };
  return {
    fixture: { ...fixture, relevance: availableTargets },
    missingRelevantDocumentIds,
  };
}

function groupedMetrics(rows: readonly SearchQualityEvaluation[], key: 'family' | 'goal') {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row[key]))]
      .toSorted()
      .map((value) => [value, aggregateSearchQuality(rows.filter((row) => row[key] === value))]),
  );
}

function threshold(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1.`);
  }
  return value;
}

const minimumCandidateRecallAt20 = threshold('MINIMED_SEARCH_QUALITY_MIN_RECALL_AT_20');
const minimumNdcgAt5 = threshold('MINIMED_SEARCH_QUALITY_MIN_NDCG_AT_5');
const minimumSectionHitAt5 = threshold('MINIMED_SEARCH_QUALITY_MIN_SECTION_HIT_AT_5');
const maximumForbiddenRateAt5 = threshold('MINIMED_SEARCH_QUALITY_MAX_FORBIDDEN_RATE_AT_5');

const fixtures = loadSearchQualityFixtures(fixturePath);
const store = new MultiMedicalStore(
  await Promise.all(
    [corePath, ...packs].map(async (path, index) => ({
      moduleId: `${index}:${basename(path)}`,
      store: await createBunFileMedicalStore(path),
      required: true,
      searchWeight: index === 0 ? 1.1 : 1,
    })),
  ),
);
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new PortableHashEmbedder(),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const targetDocumentIds = [
  ...new Set(fixtures.flatMap((fixture) => fixture.relevance.map((target) => target.documentId))),
];
const availableDocumentIds = new Set<string>();
for (const documentId of targetDocumentIds) {
  if (await store.getDocument(documentId)) availableDocumentIds.add(documentId);
}
const health = await store.getHealth();

const coverageRows = fixtures.map((fixture) => {
  const covered = fixtureWithAvailableTargets(fixture, availableDocumentIds);
  return {
    id: fixture.id,
    family: fixture.family,
    availableRelevantDocuments: covered.fixture?.relevance.length ?? 0,
    totalRelevantDocuments: fixture.relevance.length,
    missingRelevantDocumentIds: covered.missingRelevantDocumentIds,
  };
});
const excluded = coverageRows
  .filter((row) => row.availableRelevantDocuments === 0)
  .map((row) => ({ id: row.id, reason: 'No relevant document is installed in the evaluated corpus.' }));

const rows: SearchQualityEvaluation[] = [];
for (const profile of profileNames) {
  for (const originalFixture of fixtures) {
    const { fixture } = fixtureWithAvailableTargets(originalFixture, availableDocumentIds);
    if (!fixture) continue;
    const response = await core.search({
      query: fixture.query,
      mode: profile as 'lexical' | 'hybrid',
      analysisMode: 'clinical',
      filters: {},
      limit: 40,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(`${fixture.id}/${profile}: ${response.error.message}`);
    rows.push(
      evaluateSearchQuality(
        fixture,
        response.value.groups,
        profile,
        response.value.elapsedMs,
        response.value.modeUsed,
      ),
    );
  }
}
await core.close();

const byProfile = Object.fromEntries(
  profileNames.map((profile) => {
    const profileRows = rows.filter((row) => row.profile === profile);
    return [
      profile,
      {
        ...aggregateSearchQuality(profileRows),
        slices: {
          family: groupedMetrics(profileRows, 'family'),
          goal: groupedMetrics(profileRows, 'goal'),
        },
        modeUsedCounts: Object.fromEntries(
          [...new Set(profileRows.map((row) => row.modeUsed))]
            .toSorted()
            .map((mode) => [mode, profileRows.filter((row) => row.modeUsed === mode).length]),
        ),
      },
    ];
  }),
);

const hybrid = byProfile['hybrid'] as ReturnType<typeof aggregateSearchQuality> | undefined;
const lexical = byProfile['lexical'] as ReturnType<typeof aggregateSearchQuality> | undefined;
const deltas =
  hybrid && lexical
    ? {
        top1MaxGrade: hybrid.top1MaxGrade - lexical.top1MaxGrade,
        relevantRecallAt20: hybrid.relevantRecallAt20 - lexical.relevantRecallAt20,
        relevantRecallAt40: hybrid.relevantRecallAt40 - lexical.relevantRecallAt40,
        ndcgAt5: hybrid.ndcgAt5 - lexical.ndcgAt5,
        ndcgAt10: hybrid.ndcgAt10 - lexical.ndcgAt10,
        sectionHitAt5: hybrid.sectionHitAt5 - lexical.sectionHitAt5,
      }
    : null;

const report = {
  schemaVersion: 2,
  dataset: 'minimed-search-quality-v2-manual-challenge',
  generatedAt: new Date().toISOString(),
  note:
    'Visible manual regression set. It is diagnosis-name-free and graded, but it is not a blind clinician qualification set.',
  fixture: { path: fixturePath, sha256: sha256(fixturePath), count: fixtures.length },
  corpus: {
    contentPackIds: initialized.value.contentPackIds,
    paths: [corePath, ...packs].map((path) => ({ path, sha256: sha256(path) })),
    documentCount: health.documentCount,
  },
  coverage: {
    fullyCovered: coverageRows.filter((row) => row.missingRelevantDocumentIds.length === 0).length,
    partiallyCovered: coverageRows.filter(
      (row) =>
        row.availableRelevantDocuments > 0 && row.missingRelevantDocumentIds.length > 0,
    ).length,
    uncovered: excluded.length,
    rows: coverageRows,
  },
  profiles: byProfile,
  deltas,
  excluded,
  rows,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      reportPath,
      fixtureCount: fixtures.length,
      evaluatedCases: rows.length,
      uncoveredCases: excluded.length,
      profiles: byProfile,
      deltas,
    },
    null,
    2,
  ),
);

const gateProfileName = profileNames.includes('hybrid') ? 'hybrid' : profileNames[0];
const gateMetrics =
  gateProfileName === undefined
    ? undefined
    : (byProfile[gateProfileName] as ReturnType<typeof aggregateSearchQuality> | undefined);
const failures: string[] = [];
if (!gateMetrics) failures.push('No benchmark profile produced metrics.');
if (
  gateMetrics &&
  minimumCandidateRecallAt20 !== undefined &&
  gateMetrics.relevantRecallAt20 < minimumCandidateRecallAt20
) {
  failures.push(
    `relevant recall@20 ${gateMetrics.relevantRecallAt20.toFixed(3)} < ${minimumCandidateRecallAt20.toFixed(3)}`,
  );
}
if (gateMetrics && minimumNdcgAt5 !== undefined && gateMetrics.ndcgAt5 < minimumNdcgAt5) {
  failures.push(`NDCG@5 ${gateMetrics.ndcgAt5.toFixed(3)} < ${minimumNdcgAt5.toFixed(3)}`);
}
if (
  gateMetrics &&
  minimumSectionHitAt5 !== undefined &&
  gateMetrics.sectionHitAt5 < minimumSectionHitAt5
) {
  failures.push(
    `section hit@5 ${gateMetrics.sectionHitAt5.toFixed(3)} < ${minimumSectionHitAt5.toFixed(3)}`,
  );
}
if (
  gateMetrics &&
  maximumForbiddenRateAt5 !== undefined &&
  gateMetrics.forbiddenRateAt5 > maximumForbiddenRateAt5
) {
  failures.push(
    `forbidden rate@5 ${gateMetrics.forbiddenRateAt5.toFixed(3)} > ${maximumForbiddenRateAt5.toFixed(3)}`,
  );
}
if (failures.length > 0) {
  console.error(`Search quality v2 failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
