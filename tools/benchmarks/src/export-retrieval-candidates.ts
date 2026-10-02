/**
 * Exports the application's own lexical candidates (MedicalCore over installed packs) for the
 * offline embedding comparison in `embedding_eval.py` (docs/research/embeddings-kr-2026-10-02.md).
 * `--queries` is a JSONL file of query rows (`query_id`, `query`, required/acceptable/forbidden
 * entities, …); the 2026-10-02 run used the readable dev/validation rows of the retired synthetic
 * hard set plus the curated clinician queries. Next runs should use physician-written queries.
 *
 *   bun tools/benchmarks/src/export-retrieval-candidates.ts --queries=<scratch>/queries.jsonl \
 *     --packs=data/build/release-clinical --out=<scratch>/lexical-candidates.jsonl
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createMedicalCore } from '@localmed/core';
import { MultiMedicalStore } from '@localmed/storage';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

const GROUP_LIMIT = 50;

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing --${name}=…`);
  return value;
}

const packsDirectory = resolve(argument('packs'));
const outputPath = resolve(argument('out'));
const packs = readdirSync(packsDirectory)
  .filter((name) => name.endsWith('.db'))
  .sort()
  .map((name) => resolve(packsDirectory, name));
if (packs.length === 0) throw new Error(`No .db packs in ${packsDirectory}`);

const core = createMedicalCore({
  store: new MultiMedicalStore(
    await Promise.all(
      packs.map(async (path) => ({
        moduleId: basename(path, '.db'),
        store: await createBunFileMedicalStore(path),
        required: true,
        searchWeight: 1,
      })),
    ),
  ),
  platform: 'test',
});
const initialized = await core.initialize();
if (!initialized.ok) throw new Error(initialized.error.message);

interface QueryRow {
  readonly query_id: string;
  readonly query: string;
}

const queries: readonly QueryRow[] = readFileSync(resolve(argument('queries')), 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => {
    const row = JSON.parse(line) as Partial<QueryRow>;
    if (typeof row.query_id !== 'string' || typeof row.query !== 'string') {
      throw new Error(`Query row without query_id/query: ${line.slice(0, 80)}`);
    }
    return { query_id: row.query_id, query: row.query };
  });

// Appends one line per query and skips ids already in the file, so a stopped run resumes.
const done = new Set(
  existsSync(outputPath)
    ? readFileSync(outputPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => (JSON.parse(line) as { queryId: string }).queryId)
    : [],
);
const startedAll = performance.now();
for (const [index, query] of queries.entries()) {
  if (done.has(query.query_id)) continue;
  const started = performance.now();
  const result = await core.search({
    query: query.query,
    mode: 'auto',
    filters: {},
    limit: GROUP_LIMIT,
    includeSuggestions: false,
  });
  const elapsedMs = performance.now() - started;
  if (!result.ok) throw new Error(`${query.query_id}: ${result.error.message}`);
  appendFileSync(
    outputPath,
    `${JSON.stringify({
      queryId: query.query_id,
      elapsedMs,
      groups: result.value.groups.map((group) => ({
        documentId: group.documentId,
        title: group.title,
        chunkIds: group.results.map((hit) => hit.chunkId),
      })),
    })}\n`,
  );
  if (index % 10 === 0) {
    const minutes = ((performance.now() - startedAll) / 60000).toFixed(1);
    console.log(
      `[candidates] ${index + 1}/${queries.length} · ${elapsedMs.toFixed(0)} ms · ${minutes} min`,
    );
  }
}
console.log(`[candidates] ${queries.length} queries over ${packs.length} packs → ${outputPath}`);
await core.close();
