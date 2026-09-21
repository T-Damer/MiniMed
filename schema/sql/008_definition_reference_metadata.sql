-- Optional verbatim metadata fragments for immutable reference editions only.
-- No source text or external identity is changed. Readers opt in via the manifest.
CREATE TABLE IF NOT EXISTS definition_reference_metadata_fragments (
  local_id INTEGER PRIMARY KEY CHECK (local_id > 0),
  fragment TEXT NOT NULL CHECK (length(fragment) BETWEEN 1 AND 65536)
);
CREATE TABLE IF NOT EXISTS definition_reference_metadata_programs (
  chunk_key INTEGER PRIMARY KEY,
  program_json TEXT NOT NULL CHECK (
    length(program_json) <= 65536 AND json_valid(program_json)
    AND json_type(program_json) = 'array'
    AND json_array_length(program_json) BETWEEN 1 AND 128
  ),
  FOREIGN KEY (chunk_key) REFERENCES definition_reference_chunk_keys(local_id) ON DELETE CASCADE
);

-- Each program is an ordered array: text = literal bytes, integer = shared quoted
-- JSON string token. Missing/invalid references return NULL, never partial metadata.
CREATE VIEW IF NOT EXISTS definition_reference_chunks AS
SELECT c.id, c.document_version_id, c.section_id, c.order_index,
       c.original_text, c.normalized_text, c.page_start, c.page_end,
       c.char_start, c.char_end, c.previous_chunk_id, c.next_chunk_id, c.anchor,
       CASE WHEN c.metadata_json = '{"$p":1}' THEN (
         SELECT CASE WHEN count(*) > 0 AND count(*) = count(piece)
                THEN group_concat(piece, '') ELSE NULL END
         FROM (
           SELECT CASE j.type WHEN 'text' THEN j.value
                    WHEN 'integer' THEN d.fragment ELSE NULL END AS piece
           FROM definition_reference_metadata_programs p,
                json_each(p.program_json) j
           LEFT JOIN definition_reference_metadata_fragments d
             ON j.type = 'integer' AND d.local_id = j.value
           WHERE p.chunk_key = k.local_id
           ORDER BY CAST(j.key AS INTEGER)
         )
       ) ELSE c.metadata_json END AS metadata_json
FROM chunks c
LEFT JOIN definition_reference_chunk_keys k ON k.chunk_id = c.id;
