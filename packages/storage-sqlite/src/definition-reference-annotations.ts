import type {
  DefinitionReferenceAnnotation,
  DefinitionReferenceAnnotationPage,
} from '@localmed/contracts';
import type { DefinitionReferenceSql } from './definition-reference-reader';

function identity(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value)) {
    throw new Error('Invalid source annotation identity.');
  }
  return value;
}

/** Called only for a declared source-spans-v1 edition; no complete annotation blob is hydrated. */
export async function readDefinitionReferenceAnnotations(
  sql: DefinitionReferenceSql,
  editionId: string,
  entryId: string,
  after = '',
): Promise<DefinitionReferenceAnnotationPage> {
  identity(editionId);
  identity(entryId);
  if (after) identity(after);
  const rows = await sql.read(
    `SELECT a.id, a.kind, a.label, a.start_offset, a.end_offset, a.chunk_id,
       d.id AS source_id, length(c.original_text) AS characters,
       substr(c.original_text, a.start_offset + 1, a.end_offset - a.start_offset) AS statement
     FROM definition_reference_annotation_links al
     JOIN definition_reference_annotation_spans a ON a.id = al.annotation_id
     JOIN knowledge_entities e ON e.id = al.entity_id
     JOIN chunks c ON c.id = a.chunk_id
     JOIN document_versions v ON v.id = c.document_version_id
     JOIN documents d ON d.id = v.document_id
     JOIN content_packs p ON p.id = d.content_pack_id
     WHERE e.id = ? AND a.id > ? AND p.id = ? AND p.enabled = 1
       AND json_extract(e.metadata_json, '$.definitionReference') = 1
       AND json_extract(e.metadata_json, '$.editionId') = p.id
       AND json_extract(e.metadata_json, '$.inputSha256') = a.input_sha256
       AND EXISTS (SELECT 1 FROM definition_reference_links l
          WHERE l.entity_id = e.id AND l.chunk_id = c.id AND l.document_id = d.id
            AND l.review_status <> 'rejected'
            AND l.link_type IN ('reference:definition','reference:item','reference:context'))
     ORDER BY a.id LIMIT 9`,
    [entryId, after, editionId],
  );
  if (rows.length > 9) throw new Error('Source annotation page exceeds its bound.');
  const items = rows.slice(0, 8).map((row): DefinitionReferenceAnnotation => {
    const kind = row['kind'];
    const start = row['start_offset'];
    const end = row['end_offset'];
    const characters = row['characters'];
    const statement = row['statement'];
    const label = row['label'];
    if (
      (kind !== 'etymology' && kind !== 'historical-mention') ||
      typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 ||
      typeof end !== 'number' || !Number.isSafeInteger(end) || end <= start || end - start > 4096 ||
      typeof characters !== 'number' || !Number.isSafeInteger(characters) || end > characters ||
      typeof statement !== 'string' || statement.includes('\0') || [...statement].length !== end - start ||
      typeof label !== 'string' || !label.trim() || label.length > 256 || label.includes('\0')
    ) throw new Error('Invalid source annotation span.');
    return {
      id: identity(row['id']), kind, label, statement,
      chunkId: identity(row['chunk_id']), sourceId: identity(row['source_id']), start, end,
      reviewStatus: 'requires-review', identityStatus: 'unresolved',
    };
  });
  return { items, next: rows.length > 8 ? (items.at(-1)?.id ?? null) : null };
}
