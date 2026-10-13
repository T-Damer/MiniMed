/**
 * Roadmap items 5/14: description lookups in «Все» also get the recommendations the semantic model
 * finds (`descriptionRecommendations`). Runs the owner's queries and the name/typo controls through
 * the app's `ScopedMedicalCore('all')` over the released corpus plus the КР modules with KD1
 * vectors, with the feature off and on, and prints hit@1 / hit@5, forbidden hits and every control
 * whose first ten groups changed.
 *
 *   bun tools/benchmarks/src/run-description-recommendations.ts --packs=<decoded КР modules> \
 *     --model-dir=<dir holding minimed/kd1-query-encoder/…>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { KD1_FUSION, KD1_PROFILE, NeuralQueryEmbedder } from '@localmed/search-semantic';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { E5_MODEL_ID } from '../../../apps/app/src/features/semantic/e5-model';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing --${name}=…`);
  return value;
}
const packsDirectory = resolve(argument('packs'));
env.allowRemoteModels = false;
env.localModelPath = `${resolve(argument('model-dir'))}/`;
const extractor = await pipeline('feature-extraction', E5_MODEL_ID, { dtype: 'q8' });
const encode = async (text: string) =>
  (await extractor(text, { pooling: 'mean', normalize: true })).data as Float32Array;

interface OwnerQuery {
  readonly id: string;
  readonly style: string;
  readonly query: string;
  readonly expectedTargets: readonly string[];
  readonly forbiddenTargets: readonly string[];
}
const owner = (
  JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/owner-queries.json'), 'utf8'),
  ) as { queries: OwnerQuery[] }
).queries;
const typo = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'tools/benchmarks/typo-queries.json'), 'utf8'),
) as { controls: { id: string; query: string }[] };

const installedModules = readdirSync(packsDirectory)
  .filter((name) => name.endsWith('.db'))
  .map((name) => ({ moduleId: basename(name, '.db'), path: resolve(packsDirectory, name) }));

async function run(on: boolean) {
  const { core, target } = await openRealCorpus({
    installedModules,
    embedder: new NeuralQueryEmbedder(KD1_PROFILE, encode, KD1_FUSION),
    coreOptions: { descriptionRecommendations: on },
  });
  const scoped = new ScopedMedicalCore(core, 'all');
  const search = async (query: string) => {
    const started = performance.now();
    const response = await scoped.search({
      query,
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(response.error.message);
    return {
      top: response.value.groups.map((group) => target(group.documentId)),
      ms: performance.now() - started,
      added: response.value.descriptionRecommendations?.status === 'added',
    };
  };
  const ownerRows = new Map<string, Awaited<ReturnType<typeof search>>>();
  for (const item of owner) ownerRows.set(item.id, await search(item.query));
  const controls = new Map<string, string>();
  for (const item of typo.controls) controls.set(item.id, (await search(item.query)).top.join('|'));
  await core.close();
  return { ownerRows, controls };
}

const off = await run(false);
const on = await run(true);
for (const style of ['rush', 'thoughtful', 'all']) {
  const items = owner.filter((item) => style === 'all' || item.style === style);
  const cell = (rows: typeof off.ownerRows) => {
    const rank = (item: OwnerQuery) =>
      (rows.get(item.id)?.top ?? [])
        .slice(0, 5)
        .findIndex((id) => item.expectedTargets.includes(id));
    const at1 = items.filter((item) => rank(item) === 0).length / items.length;
    const at5 = items.filter((item) => rank(item) >= 0).length / items.length;
    const forbidden = items.filter((item) =>
      (rows.get(item.id)?.top ?? []).slice(0, 5).some((id) => item.forbiddenTargets.includes(id)),
    ).length;
    return `@1 ${at1.toFixed(3)} @5 ${at5.toFixed(3)} forbidden ${forbidden}`;
  };
  console.log(
    `${style.padEnd(11)} n=${items.length}  off ${cell(off.ownerRows)}  on ${cell(on.ownerRows)}`,
  );
}
for (const item of owner) {
  const before = off.ownerRows.get(item.id);
  const after = on.ownerRows.get(item.id);
  if (!after?.added) continue;
  const hit = (top: readonly string[] | undefined) =>
    (top ?? []).slice(0, 5).findIndex((id) => item.expectedTargets.includes(id));
  console.log(
    `  ${item.style} «${item.query.slice(0, 60)}» rank ${hit(before?.top)} -> ${hit(after.top)} (+${Math.round(after.ms - (before?.ms ?? 0))} ms)`,
  );
}
let changed = 0;
for (const [id, top] of off.controls)
  if (on.controls.get(id) !== top) {
    changed += 1;
    console.log(`control changed: ${id}`);
  }
console.log(`controls ${off.controls.size}: changed ${changed}`);
