import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { createMedicalCore, QueryDocumentIndex } from '@localmed/core';
import { MultiMedicalStore } from '@localmed/storage';

import { createBunFileMedicalStore } from './bun-sqlite-medical-store';
import { buildLookupQualityCases } from './lookup-quality-cases';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string) =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
for (const arg of args) {
  if (!/^--(?:core|pack|report|max|min-top1|min-recall20)=.+/u.test(arg)) {
    throw new Error(`Unknown argument ${arg}`);
  }
}

const projectPath = (value: string | undefined, fallback: string) =>
  resolve(root, value ?? fallback);
const corePath = projectPath(option('core'), 'apps/app/public/content/core.db');
const packs = args
  .filter((arg) => arg.startsWith('--pack='))
  .map((arg) => projectPath(arg.slice(7), ''));
const reportPath = projectPath(option('report'), 'data/build/lookup-quality-report.json');
const maxValue = Number(option('max') ?? '500');
if (!Number.isInteger(maxValue) || maxValue < 0) {
  throw new Error('--max must be a non-negative integer.');
}
const minimumTop1 = Number(option('min-top1') ?? '1');
const minimumRecallAt20 = Number(option('min-recall20') ?? '1');
for (const [name, value] of [
  ['--min-top1', minimumTop1],
  ['--min-recall20', minimumRecallAt20],
] as const) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }
}
for (const path of [corePath, ...packs]) {
  if (!existsSync(path)) throw new Error(`Lookup benchmark database does not exist: ${path}`);
}

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
const core = createMedicalCore({ store, platform: 'test' });
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);
const listed = await store.listNavigationDocuments();
const health = await store.getHealth();

const allCases = buildLookupQualityCases(listed);
const cases = maxValue === 0 ? allCases : allCases.slice(0, maxValue);
if (cases.length === 0) throw new Error('No eligible lookup surfaces were found.');

const identityIndex = new QueryDocumentIndex(
  listed.map(({ id, title, shortTitle, sourceType, metadata }) => ({
    id,
    title,
    shortTitle,
    sourceType,
    metadata: metadata ?? {},
  })),
);
const sortedIds = (values: Iterable<string>): readonly string[] => [...values].toSorted();
const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const identityAuditRows = allCases
  .filter((fixture) => fixture.strictIdentityDocumentIds.length > 0)
  .map((fixture) => {
    const titleIds = sortedIds(identityIndex.exactTitleIds(fixture.query));
    const secondaryIds = sortedIds(
      new Set([
        ...identityIndex.exactShortTitleIds(fixture.query),
        ...identityIndex.exactNavigationAliasIds(fixture.query),
      ]),
    );
    const identityIds = sortedIds(identityIndex.exactIdentityIds(fixture.query));
    const expectedIdentityIds = fixture.strictIdentityDocumentIds.toSorted();
    const expectedTopTierIds = fixture.expectedTop1DocumentIds.toSorted();
    const actualTopTierIds = titleIds.length > 0 ? titleIds : secondaryIds;
    return {
      id: fixture.id,
      query: fixture.query,
      expectedIdentityIds,
      actualIdentityIds: identityIds,
      expectedTopTierIds,
      actualTopTierIds,
      identitySetPass: sameIds(identityIds, expectedIdentityIds),
      topTierPass: sameIds(actualTopTierIds, expectedTopTierIds),
    };
  });
if (identityAuditRows.length === 0) {
  throw new Error('No strict identity surfaces were found for exhaustive audit.');
}
const auditedIdentityDocumentCount = identityAuditRows.reduce(
  (sum, row) => sum + row.expectedIdentityIds.length,
  0,
);
const retainedIdentityDocumentCount = identityAuditRows.reduce(
  (sum, row) =>
    sum +
    row.expectedIdentityIds.filter((documentId) => row.actualIdentityIds.includes(documentId))
      .length,
  0,
);
const identityRecall =
  auditedIdentityDocumentCount === 0
    ? 0
    : retainedIdentityDocumentCount / auditedIdentityDocumentCount;
