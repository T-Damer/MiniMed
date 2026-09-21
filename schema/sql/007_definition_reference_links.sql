-- Physical keys for source-local reference navigation, not new canonical concept IDs.
-- Ordinary knowledge_document_links and its clinical consumers remain unchanged.
CREATE TABLE IF NOT EXISTS definition_reference_entity_keys (
  local_id INTEGER PRIMARY KEY,
  entity_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS definition_reference_chunk_keys (
  local_id INTEGER PRIMARY KEY,
  chunk_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS definition_reference_compact_links (
  entity_key INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 1000000),
  chunk_key INTEGER NOT NULL,
  role INTEGER NOT NULL CHECK (role BETWEEN 1 AND 4),
  PRIMARY KEY (entity_key, ordinal),
  FOREIGN KEY (entity_key) REFERENCES definition_reference_entity_keys(local_id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_key) REFERENCES definition_reference_chunk_keys(local_id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_definition_reference_compact_chunk
  ON definition_reference_compact_links(chunk_key, role, entity_key);

CREATE VIEW IF NOT EXISTS definition_reference_links AS
SELECT id, entity_id, document_id, document_version_id, section_id, chunk_id,
       link_type, weight, review_status, metadata_json FROM knowledge_document_links
UNION ALL
SELECT e.entity_id || '.reference.' || printf('%06d', l.ordinal), e.entity_id,
       v.document_id, c.document_version_id, c.section_id, c.id,
       'reference:' || CASE l.role WHEN 1 THEN 'definition' WHEN 2 THEN 'item'
         WHEN 3 THEN 'context' ELSE 'annotation' END,
       1.0, 'proposed',
       json_object('ordinal', l.ordinal, 'role',
         CASE l.role WHEN 1 THEN 'definition' WHEN 2 THEN 'item'
           WHEN 3 THEN 'context' ELSE 'annotation' END)
FROM definition_reference_compact_links l
JOIN definition_reference_entity_keys e ON e.local_id = l.entity_key
JOIN definition_reference_chunk_keys b ON b.local_id = l.chunk_key
JOIN chunks c ON c.id = b.chunk_id
JOIN document_versions v ON v.id = c.document_version_id;

DROP VIEW IF EXISTS definition_reference_content;
CREATE VIEW definition_reference_content AS
SELECT c.rowid AS rowid, c.original_text AS original_text
FROM chunks c
WHERE EXISTS (
  SELECT 1 FROM knowledge_document_links l
  WHERE l.chunk_id = c.id AND l.review_status = 'proposed'
    AND l.link_type IN ('reference:definition', 'reference:item')
) OR EXISTS (
  SELECT 1 FROM definition_reference_chunk_keys b
  JOIN definition_reference_compact_links l ON l.chunk_key = b.local_id
  WHERE b.chunk_id = c.id AND l.role IN (1, 2)
);
