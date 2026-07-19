PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_packs (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  checksum TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  content_pack_id TEXT NOT NULL,
  title TEXT NOT NULL,
  short_title TEXT,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL,
  specialty_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  FOREIGN KEY (content_pack_id) REFERENCES content_packs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_label TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  source_checksum TEXT NOT NULL,
  extracted_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL,
  parent_section_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  section_type TEXT,
  depth INTEGER NOT NULL CHECK (depth >= 1),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  page_start INTEGER,
  page_end INTEGER,
  anchor TEXT NOT NULL UNIQUE,
  path_json TEXT NOT NULL,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_section_id) REFERENCES sections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  original_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  char_start INTEGER,
  char_end INTEGER,
  previous_chunk_id TEXT,
  next_chunk_id TEXT,
  anchor TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_chunk_id) REFERENCES chunks(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (next_chunk_id) REFERENCES chunks(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  canonical_term TEXT NOT NULL,
  alias TEXT NOT NULL,
  category TEXT,
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight > 0)
);

CREATE INDEX IF NOT EXISTS idx_documents_content_pack ON documents(content_pack_id);
CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_sections_version_order ON sections(document_version_id, order_index);
CREATE INDEX IF NOT EXISTS idx_chunks_version_order ON chunks(document_version_id, order_index);
CREATE INDEX IF NOT EXISTS idx_chunks_section_order ON chunks(section_id, order_index);
CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  document_version_id UNINDEXED,
  section_id UNINDEXED,
  anchor UNINDEXED,
  title,
  section_path,
  normalized_text,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
