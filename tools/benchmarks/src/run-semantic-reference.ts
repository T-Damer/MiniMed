/**
 * Measures description → term and symptoms → disease search in the «Болезни» scope with e5 vectors
 * on the МКБ cards and disease articles (STATE E5). Mounts core.db and the e5-embedded reference
 * modules and searches through the app's own `ScopedMedicalCore('conditions')`.
 *
 *   bun tools/benchmarks/src/run-semantic-reference.ts --packs=data/build/ref-e5/decoded \
 *     --model-dir=<dir holding Xenova/multilingual-e5-small/…> [--out=report.json]
 *
 * Sets: `reverse-term-queries.json` (a top group's title contains a stem) and the Q1 queries with
 * МКБ-card relevance from `retrieval-icd-queries.json` (any graded card in the top 5). Name lookup:
 * 100 МКБ card names sampled evenly; the first group must be that card. Store calls are memoised.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import type { SearchRequest } from '@localmed/contracts';
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
const packs = readdirSync(resolve(argument('packs')))
  .filter((name) => name.endsWith('.db'))
  .sort()
  .map((name) => resolve(argument('packs'), name));

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
const conditions = new ScopedMedicalCore(core, 'conditions');

const normalize = (value: string) => value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
type Mode = SearchRequest['mode'];
const MODES: readonly Mode[] = ['lexical', 'hybrid', 'semantic'];
async function search(query: string, mode: Mode) {
  const result = await conditions.search({
    query,
    mode,
    analysisMode: 'lookup',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.groups;
}

const reverse = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../reverse-term-queries.json'), 'utf8'),
  ) as { queries: { id: string; query: string; titleStems: string[] }[] }
).queries;
const q1 = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../retrieval-icd-queries.json'), 'utf8'),
  ) as {
    queries: {
      id: string;
      query: string;
      source: string;
      relevant: { documentId: string; kind: string }[];
    }[];
  }
).queries
  .map((query) => ({
    ...query,
    cards: new Set(
      query.relevant.filter((item) => item.kind === 'mkb-card').map((item) => item.documentId),
    ),
  }))
  .filter((query) => query.cards.size > 0);

const report: Record<string, Record<string, number>> = {};
const examples: Record<string, Partial<Record<Mode, string[]>>> = {};
for (const mode of MODES) {
  let hit1 = 0;
  let hit5 = 0;
  for (const item of reverse) {
    const top = (await search(item.query, mode)).slice(0, 5);
    const relevant = top.map((group) =>
      item.titleStems.some((stem) => normalize(group.title).includes(normalize(stem))),
    );
    hit1 += Number(relevant[0] === true);
    hit5 += Number(relevant.some(Boolean));
    const perMode = examples[item.id] ?? {};
    examples[item.id] = perMode;
    perMode[mode] = top.map(
      (group, index) => `${relevant[index] ? '+' : '-'}${group.title.slice(0, 40)}`,
    );
  }
  report[`reverse ${mode}`] = {
    n: reverse.length,
    hitAt1: +(hit1 / reverse.length).toFixed(3),
    hitAt5: +(hit5 / reverse.length).toFixed(3),
  };

  const bySource = new Map<string, { at1: number; at5: number; n: number }>();
  for (const item of q1) {
    const top = (await search(item.query, mode)).slice(0, 5);
    const ranks = top.map((group) => item.cards.has(group.documentId));
    for (const key of ['all', item.source]) {
      const entry = bySource.get(key) ?? { at1: 0, at5: 0, n: 0 };
      entry.at1 += Number(ranks[0] === true);
      entry.at5 += Number(ranks.some(Boolean));
      entry.n += 1;
      bySource.set(key, entry);
    }
  }
  for (const [key, value] of bySource) {
    report[`q1-mkb ${key} ${mode}`] = {
      n: value.n,
      at1: +(value.at1 / value.n).toFixed(3),
      at5: +(value.at5 / value.n).toFixed(3),
    };
  }
}

// Name lookup: every 100th МКБ card name (the «Наименование» of its code row).
const names: { id: string; name: string }[] = [];
for (const path of packs.filter((item) => basename(item).includes('rls-mkb'))) {
  const database = new (
    (await import('bun:sqlite' as string)) as {
      Database: new (
        path: string,
        options: { readonly: boolean },
      ) => {
        query(sql: string): { all(): readonly { id: string; title: string }[] };
        close(): void;
      };
    }
  ).Database(path, { readonly: true });
  for (const row of database.query('SELECT id, title FROM documents ORDER BY id').all()) {
    const name = row.title.replace(/^[A-Z]\d{2}(?:\.\d+)?\s+/u, '').replace(/, МКБ-10$/u, '');
    if (name.length > 3) names.push({ id: row.id, name });
  }
  database.close();
}
const sampled = names.filter((_, index) => index % 100 === 0).slice(0, 100);
for (const mode of ['lexical', 'hybrid'] as const) {
  let top1 = 0;
  for (const item of sampled) {
    const first = (await search(item.name, mode))[0];
    top1 += Number(first?.documentId === item.id);
  }
  report[`name ${mode}`] = { n: sampled.length, top1: +(top1 / sampled.length).toFixed(3) };
}

for (const [name, values] of Object.entries(report)) console.log(name.padEnd(26), values);
const out = process.argv.find((item) => item.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, `${JSON.stringify({ report, examples }, null, 2)}\n`);
await core.close();
