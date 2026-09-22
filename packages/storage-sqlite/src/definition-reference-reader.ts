import type {
  DefinitionReferenceBlock,
  DefinitionReferenceHit,
  DefinitionReferenceReader,
} from '@localmed/storage';

/** Supplied by the current database owner. This adapter does not open/close connections or workers. */
export interface DefinitionReferenceSql {
  read(
    sql: string,
    parameters: readonly (string | number)[],
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

type Row = Readonly<Record<string, unknown>>;
const PAGE_BLOCKS = 8;
const BLOCK_CHARACTERS = 4096;
const MAX_QUERY_CHARACTERS = 2048;
const MAX_METADATA_CHARACTERS = 65536;
const HEADER = `e.id, e.canonical_name AS title, e.entity_type AS kind,
  json_extract(e.metadata_json, '$.coverage') AS coverage,
  json_extract(e.metadata_json, '$.textKind') AS text_kind,
  json_extract(e.metadata_json, '$.blockCount') AS block_count`;
const SCOPE = `json_extract(e.metadata_json, '$.definitionReference') = 1
  AND json_extract(e.metadata_json, '$.editionId') = ?
  AND EXISTS (SELECT 1 FROM content_packs p WHERE p.id = ? AND p.enabled = 1)`;

export function normalizeDefinitionReferenceName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

function string(value: unknown, maximum = 2048): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
    throw new Error('Invalid reference row text.');
  }
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid reference row integer.');
  }
  return value;
}

function jsonObject(value: unknown): Row {
  const parsed: unknown = JSON.parse(string(value, MAX_METADATA_CHARACTERS));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid reference metadata.');
  }
  return parsed as Row;
}

function identity(value: string): string {
  if (!value || value.length > 256 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value)) {
    throw new Error('Invalid reference identity.');
  }
  return value;
}

function hit(row: Row, match: 'name' | 'text'): DefinitionReferenceHit {
  const textKind = row['text_kind'];
  if (
    textKind !== 'editorial-paraphrase' &&
    textKind !== 'source-gloss' &&
    textKind !== 'source-excerpt'
  ) {
    throw new Error('Invalid reference text kind.');
  }
  return {
    id: string(row['id'], 256),
    title: string(row['title']),
    kind: string(row['kind'], 40),
    coverage: string(row['coverage'], 80),
    textKind,
    blockCount: integer(row['block_count']),
    reviewStatus: 'requires-review',
    identityStatus: 'source-local-proposed',
    match,
  };
}

