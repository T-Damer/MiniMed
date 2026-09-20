import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';

interface DefinitionCase {
  readonly id: string;
  readonly query: string;
  readonly expectedIds: readonly string[];
  readonly maxRank: number;
  readonly origin: string;
  readonly expectedDefinition?: string;
}

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string) =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
for (const arg of args) {
  if (!/^--(?:core|pack|report)=.+$/u.test(arg)) throw new Error('Unknown argument.');
}
const paths = [
  resolve(root, option('core') ?? 'data/build/definitions.db'),
  ...args.filter((arg) => arg.startsWith('--pack=')).map((arg) => resolve(root, arg.slice(7))),
];
const fixturePath = resolve(root, 'tools/benchmarks/definition-queries.json');
const raw: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
if (!Array.isArray(raw) || !raw.length) throw new Error('Missing definition cases.');
const fixtures = raw.map((value: unknown): DefinitionCase => {
  if (!value || typeof value !== 'object') throw new Error('Invalid definition case.');
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    typeof item.query !== 'string' ||
    typeof item.origin !== 'string' ||
    !Array.isArray(item.expectedIds) ||
    !item.expectedIds.length ||
    item.expectedIds.some((id) => typeof id !== 'string') ||
    !Number.isInteger(item.maxRank) ||
    Number(item.maxRank) < 1 ||
    Number(item.maxRank) > 20 ||
    (item.expectedDefinition !== undefined && typeof item.expectedDefinition !== 'string')
  )
    throw new Error('Invalid definition case fields.');
  return item as unknown as DefinitionCase;
});
if (new Set(fixtures.map((item) => item.id)).size !== fixtures.length)
  throw new Error('Duplicate case.');
const stores = await Promise.all(
  paths.map(async (path, index) => ({
    moduleId: `definition-benchmark:${index}`,
    store: await SqliteMedicalStore.createFromBytes(new Uint8Array(readFileSync(path))),
    required: true,
    searchWeight: 1,
  })),
);
const store = new MultiMedicalStore(stores);
const core = createMedicalCore({ store, platform: 'test', embedder: new PortableHashEmbedder() });
const rows = [];
try {
  const initialized = await core.initialize();
  if (!initialized.ok) throw new Error(initialized.error.message);
  for (const fixture of fixtures) {
    const started = performance.now();
    const found = await core.search({
      query: fixture.query,
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 20,
      includeSuggestions: false,
    });
    if (!found.ok) throw new Error(found.error.message);
    const ids = found.value.groups.map((group) => group.documentId);
    const ranks = fixture.expectedIds.map((id) => ids.indexOf(id) + 1);
    let definitionReadable = true;
    let exactContext = true;
    for (const id of fixture.expectedIds) {
      const document = await core.getDocument(id);
      if (!document.ok) {
        definitionReadable = false;
        continue;
      }
      const definitionSections = document.value.sections.filter(
        (section) => section.title === 'Определение',
      );
      const text = definitionSections
        .flatMap((section) => section.chunks.map((chunk) => chunk.originalText))
        .join('\n');
      definitionReadable &&=
        text.length >= 40 &&
        (!fixture.expectedDefinition || text.includes(fixture.expectedDefinition));
      const metadata = document.value.metadata;
      definitionReadable &&=
        metadata.definitionStatus === 'proposed' &&
        metadata.releaseEligible === false &&
        typeof metadata.officialSourceUrl === 'string';
      const group = found.value.groups.find((item) => item.documentId === id);
      if (!group) exactContext = false;
      for (const hit of group?.results ?? []) {
        const chunk = await store.getChunk(hit.chunkId);
        exactContext &&= Boolean(
          chunk &&
            chunk.anchor === hit.anchor &&
            chunk.sectionId === hit.sectionId &&
            chunk.documentVersionId === hit.documentVersionId,
        );
      }
    }
    const rankPass = ranks.every((rank) => rank > 0 && rank <= fixture.maxRank);
    rows.push({
      id: fixture.id,
      origin: fixture.origin,
      expectedRanks: ranks,
      rankPass,
      definitionReadable,
      exactContext,
      elapsedMs: performance.now() - started,
    });
  }
} finally {
  await core.close();
}
const strict = rows.filter((row) => row.origin !== 'authored-description-probe');
const probes = rows.filter((row) => row.origin === 'authored-description-probe');
const passed = (row: (typeof rows)[number]) =>
  row.rankPass && row.definitionReadable && row.exactContext;
const report = {
  fixtureSha256: createHash('sha256').update(readFileSync(fixturePath)).digest('hex'),
  corpus: paths.map((path) => ({
    path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  })),
  strict: { total: strict.length, passed: strict.filter(passed).length },
  descriptionProbes: { total: probes.length, passed: probes.filter(passed).length },
  note: 'User-requested regressions and authored probes, not independent clinical/model qualification.',
  rows,
};
const output = resolve(root, option('report') ?? 'data/build/definition-quality.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (strict.some((row) => !passed(row))) process.exitCode = 1;
