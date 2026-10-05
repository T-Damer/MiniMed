/**
 * Measures drug search by indication («таблетки от головы») and checks that drug-name lookup does
 * not regress when the medications scope adds e5 candidates (STATE E3). Mounts core.db, the
 * e5-embedded ГРЛС instruction + Allmed modules and the ЕСКЛП modules, as «Скачать препараты»
 * installs them, and searches through the app's own `ScopedMedicalCore('medications')`.
 *
 *   bun tools/benchmarks/src/run-semantic-drugs.ts --drug-packs=data/build/drug-e5/decoded \
 *     --esklp-packs=<decoded ЕСКЛП modules> --model-dir=<dir holding Xenova/multilingual-e5-small/…>
 *
 * Indication relevance (`drug-indication-queries.json`): a group counts when its document's INN
 * (ГРЛС `inn`, Allmed `ingredientNames`, ЕСКЛП МНН id) contains an acceptable INN stem. Name
 * lookup: 100 trade names sampled evenly from the ГРЛС modules; the first group must carry that
 * trade name. Store calls are memoised, so the configurations differ only in fusion and ranking.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { createMedicalCore } from '@localmed/core';
import { E5_SMALL_FUSION, E5_SMALL_PROFILE, NeuralQueryEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';
import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing --${name}=…`);
  return value;
}

const ROOT = resolve(import.meta.dirname, '../../..');
const packs = [argument('drug-packs'), argument('esklp-packs')].flatMap((directory) =>
  readdirSync(resolve(directory))
    .filter((name) => name.endsWith('.db'))
    .sort()
    .map((name) => resolve(directory, name)),
);

env.allowRemoteModels = false;
env.localModelPath = `${resolve(argument('model-dir'))}/`;
const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
  dtype: 'q8',
});
const embeddings = new Map<string, Promise<Float32Array>>();
const encode = (text: string): Promise<Float32Array> => {
  const cached =
    embeddings.get(text) ??
    extractor(text, { pooling: 'mean', normalize: true }).then(
      (output) => output.data as Float32Array,
    );
  embeddings.set(text, cached);
  return cached;
};

const store = new MultiMedicalStore([
  {
    moduleId: 'core',
    store: await createBunFileMedicalStore(resolve(ROOT, 'apps/app/public/content/core.db')),
    required: true,
    searchWeight: 1,
  },
  ...(await Promise.all(
    packs.map(async (path) => ({
      moduleId: basename(path, '.db'),
      store: await createBunFileMedicalStore(path),
      required: true,
      searchWeight: 1,
    })),
  )),
]);
const memo = new Map<string, Promise<unknown>>();
for (const method of ['search', 'searchVector'] as const) {
  const original = store[method].bind(store) as (request: unknown) => Promise<unknown>;
  Object.assign(store, {
    [method]: (request: unknown) => {
      const key = `${method}:${JSON.stringify(request)}`;
      const cached = memo.get(key) ?? original(request);
      memo.set(key, cached);
      return cached;
    },
  });
}
const core = createMedicalCore({
  store,
  platform: 'test',
  embedder: new NeuralQueryEmbedder(E5_SMALL_PROFILE, encode, E5_SMALL_FUSION),
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);
const medications = new ScopedMedicalCore(core, 'medications');

const normalize = (value: string) =>
  value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[®™]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
const identityText = new Map<string, string>();
async function documentText(documentId: string): Promise<string> {
  const cached = identityText.get(documentId);
  if (cached !== undefined) return cached;
  const document = await store.getDocument(documentId);
  const metadata = document?.metadata ?? {};
  const names = [
    documentId,
    document?.title ?? '',
    String(metadata['inn'] ?? ''),
    String(metadata['tradeName'] ?? ''),
    String(metadata['linkedMnnDocumentId'] ?? ''),
    ...(Array.isArray(metadata['ingredientNames']) ? metadata['ingredientNames'].map(String) : []),
  ];
  const text = normalize(names.join(' '));
  identityText.set(documentId, text);
  return text;
}

type Mode = 'lexical' | 'hybrid' | 'semantic';
const MODES: readonly Mode[] = ['lexical', 'hybrid', 'semantic'];
async function search(query: string, mode: Mode) {
  const result = await medications.search({
    query,
    mode,
    analysisMode: 'lookup',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

interface IndicationQuery {
  readonly id: string;
  readonly query: string;
  readonly inn: readonly string[];
}
const indicationQueries = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../drug-indication-queries.json'), 'utf8'),
  ) as { queries: IndicationQuery[] }
).queries;

const report: Record<string, Record<string, number>> = {};
const examples: Record<string, Record<Mode, string[]>> = {};
for (const mode of MODES) {
  let hit1 = 0;
  let hit5 = 0;
  let precision5 = 0;
  for (const item of indicationQueries) {
    const response = await search(item.query, mode);
    const top = response.groups.slice(0, 5);
    const relevant = await Promise.all(
      top.map(async (group) => {
        const text = await documentText(group.documentId);
        return item.inn.some((stem) => text.includes(normalize(stem)));
      }),
    );
    hit1 += Number(relevant[0] === true);
    hit5 += Number(relevant.some(Boolean));
    precision5 += relevant.filter(Boolean).length / 5;
    const perMode = examples[item.id] ?? { lexical: [], hybrid: [], semantic: [] };
    examples[item.id] = perMode;
    perMode[mode] = top.map(
      (group, index) => `${relevant[index] ? '+' : '-'}${group.title.slice(0, 40)}`,
    );
  }
  const n = indicationQueries.length;
  report[`indication ${mode}`] = {
    n,
    hitAt1: +(hit1 / n).toFixed(3),
    hitAt5: +(hit5 / n).toFixed(3),
    precisionAt5: +(precision5 / n).toFixed(3),
  };
}

// Name lookup: every tenth ГРЛС trade name in document-id order, at most 100.
const tradeNames: string[] = [];
for (const path of packs.filter((item) => basename(item).includes('.instructions.'))) {
  const database = new (
    (await import('bun:sqlite' as string)) as {
      Database: new (
        path: string,
        options: { readonly: boolean },
      ) => {
        query(sql: string): { all(): readonly { metadata_json: string }[] };
        close(): void;
      };
    }
  ).Database(path, { readonly: true });
  for (const row of database.query('SELECT metadata_json FROM documents ORDER BY id').all()) {
    const name = (JSON.parse(row.metadata_json) as { tradeName?: unknown }).tradeName;
    if (typeof name === 'string' && name.length > 2) tradeNames.push(name);
  }
  database.close();
}
const sampled = [...new Set(tradeNames.map(normalize))].filter((_, index) => index % 10 === 0);
const names = sampled.slice(0, 100);
for (const mode of ['lexical', 'hybrid'] as const) {
  let top1 = 0;
  const misses: string[] = [];
  for (const name of names) {
    const response = await search(name, mode);
    const first = response.groups[0];
    const ok = first ? (await documentText(first.documentId)).includes(name) : false;
    top1 += Number(ok);
    if (!ok) misses.push(`${name} → ${first?.title.slice(0, 40) ?? '—'}`);
  }
  report[`name ${mode}`] = { n: names.length, top1: +(top1 / names.length).toFixed(3) };
  if (mode === 'hybrid') report['name hybrid misses'] = { count: misses.length };
  console.log(`[${mode}] name misses: ${misses.slice(0, 12).join(' | ')}`);
}

for (const [name, values] of Object.entries(report)) console.log(name.padEnd(22), values);
const out = process.argv.find((item) => item.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, `${JSON.stringify({ report, examples }, null, 2)}\n`);
await core.close();
