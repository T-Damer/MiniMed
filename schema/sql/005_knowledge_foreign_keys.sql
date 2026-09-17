CREATE INDEX IF NOT EXISTS idx_knowledge_names_entity
  ON knowledge_names(entity_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_fact
  ON knowledge_evidence(fact_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_relation
  ON knowledge_evidence(relation_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_document
  ON knowledge_evidence(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_version
  ON knowledge_evidence(document_version_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_section
  ON knowledge_evidence(section_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_links_document
  ON knowledge_document_links(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_links_version
  ON knowledge_document_links(document_version_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_links_section
  ON knowledge_document_links(section_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_links_chunk
  ON knowledge_document_links(chunk_id);
CREATE INDEX IF NOT EXISTS idx_sections_parent
  ON sections(parent_section_id);
CREATE INDEX IF NOT EXISTS idx_chunks_previous
  ON chunks(previous_chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunks_next
  ON chunks(next_chunk_id);
