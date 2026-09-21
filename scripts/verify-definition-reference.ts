import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createSqliteDefinitionReference } from '../packages/storage-sqlite/src/definition-reference-reader';

const [path, output, expectedCount, mode = 'corpus'] = process.argv.slice(2);
if (!path || !output || !expectedCount || !['corpus', 'fixture'].includes(mode)) {
  throw new Error('Usage: bun scripts/verify-definition-reference.ts DATABASE REPORT EXPECTED_ENTRIES [corpus|fixture]');
}
const beforeOpen = process.memoryUsage().rss;
const database = new Database(path, { readonly: true });
// A caller-owned file handle; these are benchmark settings, not claims about Android pragmas.
database.exec('PRAGMA query_only=ON; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
let calls = 0;
let maxRows = 0;
let maxReplyBytes = 0;
const start = performance.now();
try {
  const reader = await createSqliteDefinitionReference({
    async read(statement, parameters) {
      calls++;
      const rows = database.query<Record<string, unknown>, (string | number)[]>(statement).all(...parameters);
      maxRows = Math.max(maxRows, rows.length);
      maxReplyBytes = Math.max(maxReplyBytes, Buffer.byteLength(JSON.stringify(rows)));
      return rows;
    },
  });
  const openMs = performance.now() - start;
  const afterOpen = process.memoryUsage().rss;
  const count = database.query<{ count: number }, []>('SELECT count(*) AS count FROM knowledge_entities').get()?.count;
  assert.equal(count, Number(expectedCount));
  assert.equal(database.query<{ count: number }, []>('SELECT count(*) AS count FROM knowledge_facts').get()?.count, 0);
  assert.equal(database.query<{ count: number }, []>('SELECT count(*) AS count FROM knowledge_relations').get()?.count, 0);
  for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(await reader.search('test', limit), []);
  assert.deepEqual(await reader.search('x'.repeat(2049)), []);
  assert.deepEqual(await reader.search('\0')), []);
  const durations: number[] = [];
  const missing: string[] = [];
  let after = '';
  let names = 0;
  // Audit helper reads only 256 source-name strings at a time. The adapter itself never lists the corpus.
  for (;;) {
    const batch = database.query<{ name: string }, [string]>(
      'SELECT DISTINCT normalized_name AS name FROM knowledge_names WHERE normalized_name > ? ORDER BY normalized_name LIMIT 256',
    ).all(after);
    if (!batch.length) break;
    for (const { name } of batch) {
      const t = performance.now();
      const hits = await reader.search(name);
      durations.push(performance.now() - t);
      names++;
      assert(hits.length <= 20);
      if (!hits.length) {
        missing.push(new Bun.CryptoHasher('sha256').update(name).digest('hex'));
      } else {
        assert(!('definition' in (hits[0] ?? {})) && !('references' in (hits[0] ?? {})));
        assert.equal(hits[0]?.reviewStatus, 'requires-review');
        assert.equal(hits[0]?.identityStatus, 'source-local-proposed');
      }
    }
    after = batch[batch.length - 1]?.name ?? after;
  }
  let fixtureAssertions = 0;
  if (mode === 'fixture') {
    const hits = await reader.search('Тестовый термин');
    assert.equal(hits.length, 2); fixtureAssertions++;
    assert.equal((await reader.search('ТТ')).length, 1); fixtureAssertions++;
    assert((await reader.search('точное определение')).some((item) => item.id === 'fixture.first')); fixtureAssertions++;
    assert.deepEqual(await reader.search('контекстмаркер'), []); fixtureAssertions++;
    assert.deepEqual(await reader.search('аннотациямаркер'), []); fixtureAssertions++;
    const page = await reader.listBlocks('fixture.first');
    assert.deepEqual(page.blocks.map((item) => item.role), ['definition', 'item', 'item', 'context', 'annotation']); fixtureAssertions++;
    const block = page.blocks[0]; assert(block);
    const content = await reader.readBlock('fixture.first', block.chunkId); assert(content);
    assert.equal(content.text, 'Точное определение тестового понятия.'); fixtureAssertions++;
    assert.equal(content.provenance['locator'], 'Fixture paragraph 1'); fixtureAssertions++;
    assert.equal(content.nextOffset, null); fixtureAssertions++;
    assert(await reader.getSource(content.sourceId)); fixtureAssertions++;
    assert.equal(await reader.readBlock('fixture.missing', block.chunkId), null); fixtureAssertions++;
    await assert.rejects(reader.readBlock('fixture.first', block.chunkId, -1)); fixtureAssertions++;
    await assert.rejects(reader.listBlocks('fixture.first', 'other.reference.000001')); fixtureAssertions++;
    const huge = await reader.getCard('fixture.long'); assert(huge);
    let cursor: string | undefined;
    const all = [];
    do {
      const result = await reader.listBlocks(huge.id, cursor);
      assert(result.blocks.length <= 8); fixtureAssertions++;
      all.push(...result.blocks);
      cursor = result.next ?? undefined;
    } while (cursor);
    assert.equal(new Set(all.map((item) => item.linkId)).size, all.length); fixtureAssertions++;
    const longBlock = all.find((item) => item.role === 'definition'); assert(longBlock);
    let offset = 0;
    let restored = '';
    for (;;) {
      const part = await reader.readBlock(huge.id, longBlock.chunkId, offset); assert(part);
      assert([...part.text].length <= 4096); fixtureAssertions++;
      restored += part.text;
      if (part.nextOffset === null) break;
      offset = part.nextOffset;
    }
    assert.equal(restored, '😀аб'.repeat(5000)); fixtureAssertions++;
  }
  durations.sort((a, b) => a - b);
  const report = {
    contract: 1, mode, entries: count, sourceNameSurfaces: names,
    namesWithAResult: names - missing.length, missingNameSha256: missing,
    fixtureAssertions, creationMs: openMs,
    lookupMs: { p50: durations[Math.floor(durations.length * 0.50)] ?? null, p95: durations[Math.floor(durations.length * 0.95)] ?? null },
    rssBytes: { beforeOpen, afterOpen, afterAudit: process.memoryUsage().rss },
    adapterCalls: calls, maxRowsPerAdapterCall: maxRows, maxReplyBytes,
    boundaries: 'File-backed Bun SQLite in a fresh process, 2 MiB page-cache setting; not app/browser/native/WASM/device qualification. Name coverage is not independent reverse-definition quality. The corpus-name audit is outside the reader and runs in bounded batches. RSS is whole-process current memory, not a peak or Android PSS.',
  };
  assert(maxRows <= 20);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  database.close();
}
