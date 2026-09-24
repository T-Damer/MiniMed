-- Optional, source-local reference projection. The ordinary clinical FTS is unchanged.
CREATE INDEX IF NOT EXISTS idx_knowledge_document_links_chunk_review
  ON knowledge_document_links(chunk_id, review_status, link_type, entity_id);

CREATE VIEW IF NOT EXISTS definition_reference_content AS
SELECT c.rowid AS rowid, c.original_text AS original_text
FROM chunks c
WHERE EXISTS (
  SELECT 1 FROM knowledge_document_links l
  WHERE l.chunk_id = c.id AND l.review_status = 'proposed'
    AND l.link_type IN ('reference:definition', 'reference:item')
);

CREATE VIRTUAL TABLE IF NOT EXISTS definition_reference_fts USING fts5(
  original_text,
  content = 'definition_reference_content',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '3 4'
);
