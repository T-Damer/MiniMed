import {
  type DefinitionReferenceAnnotation,
  type DefinitionReferenceAnnotationPage,
  type DefinitionReferenceEdition,
  DefinitionReferenceEditionSchema,
  type DefinitionReferenceReply,
  type DefinitionReferenceRequest,
  DefinitionReferenceRequestSchema,
} from '@localmed/contracts';
import { createSqliteDefinitionReference, type DefinitionReferenceSql } from './definition-reference-reader';

async function annotations(sql: DefinitionReferenceSql, editionId: string, id: string, after = ''): Promise<DefinitionReferenceAnnotationPage> {
  const rows = await sql.read(
    `SELECT a.id, a.kind, a.label, a.start_offset, a.end_offset, a.chunk_id,
       c.document_version_id, l.document_id,
       substr(c.original_text, a.start_offset + 1, a.end_offset - a.start_offset) AS statement
     FROM definition_reference_annotation_links al
     JOIN definition_reference_annotation_spans a ON a.id = al.annotation_id
     JOIN knowledge_entities e ON e.id = al.entity_id
     JOIN chunks c ON c.id = a.chunk_id
     JOIN definition_reference_links l ON l.entity_id = e.id AND l.chunk_id = c.id
     WHERE e.id = ? AND a.id > ? AND l.review_status = 'proposed'
       AND json_extract(e.metadata_json, '$.editionId') = ?
       AND json_extract(e.metadata_json, '$.inputSha256') = a.input_sha256
       AND a.start_offset >= 0 AND a.end_offset <= length(c.original_text)
     GROUP BY a.id ORDER BY a.id LIMIT 9`, [id, after, editionId],
  );
  const items = rows.slice(0, 8).map((row): DefinitionReferenceAnnotation => {
    const kind = row['kind'];
    const start = row['start_offset'];
    const end = row['end_offset'];
    const statement = row['statement'];
    const label = row['label'];
    const annotationId = row['id'];
    const chunkId = row['chunk_id'];
    const sourceId = row['document_id'];
    if ((kind !== 'etymology' && kind !== 'historical-mention') ||
      typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end <= start || end - start > 4096 || typeof statement !== 'string' || [...statement].length !== end - start ||
      typeof label !== 'string' || !label || label.length > 256 ||
      typeof annotationId !== 'string' || annotationId.length > 256 ||
      typeof chunkId !== 'string' || chunkId.length > 256 || typeof sourceId !== 'string' || sourceId.length > 256) {
      throw new Error('Invalid source annotation projection.');
    }
    return { id: annotationId, kind, label, statement, chunkId, sourceId, start, end,
      reviewStatus: 'requires-review', identityStatus: 'unresolved' };
  });
  return { items, next: rows.length > 8 ? (items.at(-1)?.id ?? null) : null };
}

/** One capability per immutable, already-owned handle. No corpus cache, SQL RPC or new connection. */
export function createDefinitionReferenceDispatch(sql: DefinitionReferenceSql) {
  const load = async () => {
    const rows = await sql.read(
      `SELECT p.id, p.version, p.checksum, p.schema_version, substr(m.value, 1, 65537) AS manifest
       FROM app_metadata m JOIN content_packs p
         ON p.id = json_extract(m.value, '$.editionId') AND p.enabled = 1
       WHERE m.key = 'definition_reference' LIMIT 2`, [],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (rows.length !== 1 || !row || (row['schema_version'] !== 7 && row['schema_version'] !== 9) ||
      typeof row['manifest'] !== 'string' || row['manifest'].length > 65536) {
      throw new Error('Unsupported installed reference edition.');
    }
    const raw: unknown = JSON.parse(row['manifest']);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid reference manifest.');
    const manifest = raw as Record<string, unknown>;
    if (manifest['linkLayout'] !== 'numeric-v1' || manifest['metadataLayout'] !== undefined ||
      (manifest['annotationLayout'] !== undefined && manifest['annotationLayout'] !== 'source-spans-v1') ||
      (row['schema_version'] === 9 && manifest['annotationLayout'] !== 'source-spans-v1') ||
      manifest['version'] !== row['version']) throw new Error('Unsupported application reference layout.');
    const reader = await createSqliteDefinitionReference(sql);
    const count = await sql.read(
      `SELECT count(*) AS entries FROM knowledge_entities
       WHERE json_extract(metadata_json, '$.definitionReference') = 1
         AND json_extract(metadata_json, '$.editionId') = ?`, [String(row['id'])],
    );
    if (count[0]?.['entries'] !== manifest['entries']) throw new Error('Reference entry count mismatch.');
    const edition: DefinitionReferenceEdition = DefinitionReferenceEditionSchema.parse({
      contract: 1, moduleId: row['id'], editionId: row['id'], version: row['version'],
      receipt: row['checksum'], entries: manifest['entries'], annotations: manifest['annotationLayout'] === 'source-spans-v1',
    });
    // Exercise the actual index, not the external-content row count alone. No query text is logged.
    await sql.read(`SELECT rowid FROM definition_reference_fts WHERE definition_reference_fts MATCH ? LIMIT 1`, ['"minimed-reference-capability-probe"']);
    return { reader, edition };
  };
  let capability: ReturnType<typeof load> | undefined;
  return async (untrusted: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> => {
    const request = DefinitionReferenceRequestSchema.parse(untrusted);
    capability ??= load().catch((error: unknown) => { capability = undefined; throw error; });
    const loaded = await capability;
    if (request.op === 'catalog') return { op: 'catalog', editions: loaded ? [loaded.edition] : [] };
    if (!loaded || request.editionId !== loaded.edition.editionId || request.version !== loaded.edition.version || request.receipt !== loaded.edition.receipt) return { op: 'unavailable' };
    const { reader, edition } = loaded;
    switch (request.op) {
      case 'status': return { op: 'status', edition: { ...edition, moduleId: request.moduleId } };
      case 'search': return { op: 'search', hits: await reader.search(request.query, request.limit) };
      case 'card': return { op: 'card', card: await reader.getCard(request.id) };
      case 'blocks': return { op: 'blocks', page: await reader.listBlocks(request.id, request.after) };
      case 'text': return { op: 'text', block: await reader.readBlock(request.id, request.chunkId, request.offset) };
      case 'source': return { op: 'source', source: await reader.getSource(request.id) };
      case 'annotations': return { op: 'annotations', page: edition.annotations ? await annotations(sql, edition.editionId, request.id, request.after) : { items: [], next: null } };
    }
  };
}
