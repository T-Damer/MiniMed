/** Fixed public queries; production core/SQL adapter, no LLM and no patient-query logging. */
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createMedicalCore } from '@localmed/core';
import { MultiMedicalStore } from '@localmed/storage';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

const CASES = [
  ['munchausen', 'синдром Мюнхгаузена'],
  ['pneumonia', 'пневмония'],
  ['eosinophilic-esophagitis', 'эозинофильный эзофагит'],
  ['ceftriaxone', 'цефтриаксон'],
  ['panic-attack', 'паническая атака'],
  ['body-perception', 'нарушение восприятия собственного тела'],
] as const;
const args = process.argv.slice(2);
for (const arg of args) {
  if (!/^--(?:core|pack|report|rounds|label)=.+/u.test(arg))
    throw new Error(`Unknown option: ${arg}`);
}
const option = (name: string) =>
  args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const corePath = resolve(option('core') ?? 'apps/app/public/content/core.db');
const packPaths = args
  .filter((value) => value.startsWith('--pack='))
  .map((value) => resolve(value.slice(7)));
const reportPath = resolve(option('report') ?? 'data/build/terminology-performance.json');
const rounds = Number(option('rounds') ?? 7);
if (!Number.isInteger(rounds) || rounds < 3 || rounds > 50)
  throw new Error('--rounds must be 3..50');

async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const block of createReadStream(path)) hash.update(block);
  return `sha256:${hash.digest('hex')}`;
}
function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round((sorted[index] ?? 0) * 100) / 100;
}
async function open() {
  const mounts = [];
  for (const [index, path] of [corePath, ...packPaths].entries()) {
    mounts.push({
      moduleId: `measurement-${index}`,
      store: await createBunFileMedicalStore(path),
      required: index === 0,
      searchWeight: 1,
    });
  }
  const core = createMedicalCore({
    store: mounts.length === 1 && mounts[0] ? mounts[0].store : new MultiMedicalStore(mounts),
    platform: 'test',
  });
  const result = await core.initialize();
  if (!result.ok) throw new Error(result.error.message);
  return { core, documentCount: result.value.documentCount };
}
const inputs = await Promise.all(
  [corePath, ...packPaths].map(async (path) => ({ path, sha256: await checksum(path) })),
);
const { core, documentCount } = await open();
const measurements: {
  caseId: string;
  coldMs: number;
  warmMs: number[];
  topDocumentIds: string[];
}[] = [];
let firstReaderDocument: string | undefined;
try {
  for (let round = 0; round <= rounds; round += 1) {
    for (const [caseId, query] of CASES) {
      const started = performance.now();
      const response = await core.search({
        query,
        mode: 'lexical',
        analysisMode: 'lookup',
        filters: {},
        limit: 20,
        includeSuggestions: false,
      });
      const elapsed = performance.now() - started;
      if (!response.ok) throw new Error(response.error.message);
      if (caseId === 'pneumonia') firstReaderDocument ??= response.value.groups[0]?.documentId;
      let row = measurements.find((entry) => entry.caseId === caseId);
      if (!row) {
        row = {
          caseId,
          coldMs: elapsed,
          warmMs: [],
          topDocumentIds: response.value.groups.slice(0, 5).map((group) => group.documentId),
        };
        measurements.push(row);
      } else row.warmMs.push(elapsed);
    }
  }
} finally {
  await core.close();
}

const reader: Record<string, number> = {};
if (firstReaderDocument) {
  const legacy = await open();
  try {
    const started = performance.now();
    const catalog = await legacy.core.listDocuments();
    if (!catalog.ok) throw new Error(catalog.error.message);
    reader['fullCatalogMs'] = performance.now() - started;
    const document = await legacy.core.getDocument(firstReaderDocument);
    if (!document.ok) throw new Error(document.error.message);
    reader['catalogBeforeDocumentMs'] = performance.now() - started;
  } finally {
    await legacy.core.close();
  }
  const selected = await open();
  try {
    const started = performance.now();
    const document = await selected.core.getDocument(firstReaderDocument);
    if (!document.ok) throw new Error(document.error.message);
    reader['selectedDocumentFirstMs'] = performance.now() - started;
    const navigation = await selected.core.listNavigationDocuments?.();
    if (navigation && !navigation.ok) throw new Error(navigation.error.message);
    reader['documentPlusCompactNavigationMs'] = performance.now() - started;
  } finally {
    await selected.core.close();
  }
}
for (const input of inputs)
  if ((await checksum(input.path)) !== input.sha256)
    throw new Error('Measurement changed an input corpus.');
const report = {
  schemaVersion: 1,
  label: option('label') ?? 'current',
  createdAt: new Date().toISOString(),
  environment:
    'Bun SQLite with production MedicalCore/CapacitorMedicalStore; no Android bridge, DOM, or physical-device timing',
  coldDefinition:
    'first query in this process; OS file cache is not cleared; later cases can reuse vocabulary/index caches',
  inputs,
  documentCount,
  rounds,
  queries: measurements.map((row) => ({
    ...row,
    warmP50Ms: percentile(row.warmMs, 0.5),
    warmP95Ms: percentile(row.warmMs, 0.95),
  })),
  reader,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      report: reportPath,
      documentCount,
      queries: report.queries.map(({ caseId, coldMs, warmP50Ms, warmP95Ms }) => ({
        caseId,
        coldMs,
        warmP50Ms,
        warmP95Ms,
      })),
      reader,
    },
    null,
    2,
  ),
);
