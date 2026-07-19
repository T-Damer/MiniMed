CREATE TABLE IF NOT EXISTS embedding_profiles (
  id TEXT PRIMARY KEY,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  vector_format TEXT NOT NULL CHECK (vector_format = 'int8'),
  normalization TEXT NOT NULL CHECK (normalization = 'l2'),
  generator TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  profile_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  vector BLOB NOT NULL,
  vector_norm REAL NOT NULL CHECK (vector_norm >= 0),
  PRIMARY KEY (profile_id, chunk_id),
  FOREIGN KEY (profile_id) REFERENCES embedding_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_chunk ON chunk_embeddings(chunk_id);