const identitySetAgreementRate =
  identityAuditRows.filter((row) => row.identitySetPass).length / identityAuditRows.length;
const identityTopTierAgreementRate =
  identityAuditRows.filter((row) => row.topTierPass).length / identityAuditRows.length;

const rows: {
  id: string;
  query: string;
  kinds: readonly string[];
  expectedTop1DocumentIds: readonly string[];
  strictIdentityDocumentIds: readonly string[];
  exactSurfaceDocumentIds: readonly string[];
  top1DocumentId: string | null;
  firstExpectedRank: number | null;
  firstStrictIdentityRank: number | null;
  firstExactSurfaceRank: number | null;
  top1Pass: boolean | null;
  strictIdentityRecallAt20: boolean | null;
  exactSurfaceRecallAt20: boolean;
  bodyOnlyIntrusion: boolean;
  weakerExactWon: boolean;
  elapsedMs: number;
}[] = [];

for (const fixture of cases) {
  const response = await core.search({
    query: fixture.query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const documentIds = response.value.groups.map((group) => group.documentId);
  const top1DocumentId = documentIds[0] ?? null;
  const firstExpectedIndex = documentIds.findIndex((documentId) =>
    fixture.expectedTop1DocumentIds.includes(documentId),
  );
  const firstStrictIdentityIndex = documentIds.findIndex((documentId) =>
    fixture.strictIdentityDocumentIds.includes(documentId),
  );
  const firstExactSurfaceIndex = documentIds.findIndex((documentId) =>
    fixture.exactSurfaceDocumentIds.includes(documentId),
  );
  rows.push({
    id: fixture.id,
    query: fixture.query,
    kinds: fixture.kinds,
    expectedTop1DocumentIds: fixture.expectedTop1DocumentIds,
    strictIdentityDocumentIds: fixture.strictIdentityDocumentIds,
    exactSurfaceDocumentIds: fixture.exactSurfaceDocumentIds,
    top1DocumentId,
    firstExpectedRank: firstExpectedIndex < 0 ? null : firstExpectedIndex + 1,
    firstStrictIdentityRank: firstStrictIdentityIndex < 0 ? null : firstStrictIdentityIndex + 1,
    firstExactSurfaceRank: firstExactSurfaceIndex < 0 ? null : firstExactSurfaceIndex + 1,
    top1Pass:
      fixture.expectedTop1DocumentIds.length === 0
        ? null
        : top1DocumentId !== null && fixture.expectedTop1DocumentIds.includes(top1DocumentId),
    strictIdentityRecallAt20:
      fixture.strictIdentityDocumentIds.length === 0
        ? null
        : firstStrictIdentityIndex >= 0 && firstStrictIdentityIndex < 20,
    exactSurfaceRecallAt20: firstExactSurfaceIndex >= 0 && firstExactSurfaceIndex < 20,
    bodyOnlyIntrusion:
      top1DocumentId !== null && !fixture.exactSurfaceDocumentIds.includes(top1DocumentId),
    weakerExactWon:
      top1DocumentId !== null &&
      fixture.exactSurfaceDocumentIds.includes(top1DocumentId) &&
      fixture.expectedTop1DocumentIds.length > 0 &&
      !fixture.expectedTop1DocumentIds.includes(top1DocumentId),
    elapsedMs: response.value.elapsedMs,
  });
}
await core.close();

const strictRows = rows.filter((row) => row.strictIdentityRecallAt20 !== null);
if (strictRows.length === 0) throw new Error('No strict identity lookup surfaces were found.');
const discoveryRows = rows.filter((row) => row.strictIdentityRecallAt20 === null);
const top1Rate = strictRows.filter((row) => row.top1Pass === true).length / strictRows.length;
const strictIdentityRecallAt20 =
  strictRows.filter((row) => row.strictIdentityRecallAt20 === true).length / strictRows.length;
const discoveryAliasRecallAt20 =
  discoveryRows.length === 0
    ? 1
    : discoveryRows.filter((row) => row.exactSurfaceRecallAt20).length / discoveryRows.length;
const overallExactSurfaceRecallAt20 =
  rows.filter((row) => row.exactSurfaceRecallAt20).length / rows.length;
const strictBodyOnlyIntrusionRate =
  strictRows.filter((row) => row.bodyOnlyIntrusion).length / strictRows.length;
const discoveryBodyOnlyIntrusionRate =
  discoveryRows.length === 0
    ? 0
    : discoveryRows.filter((row) => row.bodyOnlyIntrusion).length / discoveryRows.length;
const bodyOnlyIntrusionRate = rows.filter((row) => row.bodyOnlyIntrusion).length / rows.length;
const weakerExactRate = strictRows.filter((row) => row.weakerExactWon).length / strictRows.length;
const timings = rows.map((row) => row.elapsedMs).toSorted((left, right) => left - right);
const percentile = (p: number) =>
  timings[Math.min(timings.length - 1, Math.floor(timings.length * p))] ?? 0;

const report = {
  schemaVersion: 2,
  dataset: 'minimed-corpus-derived-lookup-quality',
  generatedAt: new Date().toISOString(),
  corpus: {
    contentPackIds: initialized.value.contentPackIds,
    documentCount: health.documentCount,
    databasePaths: [corePath, ...packs],
  },
  eligibleSurfaceCount: allCases.length,
  evaluatedSurfaceCount: rows.length,
  deterministicSampleMax: maxValue,
  identityAudit: {
    strictCaseCount: identityAuditRows.length,
    strictIdentityDocumentCount: auditedIdentityDocumentCount,
    identityRecall,
    identitySetAgreementRate,
    topTierAgreementRate: identityTopTierAgreementRate,
    failures: identityAuditRows.filter((row) => !row.identitySetPass || !row.topTierPass),
  },
  metrics: {
    strictTop1Cases: strictRows.length,
    discoveryOnlyCases: rows.length - strictRows.length,
    top1Rate,
    strictIdentityRecallAt20,
    discoveryAliasRecallAt20,
    overallExactSurfaceRecallAt20,
    strictBodyOnlyIntrusionRate,
    discoveryBodyOnlyIntrusionRate,
    bodyOnlyIntrusionRate,
    weakerExactRate,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  },
  failures: strictRows.filter(
    (row) => row.top1Pass === false || row.strictIdentityRecallAt20 === false,
  ),
  discoveryMisses: discoveryRows.filter((row) => !row.exactSurfaceRecallAt20),
  rows,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      reportPath,
      eligibleSurfaceCount: allCases.length,
      evaluatedSurfaceCount: rows.length,
      identityAudit: {
        strictCaseCount: identityAuditRows.length,
        identityRecall,
        identitySetAgreementRate,
        topTierAgreementRate: identityTopTierAgreementRate,
      },
      metrics: report.metrics,
      failureCount:
        report.failures.length +
        identityAuditRows.filter((row) => !row.identitySetPass || !row.topTierPass).length,
      discoveryMissCount: report.discoveryMisses.length,
    },
    null,
    2,
  ),
);

const failures: string[] = [];
if (identityRecall < 1) {
  failures.push(`strict identity index recall ${identityRecall.toFixed(4)} < 1.0000`);
}
if (identitySetAgreementRate < 1) {
  failures.push(`strict identity set agreement ${identitySetAgreementRate.toFixed(4)} < 1.0000`);
}
if (identityTopTierAgreementRate < 1) {
  failures.push(
    `strict identity tier agreement ${identityTopTierAgreementRate.toFixed(4)} < 1.0000`,
  );
}
if (top1Rate < minimumTop1) {
  failures.push(`exact lookup Top-1 ${top1Rate.toFixed(4)} < ${minimumTop1.toFixed(4)}`);
}
if (strictIdentityRecallAt20 < minimumRecallAt20) {
  failures.push(
    `strict identity recall@20 ${strictIdentityRecallAt20.toFixed(4)} < ${minimumRecallAt20.toFixed(4)}`,
  );
}
if (failures.length > 0) {
  console.error(`Corpus lookup quality failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
