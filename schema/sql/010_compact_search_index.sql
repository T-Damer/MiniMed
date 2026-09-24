-- Ordinary FTS reads its identity columns and indexed text from the source rows instead of
-- storing a second copy (about 15% of the composed core). Column names are unchanged, so readers
-- work with both layouts. Rowids are chunks.rowid: populate only with the 'rebuild' command and
-- re-run 'integrity-check' with rank = 1 after VACUUM.
--
-- FTS5 cannot read external content through a view that calls json_each, so section_path and
-- terminologySearchNames join their JSON string arrays textually. Builders reject JSON escapes
-- such as \n or \u0410 that this textual join would not decode.
--
-- Definition-reference sources stay out of ordinary search, as before (they have their own index).
DROP TABLE IF EXISTS chunks_fts;

CREATE VIEW IF NOT EXISTS chunks_fts_source AS
SELECT c.rowid AS rowid,
       c.id AS chunk_id,
       dv.document_id AS document_id,
       c.document_version_id AS document_version_id,
       c.section_id AS section_id,
       c.anchor AS anchor,
       d.title AS title,
       replace(replace(trim(s.path_json, '[]'), '","', ' '), '"', '') AS section_path,
       c.normalized_text || CASE
         WHEN json_array_length(c.metadata_json, '$.terminologySearchNames') > 0
         THEN ' ' || replace(replace(trim(
           json_extract(c.metadata_json, '$.terminologySearchNames'), '[]'), '","', ' '), '"', '')
         ELSE '' END AS normalized_text
FROM chunks c
JOIN document_versions dv ON dv.id = c.document_version_id
JOIN documents d ON d.id = dv.document_id
JOIN sections s ON s.id = c.section_id
WHERE json_extract(d.metadata_json, '$.definitionReference') IS NOT 1;

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  document_version_id UNINDEXED,
  section_id UNINDEXED,
  anchor UNINDEXED,
  title,
  section_path,
  normalized_text,
  content = 'chunks_fts_source',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

-- Reviewed reference links remain visible. Only rejected links leave the reference index.
DROP VIEW IF EXISTS definition_reference_content;
CREATE VIEW definition_reference_content AS
SELECT c.rowid AS rowid, c.original_text AS original_text
FROM chunks c
WHERE EXISTS (
  SELECT 1 FROM knowledge_document_links l
  WHERE l.chunk_id = c.id AND l.review_status <> 'rejected'
    AND l.link_type IN ('reference:definition', 'reference:item')
) OR EXISTS (
  SELECT 1 FROM definition_reference_chunk_keys b
  JOIN definition_reference_compact_links l ON l.chunk_key = b.local_id
  WHERE b.chunk_id = c.id AND l.role IN (1, 2)
);