/** Create a read-only capability for one already-installed, immutable content-pack handle. */
export async function createSqliteDefinitionReference(
  sql: DefinitionReferenceSql,
): Promise<DefinitionReferenceReader> {
  const rows = await sql.read(
    "SELECT substr(value, 1, 65537) AS value FROM app_metadata WHERE key = 'definition_reference' LIMIT 1",
    [],
  );
  const manifest = jsonObject(rows[0]?.['value']);
  if (
    manifest['contract'] !== 1 ||
    manifest['reviewStatus'] !== 'requires-review' ||
    manifest['publicationState'] !== 'local-dev' ||
    manifest['identityStatus'] !== 'source-local-proposed'
  ) {
    throw new Error('Unsupported definition reference contract.');
  }
  const editionId = string(manifest['editionId'], 256);
  const layout = manifest['linkLayout'];
  if (layout !== undefined && layout !== 'numeric-v1') {
    throw new Error('Unsupported definition reference link layout.');
  }
  const links = layout === 'numeric-v1' ? 'definition_reference_links' : 'knowledge_document_links';
  const metadataLayout = manifest['metadataLayout'];
  if (metadataLayout !== undefined && metadataLayout !== 'fragments-v1') {
    throw new Error('Unsupported definition reference metadata layout.');
  }
  if (metadataLayout === 'fragments-v1' && layout !== 'numeric-v1') {
    throw new Error('Fragment metadata layout requires numeric reference keys.');
  }
  const blockTable = metadataLayout === 'fragments-v1' ? 'definition_reference_chunks' : 'chunks';
  const scope = [editionId, editionId];

  return {
    async search(query, requested = 20) {
      if (
        !Number.isFinite(requested) ||
        requested < 1 ||
        query.length > MAX_QUERY_CHARACTERS ||
        query.includes('\0')
      )
        return [];
      const limit = Math.min(Math.floor(requested), 20);
      const normalized = normalizeDefinitionReferenceName(query);
      if (!normalized || normalized.length > MAX_QUERY_CHARACTERS) return [];
      const exact = await sql.read(
        `SELECT ${HEADER}, MIN(CASE WHEN n.name_type = 'primary' THEN 0 ELSE 1 END) AS tier
        FROM knowledge_names n JOIN knowledge_entities e ON e.id = n.entity_id
        WHERE n.normalized_name = ? AND ${SCOPE}
        GROUP BY e.id ORDER BY tier, CASE WHEN json_extract(e.metadata_json, '$.coverage') = 'needs-definition' THEN 1 ELSE 0 END, e.id LIMIT ?`,
        [normalized, ...scope, limit],
      );
      // Abbreviations/stop words are never discarded before the identity lookup.
      if (exact.length) return exact.map((row) => hit(row, 'name'));
      const tokens = [...new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? [])];
      if (!tokens.length || tokens.length > 24) return [];
      const fts = tokens.map((token) => `"${token}"${token.length >= 4 ? '*' : ''}`).join(' AND ');
      const names = await sql.read(
        `SELECT ${HEADER}
        FROM knowledge_fts f JOIN knowledge_entities e ON e.id = f.entity_id
        WHERE knowledge_fts MATCH ? AND ${SCOPE}
        ORDER BY rank, e.id LIMIT ?`,
        [fts, ...scope, limit],
      );
      const results = names.map((row) => hit(row, 'name'));
      if (results.length >= limit) return results;
      // An explicit small candidate set, not a whole-corpus JS index. The SQL engine owns FTS work.
      const body = await sql.read(
        `WITH matches AS MATERIALIZED (
          SELECT rowid, rank AS score FROM definition_reference_fts
          WHERE definition_reference_fts MATCH ? ORDER BY rank LIMIT 80
        ) SELECT ${HEADER}, MIN(m.score) AS score
        FROM matches m JOIN chunks c ON c.rowid = m.rowid
        JOIN ${links} l ON l.chunk_id = c.id
        JOIN knowledge_entities e ON e.id = l.entity_id
        WHERE l.review_status = 'proposed' AND l.link_type IN ('reference:definition','reference:item')
          AND ${SCOPE}
        GROUP BY e.id ORDER BY score, e.id LIMIT ?`,
        [fts, ...scope, limit],
      );
      const ids = new Set(results.map((item) => item.id));
      for (const row of body) {
        const item = hit(row, 'text');
        if (!ids.has(item.id) && results.length < limit) {
          ids.add(item.id);
          results.push(item);
        }
      }
      return results;
    },
    async getCard(id) {
      identity(id);
      const rows = await sql.read(
        `SELECT ${HEADER} FROM knowledge_entities e WHERE e.id = ? AND ${SCOPE} LIMIT 1`,
        [id, ...scope],
      );
      return rows[0] ? hit(rows[0], 'name') : null;
    },
    async listBlocks(id, after = '') {
      identity(id);
      if (after && (!after.startsWith(`${id}.reference.`) || !/\.reference\.\d{6}$/u.test(after))) {
        throw new Error('Invalid reference block cursor.');
      }
      const rows = await sql.read(
        `SELECT l.id, l.chunk_id, l.document_id,
          json_extract(l.metadata_json, '$.role') AS role, length(c.original_text) AS characters
        FROM ${links} l JOIN knowledge_entities e ON e.id = l.entity_id
        JOIN chunks c ON c.id = l.chunk_id
        WHERE e.id = ? AND l.id > ? AND l.review_status = 'proposed' AND ${SCOPE}
        ORDER BY l.id LIMIT ?`,
        [id, after, ...scope, PAGE_BLOCKS + 1],
      );
      const blocks = rows.slice(0, PAGE_BLOCKS).map((row): DefinitionReferenceBlock => {
        const role = row['role'];
        if (role !== 'definition' && role !== 'item' && role !== 'context' && role !== 'annotation')
          throw new Error('Invalid reference block role.');
        return {
          linkId: string(row['id'], 300),
          chunkId: string(row['chunk_id'], 256),
          sourceId: string(row['document_id'], 256),
          role,
          characters: integer(row['characters']),
        };
      });
      return {
        blocks,
        next: rows.length > PAGE_BLOCKS ? (blocks[blocks.length - 1]?.linkId ?? null) : null,
      };
    },
    async readBlock(id, chunkId, offset = 0) {
      identity(id);
      identity(chunkId);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 262144)
        throw new Error('Invalid reference text offset.');
      const rows = await sql.read(
        `SELECT substr(c.original_text, ?, ?) AS body,
          length(c.original_text) AS characters, substr(c.metadata_json, 1, 65537) AS metadata,
          l.document_id
        FROM ${blockTable} c JOIN ${links} l ON l.chunk_id = c.id
        JOIN knowledge_entities e ON e.id = l.entity_id
        WHERE e.id = ? AND c.id = ? AND l.review_status = 'proposed' AND ${SCOPE} LIMIT 1`,
        [offset + 1, BLOCK_CHARACTERS, id, chunkId, ...scope],
      );
      const row = rows[0];
      if (!row) return null;
      const total = integer(row['characters']);
      const body = string(row['body'], BLOCK_CHARACTERS * 2);
      const provenance = jsonObject(row['metadata']);
      if (provenance['$p'] === 1 && Object.keys(provenance).length === 1) {
        throw new Error('Unresolved reference metadata storage marker.');
      }
      return {
        text: body,
        totalCharacters: total,
        nextOffset: offset + BLOCK_CHARACTERS < total ? offset + BLOCK_CHARACTERS : null,
        sourceId: string(row['document_id'], 256),
        provenance,
      };
    },
    async getSource(id) {
      identity(id);
      const rows = await sql.read(
        `SELECT substr(d.metadata_json, 1, 65537) AS metadata
        FROM documents d JOIN content_packs p ON p.id = d.content_pack_id
        WHERE d.id = ? AND p.id = ? AND p.enabled = 1
          AND json_extract(d.metadata_json, '$.definitionReference') = 1 LIMIT 1`,
        [id, editionId],
      );
      return rows[0] ? jsonObject(rows[0]['metadata']) : null;
    },
  };
}
