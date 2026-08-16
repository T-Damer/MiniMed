CREATE TABLE IF NOT EXISTS tool_definitions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('calculator', 'assessment')),
  version TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_title TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  bank_id TEXT NOT NULL,
  bank_label TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_minutes INTEGER,
  audience TEXT NOT NULL,
  definition_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_sources (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('clinical-recommendation', 'literature', 'guideline', 'regulatory')
  ),
  relation TEXT NOT NULL CHECK (relation IN ('methodology', 'interpretation', 'clinical-context')),
  title TEXT NOT NULL,
  module_id TEXT,
  document_id TEXT,
  url TEXT,
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (tool_id) REFERENCES tool_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_definitions_kind_category
  ON tool_definitions(kind, category);
CREATE INDEX IF NOT EXISTS idx_tool_sources_tool
  ON tool_sources(tool_id);
