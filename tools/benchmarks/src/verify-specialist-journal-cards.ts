import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createSqliteDefinitionReference } from '../../../packages/storage-sqlite/src/definition-reference-reader';

const ExpectedBlock = z.object({
  chunkId: z.string(),
  role: z.string(),
  sourceId: z.string(),
  characters: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const ExpectedCard = z.object({
  id: z.string(),
  title: z.string(),
  coverage: z.string(),
  blocks: z.array(ExpectedBlock),
});
const [databasePath, expectedPath, reportPath] = process.argv.slice(2);
if (!databasePath || !expectedPath || !reportPath) {
  throw new Error(
    'Usage: verify-specialist-journal-cards.ts database expected-cards.json report.json',
  );
}
const expected = z
  .array(ExpectedCard)
  .min(1)
  .max(5000)
  .parse(JSON.parse(readFileSync(expectedPath, 'utf8')));
const database = new Database(databasePath, { readonly: true });
let adapterCalls = 0;
let maximumRows = 0;
let maximumReplyBytes = 0;
let blockReads = 0;
let textSlices = 0;
let largestTextSlice = 0;
const resolvedSources = new Set<string>();
const nameMisses: string[] = [];
try {
  database.exec('PRAGMA cache_size = -2048');
  const reader = await createSqliteDefinitionReference({
    async read(sql, parameters) {
      const rows = database.query(sql).all(...parameters) as Readonly<Record<string, unknown>>[];
      adapterCalls += 1;
      maximumRows = Math.max(maximumRows, rows.length);
      maximumReplyBytes = Math.max(maximumReplyBytes, Buffer.byteLength(JSON.stringify(rows)));
      return rows;
    },
  });
  for (const card of expected) {
    const actual = await reader.getCard(card.id);
    assert.equal(actual?.id, card.id);
    assert.equal(actual?.title, card.title);
    assert.equal(actual?.coverage, card.coverage);
    assert.equal(actual?.reviewStatus, 'requires-review');
    const hits = await reader.search(card.title, 20);
    assert.ok(hits.length <= 20);
    if (!hits.some((hit) => hit.id === card.id)) nameMisses.push(card.id);
    const received: { chunkId: string; role: string; sourceId: string }[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await reader.listBlocks(card.id, cursor);
      assert.ok(page.blocks.length <= 8);
      for (const block of page.blocks) {
        const target = card.blocks[received.length];
        assert.ok(target, 'Reader returned more blocks than the source projection');
        assert.equal(block.chunkId, target.chunkId);
        assert.equal(block.sourceId, target.sourceId);
        assert.equal(block.role, target.role);
        assert.equal(block.characters, target.characters);
        let text = '';
        let offset = 0;
        while (true) {
          const slice = await reader.readBlock(card.id, block.chunkId, offset);
          assert.ok(slice, 'A declared source block is unreadable');
          const codePoints = Array.from(slice.text).length;
          assert.ok(codePoints <= 4096);
          assert.equal(slice.totalCharacters, target.characters);
          assert.equal(slice.sourceId, target.sourceId);
          text += slice.text;
          textSlices += 1;
          largestTextSlice = Math.max(largestTextSlice, codePoints);
          if (slice.nextOffset === null) break;
          assert.equal(slice.nextOffset, offset + codePoints);
          assert.ok(slice.nextOffset > offset);
          offset = slice.nextOffset;
        }
        assert.equal(Array.from(text).length, target.characters);
        assert.equal(createHash('sha256').update(text).digest('hex'), target.sha256);
        blockReads += 1;
        if (!resolvedSources.has(block.sourceId)) {
          assert.ok(await reader.getSource(block.sourceId));
          resolvedSources.add(block.sourceId);
        }
        received.push({ chunkId: block.chunkId, role: block.role, sourceId: block.sourceId });
      }
      if (page.next === null) break;
      assert.ok(!cursors.has(page.next), 'Block cursor repeated');
      cursors.add(page.next);
      cursor = page.next;
    }
    assert.equal(received.length, card.blocks.length);
  }
  const report = {
    cardsReconstructed: expected.length,
    blockReads,
    textSlices,
    maximumTextSliceCodePoints: largestTextSlice,
    sourceReferencesResolved: resolvedSources.size,
    namesWithExactSourceIdAt20: expected.length - nameMisses.length,
    nameMisses,
    adapterCalls,
    maximumRows,
    maximumReplyBytes,
    boundary:
      'Actual file-backed SQLite reader and complete journal card/context reconstruction. Not browser, Android, clinical review or independent reverse-search evaluation.',
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  database.close();
}
