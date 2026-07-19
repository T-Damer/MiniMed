import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { QueryBranchKind, QueryFactKind } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

interface ClinicalCaseFixture {
  readonly id: string;
  readonly query: string;
  readonly expectedDocumentId: string;
  readonly expectedRankAtMost?: number;
  readonly expectedFactKinds: readonly QueryFactKind[];
  readonly expectedBranchKinds: readonly QueryBranchKind[];
  readonly negativeContains?: readonly string[];
  readonly excludedClinicalTerms?: readonly string[];
  readonly minimumWarnings?: number;
}

interface ClinicalCaseRow {
  readonly id: string;
  readonly passed: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly factKinds: readonly QueryFactKind[];
  readonly branchKinds: readonly QueryBranchKind[];
  readonly topDocuments: readonly string[];
  readonly expectedDocumentRank: number | null;
  readonly warningCount: number;
}

function parseCases(value: unknown): readonly ClinicalCaseFixture[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Clinical-case benchmark must be a non-empty array.');
  }
  return value as readonly ClinicalCaseFixture[];
}

function includesEvery<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return expected.every((item) => actual.includes(item));
}

const root = resolve(import.meta.dirname, '../../..');
const fixtures = parseCases(
  JSON.parse(readFileSync(resolve(root, 'tools/benchmarks/clinical-cases.json'), 'utf8')),
);
const databaseBytes = new Uint8Array(
  readFileSync(resolve(root, 'apps/app/public/content/core-demo.db')),
);
const store = await SqliteMedicalStore.createFromBytes(databaseBytes);
const core = createMedicalCore({ store, platform: 'test' });
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

const rows: ClinicalCaseRow[] = [];
for (const fixture of fixtures) {
  const analysisResult = await core.analyzeQuery({
    query: fixture.query,
    includeSuggestions: true,
  });
  if (!analysisResult.ok) throw new Error(`${fixture.id}: ${analysisResult.error.message}`);

  const searchResult = await core.search({
    query: fixture.query,
    mode: 'lexical',
    filters: {},
    limit: 10,
    includeSuggestions: true,
  });
  if (!searchResult.ok) throw new Error(`${fixture.id}: ${searchResult.error.message}`);

  const analysis = analysisResult.value;
  const factKinds = [...new Set(analysis.facts.map((fact) => fact.kind))];
  const branchKinds = [...new Set(analysis.branches.map((branch) => branch.kind))];
  const allDocuments = searchResult.value.groups.map((group) => group.documentId);
  const topDocuments = allDocuments.slice(0, 5);
  const expectedDocumentIndex = allDocuments.indexOf(fixture.expectedDocumentId);
  const expectedDocumentRank = expectedDocumentIndex >= 0 ? expectedDocumentIndex + 1 : null;
  const negativeValues = analysis.facts
    .filter((fact) => fact.kind === 'negative-finding')
    .map((fact) => fact.normalizedValue);
  const clinicalTerms = analysis.branches.find((branch) => branch.kind === 'clinical')?.terms ?? [];

  const checks = {
    expectedDocumentRankSatisfied:
      expectedDocumentRank !== null && expectedDocumentRank <= (fixture.expectedRankAtMost ?? 1),
    expectedFactsPresent: includesEvery(factKinds, fixture.expectedFactKinds),
    expectedBranchesPresent: includesEvery(branchKinds, fixture.expectedBranchKinds),
    negativeSpansPresent: (fixture.negativeContains ?? []).every((fragment) =>
      negativeValues.some((value) => value.includes(fragment)),
    ),
    negatedTermsExcludedFromClinicalBranch: (fixture.excludedClinicalTerms ?? []).every(
      (term) => !clinicalTerms.includes(term),
    ),
    warningCountSatisfied: analysis.warnings.length >= (fixture.minimumWarnings ?? 0),
  };
  rows.push({
    id: fixture.id,
    passed: Object.values(checks).every(Boolean),
    checks,
    factKinds,
    branchKinds,
    topDocuments,
    expectedDocumentRank,
    warningCount: analysis.warnings.length,
  });
}
await core.close();

const report = {
  generatedAt: new Date().toISOString(),
  fixtureCount: rows.length,
  passRate: rows.filter((row) => row.passed).length / rows.length,
  rows,
};
writeFileSync(
  resolve(root, 'data/build/clinical-case-benchmark.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(report, null, 2));

const failed = rows.filter((row) => !row.passed);
if (failed.length > 0) {
  console.error(`Clinical-case benchmark failed: ${failed.map((row) => row.id).join(', ')}`);
  process.exit(1);
}
process.exit(0);
