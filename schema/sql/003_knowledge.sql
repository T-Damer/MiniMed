CREATE TABLE IF NOT EXISTS knowledge_entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  external_ids_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_names (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  language TEXT NOT NULL,
  name_type TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight > 0 AND weight <= 2),
  FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS medication_profiles (
  entity_id TEXT PRIMARY KEY,
  concept_level TEXT NOT NULL,
  inn TEXT,
  atc_code TEXT,
  dosage_form TEXT,
  route TEXT,
  strength TEXT,
  registration_number TEXT,
  registration_status TEXT,
  pediatric_status TEXT,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_facts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  original_text TEXT NOT NULL,
  structured_json TEXT NOT NULL,
  population_json TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  authority_tier TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('proposed', 'reviewed', 'rejected')),
  jurisdiction TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  valid_from TEXT,
  valid_to TEXT,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_relations (
  id TEXT PRIMARY KEY,
  subject_entity_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_entity_id TEXT NOT NULL,
  relation_status TEXT NOT NULL,
  authority_tier TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('proposed', 'reviewed', 'rejected')),
  jurisdiction TEXT NOT NULL,
  final_weight REAL NOT NULL CHECK (final_weight >= 0 AND final_weight <= 1),
  weight_components_json TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (subject_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (object_entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_evidence (
  id TEXT PRIMARY KEY,
  fact_id TEXT,
  relation_id TEXT,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  evidence_quote TEXT NOT NULL,
  source_locator_json TEXT NOT NULL,
  CHECK ((fact_id IS NOT NULL) != (relation_id IS NOT NULL)),
  FOREIGN KEY (fact_id) REFERENCES knowledge_facts(id) ON DELETE CASCADE,
  FOREIGN KEY (relation_id) REFERENCES knowledge_relations(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_document_links (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  section_id TEXT,
  chunk_id TEXT,
  link_type TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0 AND weight <= 1),
  review_status TEXT NOT NULL CHECK (review_status IN ('proposed', 'reviewed', 'rejected')),
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_review_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  target_id TEXT,
  question TEXT NOT NULL,
  missing_fields_json TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority >= 0 AND priority <= 100),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  metadata_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entities_type_name
  ON knowledge_entities(entity_type, normalized_name);
CREATE INDEX IF NOT EXISTS idx_knowledge_names_normalized
  ON knowledge_names(normalized_name);
CREATE INDEX IF NOT EXISTS idx_knowledge_facts_entity_type
  ON knowledge_facts(entity_id, fact_type, review_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_subject
  ON knowledge_relations(subject_entity_id, predicate, review_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_object
  ON knowledge_relations(object_entity_id, predicate, review_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_chunk
  ON knowledge_evidence(chunk_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_links_entity
  ON knowledge_document_links(entity_id, review_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_review_tasks_status_priority
  ON knowledge_review_tasks(status, priority DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  entity_id UNINDEXED,
  canonical_name,
  aliases,
  facts,
  relations,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
