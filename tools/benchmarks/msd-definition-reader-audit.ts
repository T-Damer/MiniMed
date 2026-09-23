import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createSqliteDefinitionReference } from '../../packages/storage-sqlite/src/definition-reference-reader';

interface SourceBlock {
  readonly id: number;
  readonly source: number;
  readonly text: string;
  readonly path: string;
  readonly locator: string;
  readonly textSha256: string;
  readonly sourceVerification: {
    readonly method: string;
    readonly responseSha256: string;
    readonly paragraphSha256: string;
    readonly excerptSha256: string;
    readonly start: number;
    readonly end: number;
  };
}
interface SourceTerm {
  readonly id: string;
  readonly title: string;
  readonly blockIds: readonly number[];
}
interface CompletionInput {
  readonly format: string;
  readonly catalog: {
    readonly blocks: readonly SourceBlock[];
    readonly terms: readonly SourceTerm[];
    readonly sources: readonly {
      readonly id: number;
      readonly title: string;
      readonly releaseEligible: boolean;
    }[];
  };
  readonly targets: readonly { readonly id: string; readonly expectedTitle: string }[];
}
interface NativeDatabase {
  query(sql: string): { all(...parameters: (string | number)[]): unknown[] };
  close(): void;
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

const [databasePath, inputPath, reportPath] = process.argv.slice(2);
if (!databasePath || !inputPath || !reportPath) {
  throw new Error(
    'Usage: bun tools/benchmarks/msd-definition-reader-audit.ts DB COMPLETIONS REPORT',
  );
}
const inputBytes = readFileSync(inputPath);
// This diagnostic consumes the prepared file already validated by the ordinary Python ingester.
const input = JSON.parse(inputBytes.toString('utf8')) as CompletionInput;
if (input.format !== 'minimed-name-completions-v1' || !input.targets.length) {
  throw new Error('Expected a nonempty validated name-completion input');
}
const blocks = new Map(input.catalog.blocks.map((block) => [block.id, block]));
const sources = new Map(input.catalog.sources.map((source) => [source.id, source]));
const targets = new Map(input.targets.map((target) => [target.id, target.expectedTitle]));
if (targets.size !== input.catalog.terms.length)
  throw new Error('Completion identity count differs');
// Same explicit native-module boundary used by the existing file-backed benchmark adapter.
const sqlite = (await import('bun:sqlite' as string)) as {
  Database: new (path: string, options: { readonly: boolean }) => NativeDatabase;
};
const database = new sqlite.Database(databasePath, { readonly: true });
let calls = 0;
let maximumRows = 0;
let maximumResponseBytes = 0;
const reader = await createSqliteDefinitionReference({
  async read(sql, args) {
    const rows = database.query(sql).all(...args) as Record<string, unknown>[];
    calls += 1;
    maximumRows = Math.max(maximumRows, rows.length);
    maximumResponseBytes = Math.max(maximumResponseBytes, Buffer.byteLength(JSON.stringify(rows)));
    return rows;
  },
});
const outcomes = [];
try {
  for (const term of input.catalog.terms) {
    if (targets.get(term.id) !== term.title || term.blockIds.length !== 1) {
      throw new Error('Completion target/title mismatch');
    }
    const expected = blocks.get(term.blockIds[0] ?? -1);
    if (!expected || hash(expected.text) !== expected.textSha256) {
      throw new Error('Invalid prepared source text receipt');
    }
    const card = await reader.getCard(term.id);
    if (!card || card.title !== term.title || card.coverage !== 'definition') {
      throw new Error('Completed name is not an available definition');
    }
    const page = await reader.listBlocks(term.id);
    const definition = page.blocks[0];
    const origin = page.blocks[1];
    if (
      page.next !== null ||
      page.blocks.length !== 2 ||
      definition?.role !== 'definition' ||
      origin?.role !== 'annotation'
    ) {
      throw new Error('Definition or original discovery link is missing');
    }
    const text = await reader.readBlock(term.id, definition.chunkId);
    if (
      !text ||
      text.nextOffset !== null ||
      text.text !== expected.text ||
      [...text.text].length > 4096
    ) {
      throw new Error('Bounded reader altered the source definition');
    }
    if (
      text.provenance['path'] !== expected.path ||
      text.provenance['locator'] !== expected.locator
    ) {
      throw new Error('Source locator changed');
    }
    const proof = text.provenance['sourceVerification'];
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      throw new Error('Source paragraph verification missing');
    }
    const stored = proof as Record<string, unknown>;
    for (const key of [
      'method',
      'responseSha256',
      'paragraphSha256',
      'excerptSha256',
      'start',
      'end',
    ] as const) {
      if (stored[key] !== expected.sourceVerification[key])
        throw new Error('Source receipt changed');
    }
    const source = await reader.getSource(text.sourceId);
    const expectedSource = sources.get(expected.source);
    const descriptor = source?.['source'];
    if (
      !descriptor ||
      typeof descriptor !== 'object' ||
      Array.isArray(descriptor) ||
      !expectedSource ||
      (descriptor as Record<string, unknown>)['title'] !== expectedSource.title ||
      (descriptor as Record<string, unknown>)['releaseEligible'] !== false
    ) {
      throw new Error('Unresolved source or silently promoted distribution state');
    }
    const discovery = await reader.readBlock(term.id, origin.chunkId);
    if (!discovery || !(await reader.getSource(discovery.sourceId))) {
      throw new Error('Original name-discovery provenance is unreadable');
    }
    const names = await reader.search(term.title, 20);
    const framed = await reader.search(`Что такое ${term.title}?`, 20);
    if (names.length > 20 || framed.length > 20) throw new Error('Public result budget exceeded');
    const rank = names.findIndex((hit) => hit.id === term.id);
    const framedRank = framed.findIndex((hit) => hit.id === term.id);
    outcomes.push({
      id: term.id,
      title: term.title,
      rank: rank < 0 ? null : rank + 1,
      framedRank: framedRank < 0 ? null : framedRank + 1,
      characters: [...text.text].length,
      sourceAndDiscoveryLinksPreserved: true,
    });
  }
} finally {
  database.close();
}
const report = {
  inputSha256: hash(inputBytes),
  databaseSha256: hash(readFileSync(databasePath)),
  definitionsRead: outcomes.length,
  namedTop1: outcomes.filter((item) => item.rank === 1).length,
  namedTop20: outcomes.filter((item) => item.rank !== null).length,
  framedTop1: outcomes.filter((item) => item.framedRank === 1).length,
  framedTop20: outcomes.filter((item) => item.framedRank !== null).length,
  calls,
  maximumRows,
  maximumResponseBytes,
  outcomes,
  boundary:
    'Prepared source fidelity, bounded read and title/navigation lookup. Not medical approval, full HTML replay, independent reverse-search quality, device memory or clinical decisions.',
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    definitionsRead: report.definitionsRead,
    namedTop20: report.namedTop20,
    framedTop20: report.framedTop20,
  }),
);
