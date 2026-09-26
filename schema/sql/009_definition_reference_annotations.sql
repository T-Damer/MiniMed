-- Original statement text stays in chunks, not in a second dictionary copy.
CREATE TABLE IF NOT EXISTS definition_reference_annotation_spans (
  id TEXT PRIMARY KEY NOT NULL,
  input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
  chunk_id TEXT NOT NULL REFERENCES chunks(id),
  kind TEXT NOT NULL CHECK (kind IN ('etymology', 'historical-mention')),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 256),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset > start_offset AND end_offset - start_offset <= 4096)
);
CREATE TABLE IF NOT EXISTS definition_reference_annotation_links (
  entity_id TEXT NOT NULL REFERENCES knowledge_entities(id),
  annotation_id TEXT NOT NULL REFERENCES definition_reference_annotation_spans(id),
  PRIMARY KEY (entity_id, annotation_id)
) WITHOUT ROWID;
