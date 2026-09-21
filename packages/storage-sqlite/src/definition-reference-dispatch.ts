import {
  type DefinitionReferenceReader,
  type DefinitionReferenceReply,
  type DefinitionReferenceRequest,
  DefinitionReferenceRequestSchema,
} from '@localmed/contracts';
import {
  createSqliteDefinitionReference,
  type DefinitionReferenceSql,
} from './definition-reference-reader';

/** One capability per immutable handle. No new handle, worker, corpus cache or generic SQL RPC. */
export function createDefinitionReferenceDispatch(sql: DefinitionReferenceSql) {
  let capability:
    | Promise<{ reader: DefinitionReferenceReader; editionId: string; entries: number } | null>
    | undefined;
  const load = async () => {
    const rows = await sql.read(
      `SELECT p.id, p.schema_version, substr(m.value, 1, 65537) AS manifest
       FROM app_metadata m JOIN content_packs p
         ON p.id = json_extract(m.value, '$.editionId') AND p.enabled = 1
       WHERE m.key = 'definition_reference' LIMIT 2`,
      [],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row ||
      row['schema_version'] !== 7 ||
      typeof row['id'] !== 'string' ||
      typeof row['manifest'] !== 'string' ||
      row['manifest'].length > 65536
    ) {
      throw new Error('Unsupported installed reference edition.');
    }
    const manifest: unknown = JSON.parse(row['manifest']);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      throw new Error('Invalid reference manifest.');
    const fields = manifest as Record<string, unknown>;
    // R2 uses the qualified numeric layout. The optional metadata experiment is not enabled here.
    if (fields['linkLayout'] !== 'numeric-v1' || fields['metadataLayout'] !== undefined)
      throw new Error('Unsupported application reference layout.');
    const reader = await createSqliteDefinitionReference(sql);
    const count = await sql.read(
      `SELECT count(*) AS entries FROM knowledge_entities
       WHERE json_extract(metadata_json, '$.definitionReference') = 1
         AND json_extract(metadata_json, '$.editionId') = ?`,
      [row['id']],
    );
    const entries = count[0]?.['entries'];
    if (
      typeof entries !== 'number' ||
      !Number.isSafeInteger(entries) ||
      entries < 1 ||
      entries > 100000
    )
      throw new Error('Invalid reference entry count.');
    return { reader, editionId: row['id'], entries };
  };
  return async (untrusted: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> => {
    const request = DefinitionReferenceRequestSchema.parse(untrusted);
    capability ??= load();
    const loaded = await capability;
    if (!loaded || request.editionId !== loaded.editionId) return { op: 'unavailable' };
    const { reader } = loaded;
    switch (request.op) {
      case 'status':
        return { op: 'status', editionId: loaded.editionId, entries: loaded.entries };
      case 'search':
        return { op: 'search', hits: await reader.search(request.query, request.limit) };
      case 'card':
        return { op: 'card', card: await reader.getCard(request.id) };
      case 'blocks':
        return { op: 'blocks', page: await reader.listBlocks(request.id, request.after) };
      case 'text':
        return {
          op: 'text',
          block: await reader.readBlock(request.id, request.chunkId, request.offset),
        };
      case 'source':
        return { op: 'source', source: await reader.getSource(request.id) };
    }
  };
}
