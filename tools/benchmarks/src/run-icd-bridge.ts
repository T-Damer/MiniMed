/**
 * Roadmap item 4 (S3): diagnosis → МКБ card → clinical recommendations that list its code.
 * Scores the Q1 real-language queries (`retrieval-icd-queries.json`) through the app's own
 * `ScopedMedicalCore('diagnosis')` (clinical analysis, lexical) over the released corpus.
 *
 *   bun tools/benchmarks/src/run-icd-bridge.ts [--split=test|dev|all] [--packs=<КР module dir>]
 *     [--no-companions] [--bridge=on|off|both]
 *
 * `--packs` mounts every `.db` module of that directory (the 774 КР modules) on top of core.db, as a
 * user who installed all recommendations has them; without it recommendations are core pointers.
 * Relevance: КР documents (`kr.rf.*`, a pointer counts as its target) and МКБ cards of the query's
 * gold codes. Per query R@1/R@5 = a relevant document among the first 1/5 groups.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { env, pipeline } from '@huggingface/transformers';
import type { MedicalCore, SearchResultGroup } from '@localmed/contracts';
import { E5_SMALL_FUSION, E5_SMALL_PROFILE, NeuralQueryEmbedder } from '@localmed/search-semantic';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

const argument = (name: string, fallback: string): string =>
  process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

interface IcdQuery {
  readonly id: string;
  readonly query: string;
  readonly source: string;
  readonly split: string;
  readonly goldCodes: readonly string[];
  readonly relevant: readonly { documentId: string; grade: number; kind: string }[];
}

const split = argument('split', 'test');
const modelDirectory = argument('e5-model-dir', '');
const scope = argument('scope', 'diagnosis') as 'diagnosis' | 'guidelines';
let embedder: NeuralQueryEmbedder | undefined;
if (modelDirectory) {
  env.allowRemoteModels = false;
  env.localModelPath = `${resolve(modelDirectory)}/`;
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    dtype: 'q8',
  });
  embedder = new NeuralQueryEmbedder(
    E5_SMALL_PROFILE,
    async (text) =>
      (await extractor(text, { pooling: 'mean', normalize: true })).data as Float32Array,
    E5_SMALL_FUSION,
  );
}
const packsDirectory = argument('packs', '');
const bridgeArg = argument('bridge', 'both');
const installedModules = packsDirectory
  ? readdirSync(resolve(packsDirectory))
      .filter((name) => name.endsWith('.db'))
      .sort()
      .map((name) => ({
        moduleId: name.replace(/\.db$/u, ''),
        path: resolve(packsDirectory, name),
      }))
  : [];

const benchmark = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../retrieval-icd-queries.json'), 'utf8'),
) as { queries: IcdQuery[] };
const queries = benchmark.queries.filter((query) => split === 'all' || query.split === split);

const tunings = JSON.parse(argument('tunings', '[{}]')) as Record<string, unknown>[];
const configs: { label: string; option: boolean | Record<string, unknown> }[] =
  bridgeArg === 'off'
    ? [{ label: 'off', option: false }]
    : [
        ...(bridgeArg === 'both'
          ? [{ label: 'off', option: false as boolean | Record<string, unknown> }]
          : []),
        ...tunings.map((tuning) => ({ label: `on ${JSON.stringify(tuning)}`, option: tuning })),
      ];
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const percentile = (values: readonly number[], p: number) =>
  values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;

for (const { label: bridge, option } of configs) {
  const { core, target } = await openRealCorpus({
    companions: !process.argv.includes('--no-companions'),
    installedModules,
    ...(embedder ? { embedder } : {}),
    coreOptions: { icdBridge: option as never },
  });
  const scoped = new ScopedMedicalCore(core as MedicalCore, scope);
  const rows = new Map<
    string,
    { kr1: number[]; kr5: number[]; krMrr: number[]; card5: number[]; ms: number[] }
  >();
  const bucket = (key: string) => {
    let row = rows.get(key);
    if (!row) {
      row = { kr1: [], kr5: [], krMrr: [], card5: [], ms: [] };
      rows.set(key, row);
    }
    return row;
  };
  for (const query of queries) {
    const krRelevant = new Set(
      query.relevant
        .filter((item) => item.kind === 'clinical-recommendation')
        .map((item) => item.documentId),
    );
    const cardRelevant = new Set(
      query.relevant.filter((item) => item.kind === 'mkb-card').map((item) => item.documentId),
    );
    const started = performance.now();
    const response = await scoped.search({
      query: query.query,
      mode: embedder ? 'auto' : 'lexical',
      analysisMode: scope === 'diagnosis' ? 'clinical' : 'lookup',
      filters: {},
      limit: 20,
      includeSuggestions: false,
    });
    const ms = performance.now() - started;
    if (!response.ok) throw new Error(`${query.id}: ${response.error.message}`);
    const groups = response.value.groups as readonly SearchResultGroup[];
    const ids = groups.map((group) => target(group.documentId));
    const firstKr = ids.slice(0, 10).findIndex((id) => krRelevant.has(id));
    const keys = ['all', `source:${query.source}`];
    for (const key of keys) {
      const row = bucket(key);
      if (krRelevant.size > 0) {
        row.kr1.push(Number(firstKr === 0));
        row.kr5.push(Number(firstKr >= 0 && firstKr < 5));
        row.krMrr.push(firstKr < 0 ? 0 : 1 / (firstKr + 1));
      }
      row.card5.push(Number(ids.slice(0, 5).some((id) => cardRelevant.has(id))));
      row.ms.push(ms);
    }
  }
  console.log(
    `\n== bridge ${bridge}, split ${split}, scope ${scope}, ${embedder ? 'e5 auto' : 'lexical'}, packs ${installedModules.length}, n=${queries.length} ==`,
  );
  for (const [key, row] of rows)
    console.log(
      `${key.padEnd(18)} KR@1 ${mean(row.kr1).toFixed(3)} KR@5 ${mean(row.kr5).toFixed(3)} KRmrr ${mean(row.krMrr).toFixed(3)} (nKR ${row.kr5.length}) card@5 ${mean(row.card5).toFixed(3)}  p50 ${Math.round(percentile(row.ms, 0.5))}ms p95 ${Math.round(percentile(row.ms, 0.95))}ms`,
    );
  await core.close();
}
