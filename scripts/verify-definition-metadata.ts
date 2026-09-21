import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createSqliteDefinitionReference } from '../packages/storage-sqlite/src/definition-reference-reader';

const [baselinePath, encodedPath, reportPath] = process.argv.slice(2);
if (!baselinePath || !encodedPath || !reportPath) {
  throw new Error('Usage: bun scripts/verify-definition-metadata.ts BASELINE ENCODED REPORT');
}
const baseline = new Database(baselinePath, { readonly: true });
const encoded = new Database(encodedPath, { readonly: true });
const before = process.memoryUsage().rss;
let maxReplyBytes = 0;
let maxRows = 0;
try {
  for (const database of [baseline, encoded]) {
    database.exec('PRAGMA query_only=ON; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
  }
  const reader = await createSqliteDefinitionReference({
    async read(sql, parameters) {
      const rows = encoded
        .query<Record<string, unknown>, (string | number)[]>(sql)
        .all(...parameters);
      maxReplyBytes = Math.max(maxReplyBytes, Buffer.byteLength(JSON.stringify(rows)));
      maxRows = Math.max(maxRows, rows.length);
      return rows;
    },
  });
  // Bounded structural smoke sample, not clinical gold. Complete raw fidelity is
  // separately established for every row by the builder's before/after digests.
  const targets = encoded
    .query<{ id: string; entity: string }, []>(`
    SELECT b.chunk_id AS id, MIN(e.entity_id) AS entity
    FROM definition_reference_metadata_programs p
    JOIN definition_reference_chunk_keys b ON b.local_id=p.chunk_key
    JOIN definition_reference_compact_links l ON l.chunk_key=b.local_id
    JOIN definition_reference_entity_keys e ON e.local_id=l.entity_key
    GROUP BY b.local_id ORDER BY b.local_id LIMIT 128
  `)
    .all();
  assert(targets.length > 0);
  const timings: number[] = [];
  for (const target of targets) {
    const original = baseline
      .query<{ metadata: string; body: string }, [string]>(
        'SELECT metadata_json AS metadata, substr(original_text,1,4096) AS body FROM chunks WHERE id=?',
      )
      .get(target.id);
    assert(original);
    const started = performance.now();
    const restored = await reader.readBlock(target.entity, target.id);
    timings.push(performance.now() - started);
    assert(restored);
    assert.deepEqual(restored.provenance, JSON.parse(original.metadata));
    assert.equal(restored.text, original.body);
    assert.equal(await reader.readBlock('fixture.unrelated', target.id), null);
  }
  timings.sort((a, b) => a - b);
  const report = {
    contract: 1,
    comparedBlocks: targets.length,
    exactTextAndProvenanceEqual: true,
    unrelatedEntryBlocked: true,
    readMs: {
      p50: timings[Math.floor(timings.length * 0.5)],
      p95: timings[Math.floor(timings.length * 0.95)],
    },
    maxRowsPerCall: maxRows,
    maxReplyBytes,
    rssBytes: { before, after: process.memoryUsage().rss },
    boundaries:
      '128 deterministic encoded-block host smoke reads at most, versus the same-run inline baseline. Complete raw table/metadata equality is checked separately in the builder. Two caller-owned read-only database handles; not Android, whole-app, clinical quality or peak/incremental memory qualification. No source text or query content in this report.',
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  baseline.close();
  encoded.close();
}
