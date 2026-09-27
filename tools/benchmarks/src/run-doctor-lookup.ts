// Doctor phrasing on the real corpus, through the exact lookup path of the app: the released
// core.db plus every companion pack present in apps/app/public/content, mounted with the app's
// search weights, the «Все источники» scope and lexical lookup. No pilot or demo corpus.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { MultiMedicalStore } from '@localmed/storage';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

interface DoctorLookupCase {
  readonly id: string;
  readonly query: string;
  /** Any of these targets in the top five counts as found. */
  readonly expectedTargets: readonly string[];
  /** None of these may appear in the top five. */
  readonly forbiddenTargets: readonly string[];
}

const root = resolve(import.meta.dirname, '../../..');
const content = resolve(root, 'apps/app/public/content');
const reportPath = resolve(root, 'data/build/doctor-lookup-report.json');
// Mirrors builtInCompanionMounts in apps/app/src/composition/create-browser-core.ts.
const COMPANIONS = [
  ['mkb.db', 1.05],
  ['medications.db', 1.15],
  ['ambulatory.db', 1.05],
  ['regulatory.db', 1.12],
  ['reference.db', 1.08],
] as const;

const cases = JSON.parse(
  readFileSync(resolve(root, 'tools/benchmarks/doctor-lookup-queries.json'), 'utf8'),
) as readonly DoctorLookupCase[];
if (new Set(cases.map((item) => item.id)).size !== cases.length)
  throw new Error('Doctor lookup fixture contains duplicate ids.');

const corePath = resolve(content, 'core.db');
if (!existsSync(corePath)) throw new Error(`Missing ${corePath}; run content:restore:core.`);
const companions = COMPANIONS.filter(([file]) => existsSync(resolve(content, file)));
const store = new MultiMedicalStore([
  {
    moduleId: 'minimed.core.ru',
    store: await createBunFileMedicalStore(corePath),
    required: true,
    searchWeight: 1.1,
  },
  ...(await Promise.all(
    companions.map(async ([file, searchWeight]) => ({
      moduleId: file,
      store: await createBunFileMedicalStore(resolve(content, file)),
      required: true,
      searchWeight,
    })),
  )),
]);
const core = createMedicalCore({ store, platform: 'test' });
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);
const listed = await core.listDocuments();
if (!listed.ok) throw new Error(listed.error.message);
const documents = new Map(listed.value.map((document) => [document.id, document]));
/** A catalog pointer stands for the document it points to. */
const target = (id: string): string => {
  const pointed = documents.get(id)?.metadata?.['targetDocumentId'];
  return typeof pointed === 'string' ? pointed : id;
};

const scoped = new ScopedMedicalCore(core, 'all');
const rows = [];
for (const fixture of cases) {
  const response = await scoped.search({
    query: fixture.query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(`${fixture.id}: ${response.error.message}`);
  const top = response.value.groups.slice(0, 5).map((group) => target(group.documentId));
  const rankIndex = top.findIndex((id) => fixture.expectedTargets.includes(id));
  const forbidden = top.filter((id) => fixture.forbiddenTargets.includes(id));
  rows.push({
    id: fixture.id,
    query: fixture.query,
    hitAt5: rankIndex >= 0,
    reciprocalRank: rankIndex >= 0 ? 1 / (rankIndex + 1) : 0,
    forbidden,
    top,
  });
}
await core.close();

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const summary = {
  corpus: ['core.db', ...companions.map(([file]) => file)],
  queryCount: rows.length,
  recallAt5: mean(rows.map((row) => Number(row.hitAt5))),
  mrrAt5: mean(rows.map((row) => row.reciprocalRank)),
  forbiddenFreeRate: mean(rows.map((row) => Number(row.forbidden.length === 0))),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify({ summary, rows }, null, 2));
