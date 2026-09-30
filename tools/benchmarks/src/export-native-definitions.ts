/** Source-local draft navigation oracle. Only hashes of source text/provenance enter fixtures. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';
import { createSqliteDefinitionReference } from '@localmed/storage-sqlite';
import { z } from 'zod';

const path = resolve(
  process.argv[2] ?? resolve(REPOSITORY_ROOT, 'playwright/native-current-reference.db'),
);
const moduleName = 'bun:sqlite';
const sqlite: {
  Database: new (
    path: string,
    options: { readonly: boolean },
  ) => {
    query(sql: string): { all(...parameters: readonly (string | number)[]): unknown[] };
    close(): void;
  };
} = await import(moduleName);
const expectedHash = 'f3d5c759ce8c4133640ae2656dfcee2c928a126685b3451a1aa5560db94b378d';
const packHash = createHash('sha256');
for await (const bytes of createReadStream(path)) packHash.update(bytes);
if (packHash.digest('hex') !== expectedHash)
  throw new Error('Expected the released 2026.9.30 reference');
const database = new sqlite.Database(path, { readonly: true });
const row = z.record(z.string(), z.unknown());
const rows = z.array(row);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
try {
  const reader = await createSqliteDefinitionReference({
    read: async (sql, parameters) => rows.parse(database.query(sql).all(...parameters)),
  });
  const selected = z.array(z.object({ id: z.string(), title: z.string() })).parse(
    database
      .query(`
    WITH samples AS (SELECT id,canonical_name AS title,ROW_NUMBER() OVER
      (PARTITION BY entity_type,json_extract(metadata_json,'$.coverage') ORDER BY id) AS ordinal
      FROM knowledge_entities WHERE json_extract(metadata_json,'$.definitionReference')=1)
    SELECT id,title FROM samples WHERE ordinal=1
    UNION SELECT e.id,e.canonical_name AS title FROM knowledge_entities e WHERE e.id IN (
      SELECT entity_id FROM definition_reference_links l JOIN chunks c ON c.id=l.chunk_id
      WHERE length(c.original_text)>4096 ORDER BY length(c.original_text) DESC LIMIT 1)
    UNION SELECT id,canonical_name AS title FROM (SELECT id,canonical_name FROM knowledge_entities
      WHERE json_extract(metadata_json,'$.blockCount')>8 ORDER BY id LIMIT 1)
    ORDER BY id`)
      .all(),
  );
  const searches = [];
  const cards = [];
  for (const item of selected) {
    const card = await reader.getCard(item.id);
    if (card?.reviewStatus !== 'requires-review' || card.identityStatus !== 'source-local-proposed')
      throw new Error('Draft identity contract changed');
    searches.push({ query: item.title, hits: await reader.search(item.title) });
    const first = await reader.listBlocks(item.id);
    const second = first.next ? await reader.listBlocks(item.id, first.next) : null;
    const blocks = [];
    for (const block of [...first.blocks, ...(second?.blocks ?? [])]) {
      const pages = [];
      const wholeText = createHash('sha256');
      let offset = 0;
      let characters = 0;
      for (let pageNumber = 0; ; pageNumber += 1) {
        if (pageNumber >= 65) throw new Error('Reference text exceeds contract budget');
        const page = await reader.readBlock(item.id, block.chunkId, offset);
        if (!page) throw new Error('Linked source block missing');
        wholeText.update(page.text);
        characters += Array.from(page.text).length;
        pages.push({
          offset,
          textSha256: digest(page.text),
          nextOffset: page.nextOffset,
          totalCharacters: page.totalCharacters,
          sourceId: page.sourceId,
          provenanceSha256: digest(JSON.stringify(page.provenance)),
        });
        if (page.nextOffset === null) break;
        if (page.nextOffset <= offset) throw new Error('Reference cursor did not advance');
        offset = page.nextOffset;
      }
      if (characters !== block.characters)
        throw new Error('Reference code-point pages lost source text');
      const source = await reader.getSource(block.sourceId);
      blocks.push({
        block,
        pages,
        wholeTextSha256: wholeText.digest('hex'),
        sourceMetadataSha256: source ? digest(JSON.stringify(source)) : null,
      });
    }
    cards.push({ card, first, second, blocks });
  }
  const negativeQuery = 'minimed-negative-definition-2026-09-30';
  searches.push({ query: negativeQuery, hits: await reader.search(negativeQuery) });
  if (
    !cards.some((item) => item.second) ||
    !cards.some((item) => item.blocks.some((block) => block.pages.length > 1))
  )
    throw new Error('Oracle lacks block and Unicode text pagination');
  await writeFile(
    resolve(
      REPOSITORY_ROOT,
      'native/shared/src/commonTest/resources/definition-reference-golden.json',
    ),
    `${JSON.stringify({
      contract: 1,
      moduleId: 'minimed.definition.reference.ru',
      moduleVersion: '2026.9.30',
      editionId: 'minimed.definition.reference.2026.9.30',
      packSha256: expectedHash,
      searches,
      cards,
    })}\n`,
  );
  console.log(
    JSON.stringify({
      searches: searches.length,
      cards: cards.length,
      blocks: cards.reduce((count, item) => count + item.blocks.length, 0),
      textPages: cards.reduce(
        (count, item) =>
          count + item.blocks.reduce((total, block) => total + block.pages.length, 0),
        0,
      ),
    }),
  );
} finally {
  database.close();
}
