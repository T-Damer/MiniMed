// CMP1 measurements on the real corpus and the decoded instruction modules:
//   latency   a 4-drug comparison, stage by stage (document reads, extraction, matching, SAFE1 rows);
//   coverage  the 200 most common substances with every quoted row in the instruction read first;
//   sample    a seeded sample of marked statements for the hand check of the marks.
//
//   CMP1_DECODED_DIR=<dir of minimed.medications.instructions.*.db> bun src/run-cmp1-measure.ts \
//     [--latency] [--sample=<n> --seed=<n> --out=<file>] [--threshold-sweep]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  createComparisonIndex,
  parseComparisonIndex,
} from '../../../apps/app/src/features/drug-comparison/comparison-index';
import {
  jaccard,
  SIMILAR_THRESHOLD,
} from '../../../apps/app/src/features/drug-comparison/comparison-match';
import { safetyRowViews } from '../../../apps/app/src/features/drug-comparison/comparison-safety';
import { extractRows } from '../../../apps/app/src/features/drug-comparison/comparison-sections';
import {
  type CompareItem,
  chooseDocuments,
  columnViews,
  type DocumentState,
  quoteRowViews,
  sectionRowViews,
} from '../../../apps/app/src/features/drug-comparison/comparison-view';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
const decoded = process.env['CMP1_DECODED_DIR'];
if (!decoded) throw new Error('Set CMP1_DECODED_DIR to the decoded instruction modules.');
const modules = readdirSync(decoded)
  .filter((name) => name.endsWith('.db'))
  .toSorted()
  .map((name) => ({ moduleId: name.replace(/\.db$/u, ''), path: join(decoded, name) }));
const { core } = await openRealCorpus({ installedModules: modules });
const index = createComparisonIndex(
  parseComparisonIndex(
    JSON.parse(
      readFileSync(
        resolve(
          REPOSITORY_ROOT,
          'apps/app/src/features/drug-comparison/data/comparison-index.json',
        ),
        'utf8',
      ),
    ),
  ),
);
const report = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, 'data/build/drug-comparison/report.json'), 'utf8'),
) as { top200: { slugs: readonly string[] } };
const top200 = report.top200.slugs;

function itemOf(slug: string): CompareItem {
  const card = index.cardBySlug.get(slug);
  if (card === undefined) throw new Error(`No card ${slug}`);
  return { id: slug, card, label: slug, product: null };
}

