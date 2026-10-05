/**
 * Measures e5-small semantic search on clinical recommendations through the application's own
 * MedicalCore (STATE E2). Mounts the e5-embedded КР packs, embeds queries with the same pinned ONNX
 * model the app downloads (transformers.js, onnxruntime-node here) and scores the Q1 real-language
 * queries (`retrieval-icd-queries.json`, КР relevance only) per search configuration.
 *
 *   bun tools/benchmarks/src/run-semantic-kr.ts --packs=data/build/clinical-e5/decoded \
 *     --model-dir=<dir holding Xenova/multilingual-e5-small/…> [--split=dev] [--out=report.json]
 *
 * `--model-dir` is a local copy of the pinned files listed in
 * `apps/app/src/features/semantic/e5-model.ts`; nothing is fetched from the network.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import type { SearchRequest } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import {
  E5_SMALL_FUSION,
  E5_SMALL_PROFILE,
  LEGACY_SEMANTIC_FUSION,
  NeuralQueryEmbedder,
  type SemanticFusion,
} from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

function argument(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}=…`);
}

interface IcdQuery {
  readonly id: string;
  readonly query: string;
  readonly source: string;
  readonly split: string;
  readonly relevant: readonly { documentId: string; grade: number; kind: string }[];
}

const packsDirectory = resolve(argument('packs'));
const split = argument('split', 'dev');
const packs = readdirSync(packsDirectory)
  .filter((name) => name.endsWith('.db'))
  .sort()
  .map((name) => resolve(packsDirectory, name));

env.allowRemoteModels = false;
env.localModelPath = `${resolve(argument('model-dir'))}/`;
const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
  dtype: 'q8',
});
const embeddings = new Map<string, Promise<Float32Array>>();
const encode = (text: string): Promise<Float32Array> => {
  const cached = embeddings.get(text);
  if (cached) return cached;
  const created = extractor(text, { pooling: 'mean', normalize: true }).then(
    (output) => output.data as Float32Array,
  );
  embeddings.set(text, created);
  return created;
};

// Every configuration asks the same store questions; answer each once so variants differ only in
// fusion and ranking (timings below are therefore warm-cache and only meaningful per first config).
const store = new MultiMedicalStore(
  await Promise.all(
    packs.map(async (path) => ({
      moduleId: basename(path, '.db'),
      store: await createBunFileMedicalStore(path),
      required: true,
      searchWeight: 1,
    })),
  ),
);
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

const FUSIONS: Record<string, SemanticFusion> = {
  legacy: LEGACY_SEMANTIC_FUSION,
  e5: E5_SMALL_FUSION,
};
const cores = new Map<string, ReturnType<typeof createMedicalCore>>();
for (const [name, fusion] of Object.entries(FUSIONS)) {
  const core = createMedicalCore({
    store,
    platform: 'test',
    embedder: new NeuralQueryEmbedder(E5_SMALL_PROFILE, encode, fusion),
  });
  const initialized = await core.initialize();
  if (!initialized.ok) throw new Error(initialized.error.message);
  cores.set(name, core);
}
const legacyCore = cores.get('legacy');
if (!legacyCore) throw new Error('Missing legacy core');

const benchmark = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../retrieval-icd-queries.json'), 'utf8'),
) as { queries: IcdQuery[] };
const queries = benchmark.queries
  .filter((query) => split === 'all' || query.split === split)
  .map((query) => ({
    ...query,
    kr: new Map(
      query.relevant
        .filter((item) => item.kind === 'clinical-recommendation')
        .map((item) => [item.documentId, item.grade]),
    ),
  }))
  .filter((query) => query.kr.size > 0);

type Config = Pick<SearchRequest, 'mode' | 'analysisMode'> & { readonly fusion: string };
const CONFIGS: Record<string, Config> = {
  'lookup lexical': { mode: 'lexical', analysisMode: 'lookup', fusion: 'legacy' },
  'clinical lexical': { mode: 'lexical', analysisMode: 'clinical', fusion: 'legacy' },
  'lookup semantic': { mode: 'semantic', analysisMode: 'lookup', fusion: 'legacy' },
  ...Object.fromEntries(
    Object.keys(FUSIONS).flatMap((fusion) => [
      [`lookup hybrid ${fusion}`, { mode: 'hybrid', analysisMode: 'lookup', fusion }],
      [`clinical hybrid ${fusion}`, { mode: 'hybrid', analysisMode: 'clinical', fusion }],
    ]),
  ),
};

interface Score {
  at1: number;
  at5: number;
  strictAt5: number;
  mrr10: number;
  ms: number;
}
const scores = new Map<string, Map<string, Score[]>>();
const record = (config: string, slice: string, score: Score) => {
  const bySlice = scores.get(config) ?? new Map<string, Score[]>();
  bySlice.set(slice, [...(bySlice.get(slice) ?? []), score]);
  scores.set(config, bySlice);
};

for (const [index, query] of queries.entries()) {
  for (const [config, { fusion, ...options }] of Object.entries(CONFIGS)) {
    const started = performance.now();
    const result = await (cores.get(fusion) ?? legacyCore).search({
      query: query.query,
      ...options,
      filters: {},
      limit: 20,
      includeSuggestions: false,
    });
    const ms = performance.now() - started;
    if (!result.ok) throw new Error(`${query.id}: ${result.error.message}`);
    const ranked = result.value.groups.map((group) => group.documentId);
    const first = ranked.slice(0, 10).findIndex((id) => query.kr.has(id));
    const score: Score = {
      at1: Number(first === 0),
      at5: Number(first >= 0 && first < 5),
      strictAt5: Number(ranked.slice(0, 5).some((id) => query.kr.get(id) === 3)),
      mrr10: first < 0 ? 0 : 1 / (first + 1),
      ms,
    };
    record(config, 'all', score);
    record(config, `source:${query.source}`, score);
  }
  if (index % 5 === 0) console.error(`[semantic-kr] ${index + 1}/${queries.length}`);
}

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const percentile = (values: readonly number[], p: number) =>
  values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
const report = Object.fromEntries(
  [...scores].map(([config, bySlice]) => [
    config,
    Object.fromEntries(
      [...bySlice].map(([slice, rows]) => [
        slice,
        {
          n: rows.length,
          at1: +mean(rows.map((row) => row.at1)).toFixed(3),
          at5: +mean(rows.map((row) => row.at5)).toFixed(3),
          strictAt5: +mean(rows.map((row) => row.strictAt5)).toFixed(3),
          mrr10: +mean(rows.map((row) => row.mrr10)).toFixed(3),
          p50ms: Math.round(
            percentile(
              rows.map((row) => row.ms),
              0.5,
            ),
          ),
        },
      ]),
    ),
  ]),
);
for (const [config, bySlice] of Object.entries(report)) {
  console.log(
    `${config.padEnd(17)} ${Object.entries(bySlice)
      .map(
        ([slice, v]) =>
          `${slice}: @1 ${v.at1} @5 ${v.at5} strict@5 ${v.strictAt5} mrr ${v.mrr10} p50 ${v.p50ms}ms (n${v.n})`,
      )
      .join(' | ')}`,
  );
}
const out = process.argv.find((item) => item.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, `${JSON.stringify({ split, packs: packs.length, report }, null, 2)}\n`);
await legacyCore.close();
