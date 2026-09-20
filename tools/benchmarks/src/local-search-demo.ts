/** Local terminal demo over the real MedicalCore. No listener or hosted inference. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { createMedicalCore } from '@localmed/core';
import { normalizeSurfaceText, searchSubjectText } from '@localmed/search-lexical';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

import { type LocalCandidate, validateLocalRankingResponse } from './local-reranker-contract';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string) =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
for (const arg of args) {
  if (arg !== '--experimental-apply' && !/^--(?:core|pack|python|model-dir|mode)=.+$/u.test(arg)) {
    throw new Error('Unknown option. Queries are read from stdin, not command-line arguments.');
  }
}
const mode = option('mode') ?? 'clinical';
if (mode !== 'clinical' && mode !== 'lookup') throw new Error('Expected clinical or lookup mode.');
const allowApply = mode === 'clinical' && args.includes('--experimental-apply');
const python = resolve(root, option('python') ?? '.venv-cross/bin/python');
const modelDir = resolve(root, option('model-dir') ?? '.cache/minimed/ru-reranker');
const childArgs = [
  resolve(root, 'tools/benchmarks/local_reranker.py'),
  'serve',
  '--model-dir',
  modelDir,
];
if (allowApply) childArgs.push('--experimental-apply');
const child = spawn(python, childArgs, {
  cwd: root,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    LANG: 'C.UTF-8',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    PYTHONNOUSERSITE: '1',
  },
  stdio: ['pipe', 'pipe', 'ignore'],
});
const output = createInterface({ input: child.stdout });
let alive = true;
let pending: { resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
const unavailable = () => {
  alive = false;
  pending?.reject(new Error('Local model process unavailable.'));
  pending = undefined;
};
child.on('error', unavailable);
child.on('exit', unavailable);
child.stdin.on('error', unavailable);
output.on('line', (line) => {
  const current = pending;
  pending = undefined;
  if (!current) return;
  try {
    current.resolve(JSON.parse(line));
  } catch {
    current.reject(new Error('Invalid local model JSON.'));
  }
});
async function classify(query: string, candidates: readonly LocalCandidate[]) {
  if (!alive) throw new Error('Local model process unavailable.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await new Promise<unknown>((resolveResponse, reject) => {
      pending = { resolve: resolveResponse, reject };
      timer = setTimeout(() => {
        pending = undefined;
        child.kill();
        reject(new Error('Local model deadline exceeded.'));
      }, 30_000);
      child.stdin.write(`${JSON.stringify({ query, analysisMode: mode, candidates })}\n`);
    });
    return validateLocalRankingResponse(value, candidates, allowApply);
  } finally {
    clearTimeout(timer);
  }
}
const paths = [
  resolve(root, option('core') ?? 'data/build/definitions.db'),
  ...args.filter((arg) => arg.startsWith('--pack=')).map((arg) => resolve(root, arg.slice(7))),
];
const stores = await Promise.all(
  paths.map(async (path, index) => ({
    moduleId: `demo:${index}`,
    store: await SqliteMedicalStore.createFromBytes(new Uint8Array(readFileSync(path))),
    required: true,
    searchWeight: 1,
  })),
);
const store = new MultiMedicalStore(stores);
const core = createMedicalCore({ store, platform: 'test', embedder: new PortableHashEmbedder() });
try {
  const initialized = await core.initialize();
  if (!initialized.ok) throw new Error(initialized.error.message);
  const documents = new Map(
    (await store.listDocuments()).map((document) => [document.id, document]),
  );
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const query of input) {
    if (!query.trim()) continue;
    if (query.length > 2048) {
      console.log(JSON.stringify({ status: 'invalid-query', reason: 'length' }));
      continue;
    }
    const start = performance.now();
    const found = await core.search({
      query,
      mode: mode === 'clinical' ? 'hybrid' : 'lexical',
      analysisMode: mode,
      filters: {},
      limit: 40,
      includeSuggestions: false,
    });
    if (!found.ok) {
      console.log(JSON.stringify({ status: 'search-error', code: found.error.code }));
      continue;
    }
    const groups = found.value.groups.slice(0, 40);
    const subject = normalizeSurfaceText(searchSubjectText(query)).trim();
    const candidates = groups.map((group): LocalCandidate => {
      const document = documents.get(group.documentId);
      const rawAliases = document?.metadata.navigationAliases;
      const aliases = Array.isArray(rawAliases)
        ? rawAliases.filter((x): x is string => typeof x === 'string')
        : [];
      const names = [document?.title ?? group.title, document?.shortTitle ?? '', ...aliases];
      return {
        id: group.documentId,
        text: [group.title, ...group.results.slice(0, 3).map((hit) => hit.snippet)]
          .join('\n')
          .slice(0, 4000),
        strictIdentity: names.some(
          (name) => Boolean(name) && normalizeSurfaceText(name).trim() === subject,
        ),
      };
    });
    const baselineIds = groups.map((group) => group.documentId);
    let ranking;
    try {
      ranking = await classify(query, candidates);
    } catch {
      ranking = {
        status: 'fallback',
        applied: false,
        orderedIds: baselineIds,
        experimentalIds: baselineIds,
        inferenceMs: null,
      };
    }
    const byId = new Map(groups.map((group) => [group.documentId, group]));
    const display = (ids: readonly string[]) =>
      ids.slice(0, 5).map((id) => {
        const group = byId.get(id);
        return {
          documentId: id,
          title: group?.title,
          snippet: group?.results[0]?.snippet,
          anchor: group?.results[0]?.anchor,
        };
      });
    console.log(
      JSON.stringify({
        status: ranking.status,
        applied: ranking.applied,
        inferenceMs: ranking.inferenceMs,
        elapsedMs: performance.now() - start,
        baseline: display(baselineIds),
        experimental: display(ranking.experimentalIds),
        selected: display(ranking.orderedIds),
        warning: 'Research classifier; reference relevance is not a diagnosis probability.',
      }),
    );
  }
} finally {
  child.kill();
  output.close();
  await core.close();
}