async function load(items: readonly CompareItem[]) {
  const chosen = chooseDocuments(index, items, new Map());
  const documents = new Map<string, DocumentState>();
  for (const id of chosen.values()) {
    if (!id) continue;
    const result = await core.getDocument(id);
    documents.set(id, result.ok ? { document: result.value } : 'missing');
  }
  return { chosen, documents };
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

if (args.includes('--latency')) {
  const sets = [
    ['ибупрофен', 'парацетамол', 'диклофенак', 'кетопрофен'],
    ['амоксициллин', 'азитромицин', 'левофлоксацин', 'ципрофлоксацин'],
    ['метформин', 'омепразол', 'эналаприл', 'амлодипин'],
  ];
  const out: Record<string, unknown>[] = [];
  for (const set of sets) {
    const stages: Record<string, number[]> = {
      choose: [],
      read: [],
      extract: [],
      match: [],
      safety: [],
      total: [],
    };
    let units = 0;
    for (let run = 0; run < 5; run += 1) {
      const items = set.map(itemOf);
      const t0 = performance.now();
      const chosen = chooseDocuments(index, items, new Map());
      const t1 = performance.now();
      const documents = new Map<string, DocumentState>();
      for (const id of chosen.values()) {
        if (!id) continue;
        const result = await core.getDocument(id);
        documents.set(id, result.ok ? { document: result.value } : 'missing');
      }
      const t2 = performance.now();
      const columns = columnViews(index, items, chosen, documents);
      const read = new Map(
        columns.flatMap((column) => {
          const state = column.documentId ? documents.get(column.documentId) : undefined;
          return state && typeof state === 'object'
            ? [[column.position, state.document] as const]
            : [];
        }),
      );
      const extracted = new Map(
        [...read].map(([position, document]) => [position, extractRows(document)]),
      );
      const t3 = performance.now();
      const rows = sectionRowViews(
        columns,
        extracted,
        new Map(items.map((item, p) => [p, [item.id]])),
      );
      void quoteRowViews(columns, read);
      const t4 = performance.now();
      safetyRowViews(columns, read);
      const t5 = performance.now();
      units = rows.reduce(
        (total, row) => total + row.columns.reduce((sum, column) => sum + column.units, 0),
        0,
      );
      stages['choose']?.push(t1 - t0);
      stages['read']?.push(t2 - t1);
      stages['extract']?.push(t3 - t2);
      stages['match']?.push(t4 - t3);
      stages['safety']?.push(t5 - t4);
      stages['total']?.push(t5 - t0);
    }
    out.push({
      drugs: set.join(', '),
      units,
      medianMs: Object.fromEntries(
        Object.entries(stages).map(([name, list]) => [name, Math.round(median(list))]),
      ),
    });
  }
  console.log(
    JSON.stringify(
      {
        latency: out,
        note: 'bun + SQLite on a desktop; the app reads documents from OPFS in a worker',
      },
      null,
      2,
    ),
  );
}

/** A small seeded generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sampleSize = Number(arg('sample') ?? 0);
if (sampleSize > 0) {
  const next = random(Number(arg('seed') ?? 1));
  const pool: Record<string, unknown>[] = [];
  const wanted = { identical: 0, similar: 0, only: 0 };
  const chosenPairs: [string, string][] = [];
  while (chosenPairs.length < 80) {
    const a = top200[Math.floor(next() * top200.length)] as string;
    const b = top200[Math.floor(next() * top200.length)] as string;
    if (a !== b) chosenPairs.push([a, b]);
  }
  for (const [a, b] of chosenPairs) {
    const items = [itemOf(a), itemOf(b)];
    const { chosen, documents } = await load(items);
    const columns = columnViews(index, items, chosen, documents);
    if (columns.some((column) => column.state !== 'ready')) continue;
    const extracted = new Map(
      columns.map((column) => {
        const state = documents.get(column.documentId ?? '');
        return [column.position, extractRows((state as { document: never }).document)] as const;
      }),
    );
    const own = new Map(items.map((item, p) => [p, [item.id]]));
    const rows = sectionRowViews(columns, extracted, own);
    for (const row of rows) {
      if (row.id === 'adverse') continue; // long catalogue lists: sampled separately by the seed
      for (const cluster of row.clusters) {
        const kind = cluster.kind === 'only' ? 'only' : cluster.identical ? 'identical' : 'similar';
        const cells = cluster.cells.map((cell) => cell?.text ?? null);
        const record: Record<string, unknown> = { pair: `${a} | ${b}`, row: row.id, kind, cells };
        if (kind === 'only') {
          const position = cluster.cells.findIndex((cell) => cell !== null);
          const mine = cells[position] as string;
          const otherColumn = 1 - position;
          const otherUnits = extracted.get(otherColumn)?.get(row.id)?.units ?? [];
          const mineTokens = (
            extracted
              .get(position)
              ?.get(row.id)
              ?.units.find((u) => u.text === mine)?.tokens ?? []
          ).map((t) => t.stem);
          record['position'] = position;
          record['closest'] = otherUnits
            .map((unit) => ({
              text: unit.text,
              score: jaccard(
                [...new Set(mineTokens)].toSorted(),
                [...new Set(unit.tokens.map((t) => t.stem))].toSorted(),
              ),
            }))
            .toSorted((x, y) => y.score - x.score)
            .slice(0, 2)
            .map((entry) => `${entry.score.toFixed(2)} ${entry.text}`);
        }
        pool.push(record);
      }
    }
  }
  const take = (kind: string, count: number): Record<string, unknown>[] => {
    const list = pool.filter((entry) => entry['kind'] === kind);
    const picked: Record<string, unknown>[] = [];
    while (picked.length < Math.min(count, list.length)) {
      const entry = list[Math.floor(next() * list.length)] as Record<string, unknown>;
      if (!picked.includes(entry)) picked.push(entry);
    }
    return picked;
  };
  const per = Math.ceil(sampleSize / 3);
  // Shared statements are rare among different drugs: take them all (up to 30 each), then fill with «only».
  const sample = [...take('identical', 30), ...take('similar', 30), ...take('only', per)];
  wanted.identical = sample.filter((entry) => entry['kind'] === 'identical').length;
  wanted.similar = sample.filter((entry) => entry['kind'] === 'similar').length;
  wanted.only = sample.filter((entry) => entry['kind'] === 'only').length;
  const outPath = arg('out');
  const text = JSON.stringify(
    {
      threshold: SIMILAR_THRESHOLD,
      poolSizes: {
        identical: pool.filter((e) => e['kind'] === 'identical').length,
        similar: pool.filter((e) => e['kind'] === 'similar').length,
        only: pool.filter((e) => e['kind'] === 'only').length,
      },
      counts: wanted,
      sample,
    },
    null,
    1,
  );
  if (outPath) writeFileSync(outPath, `${text}\n`);
  else console.log(text);
}
await core.close();
