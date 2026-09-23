import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createSqliteDefinitionReference } from '../../packages/storage-sqlite/src/definition-reference-reader';

const [dbPath, bundlePath, reportPath] = process.argv.slice(2);
if (!dbPath || !bundlePath || !reportPath) throw new Error('Expected DB BUNDLE REPORT');
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const db = new Database(dbPath, { readonly: true });
const reader = await createSqliteDefinitionReference({ async read(sql, args) { return db.query(sql).all(...args); } });
const outcomes = [];
try {
  for (const term of bundle.catalog.terms) {
    const card = await reader.getCard(term.id);
    assert(card && card.title === term.title && card.coverage === 'definition');
    const expected = bundle.catalog.blocks.find((block) => block.id === term.blockIds[0]);
    assert(expected);
    const page = await reader.listBlocks(term.id);
    let found = false;
    for (const block of page.blocks) {
      if (block.role !== 'definition') continue;
      const text = await reader.readBlock(term.id, block.chunkId);
      assert(text);
      if (text.text !== expected.text) continue;
      assert.equal(createHash('sha256').update(text.text).digest('hex'), expected.textSha256);
      assert(await reader.getSource(block.sourceId));
      found = true;
      break;
    }
    assert(found, `Source definition unreadable: ${term.id}`);
    const hits = await reader.search(term.title, 20);
    const index = hits.findIndex((hit) => hit.id === term.id);
    assert(index >= 0, `Completed title not retrieved: ${term.id}`);
    outcomes.push({ id: term.id, title: term.title, rank: index + 1, sourceTextExact: true });
  }
  writeFileSync(reportPath, `${JSON.stringify({
    databaseSha256: createHash('sha256').update(readFileSync(dbPath)).digest('hex'),
    checked: outcomes.length, top1: outcomes.filter((row) => row.rank === 1).length,
    outcomes, boundary: 'Actual SQLite reader and title checks, not reverse clinical search or medical review.',
  }, null, 2)}\n`);
  console.log(JSON.stringify(outcomes));
} finally { db.close(); }
