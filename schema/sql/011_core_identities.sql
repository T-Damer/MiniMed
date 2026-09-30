-- Exact source identities only. These names never enter chunks_fts.
CREATE TABLE IF NOT EXISTS core_identity_targets (
  target_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  coverage TEXT NOT NULL,
  target_json TEXT NOT NULL CHECK (json_valid(target_json)),
  PRIMARY KEY (target_id, module_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS core_identities (
  normalized_name TEXT NOT NULL,
  name TEXT NOT NULL,
  target_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  PRIMARY KEY (normalized_name, target_id, module_id),
  FOREIGN KEY (target_id, module_id) REFERENCES core_identity_targets(target_id, module_id)
    ON DELETE CASCADE
) WITHOUT ROWID;
