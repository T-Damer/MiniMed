import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MedicalCore } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';

import { createBunFileMedicalStore } from './bun-sqlite-medical-store';
import {
  aggregateEsklpMedicationEvaluations,
  ESKLP_GATE_MINIMUMS,
  evaluateEsklpMedicationQuery,
  validateEsklpMedicationFixture,
} from './esklp-full-medication-scoring';

const root = resolve(import.meta.dirname, '../../..');
const benchmarkEnv = process.env as {
  readonly MINIMED_ESKLP_DATABASE_PATH?: string;
  readonly MINIMED_ESKLP_REPORT_PATH?: string;
};
const databasePathValue = benchmarkEnv.MINIMED_ESKLP_DATABASE_PATH;
if (!databasePathValue?.trim()) {
  throw new Error('MINIMED_ESKLP_DATABASE_PATH is required; no default database is used.');
}
const databasePath = resolve(databasePathValue);
if (!existsSync(databasePath)) {
  throw new Error(`ESKLP benchmark database does not exist: ${databasePath}`);
}

const reportPath = benchmarkEnv.MINIMED_ESKLP_REPORT_PATH;
if (reportPath !== undefined && reportPath.trim().length === 0) {
  throw new Error('MINIMED_ESKLP_REPORT_PATH must be a non-empty path when provided.');
}

const fixturePath = resolve(root, 'tools/benchmarks/esklp-full-medication-queries.json');
const fixture = validateEsklpMedicationFixture(
  JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown,
);

let store: Awaited<ReturnType<typeof createBunFileMedicalStore>> | undefined;
let core: MedicalCore | undefined;
try {
  store = await createBunFileMedicalStore(databasePath);
  core = createMedicalCore({ store, platform: 'test' });
  const initialized = await core.initialize();
  if (!initialized.ok) throw new Error(initialized.error.message);
  const listed = await core.listDocuments();
  if (!listed.ok) throw new Error(listed.error.message);
  const pointerTargets = new Map<string, string>();
  for (const document of listed.value) {
    const metadata = document.metadata;
    const targetDocumentId = metadata?.['targetDocumentId'];
    if (
      document.sourceType === 'core_catalog_pointer' &&
      metadata?.['catalogFamily'] === 'medication' &&
      typeof targetDocumentId === 'string'
    ) {
      pointerTargets.set(document.id, targetDocumentId);
    }
  }
  const resolveIdentity = (documentId: string): string =>
    pointerTargets.get(documentId) ?? documentId;

  const rows = [];
  for (const query of fixture.queries) {
    const response = await core.search({
      query: query.query,
      mode: 'lexical',
      filters: {},
      limit: 5,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(`${query.id}: ${response.error.message}`);
    rows.push(
      evaluateEsklpMedicationQuery(
        query,
        response.value.groups,
        response.value.elapsedMs,
        resolveIdentity,
      ),
    );
  }

  const aggregate = aggregateEsklpMedicationEvaluations(rows);
  const gate = (value: number | null, minimum: number) => ({
    value,
    minimum,
    passed: value !== null && value >= minimum,
  });
  const gates = {
    'entity Recall@5': gate(aggregate.entityRecallAt5, ESKLP_GATE_MINIMUMS.entityRecallAt5),
    'Hit@5': gate(aggregate.hitAt5, ESKLP_GATE_MINIMUMS.hitAt5),
    'MRR@5': gate(aggregate.mrrAt5, ESKLP_GATE_MINIMUMS.mrrAt5),
    exactSupportedIdentityTop1: gate(
      aggregate.exactSupportedIdentityTop1,
      ESKLP_GATE_MINIMUMS.exactSupportedIdentityTop1,
    ),
    evidenceHit: gate(aggregate.evidenceHit, ESKLP_GATE_MINIMUMS.evidenceHit),
  };
  const passed = Object.values(gates).every((item) => item.passed);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixture: {
      id: fixture.id,
      path: fixturePath,
      queryCount: fixture.queries.length,
      trustedDoseData: fixture.trustedDoseData,
    },
    databasePath,
    corpus: {
      contentPackIds: initialized.value.contentPackIds,
      documentCount: initialized.value.documentCount,
    },
    mode: 'lexical',
    metrics: {
      'entity Recall@5': aggregate.entityRecallAt5,
      'Hit@5': aggregate.hitAt5,
      'MRR@5': aggregate.mrrAt5,
      exactSupportedIdentityTop1: aggregate.exactSupportedIdentityTop1,
      evidenceHit: aggregate.evidenceHit,
    },
    denominators: {
      queryCount: aggregate.queryCount,
      identityTop1FixtureCount: aggregate.identityTop1FixtureCount,
      evidenceQueryCount: aggregate.evidenceQueryCount,
    },
    gates,
    passed,
    rows,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath === undefined) {
    process.stdout.write(serialized);
  } else {
    writeFileSync(reportPath, serialized, 'utf8');
  }
  if (!passed) {
    const failures = Object.entries(gates)
      .filter(([, item]) => !item.passed)
      .map(([name, item]) => `${name}=${String(item.value)} < ${item.minimum}`);
    console.error(`ESKLP full medication benchmark failed: ${failures.join('; ')}`);
    process.exitCode = 1;
  }
} finally {
  if (core) {
    await core.close();
  } else if (store) {
    await store.close();
  }
}
