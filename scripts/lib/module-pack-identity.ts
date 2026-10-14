/**
 * The identity of a finished module pack (`content_packs` row, the current version of every
 * document) and the source-set digest the catalog records for it: shared by the packaging scripts.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';

export interface DocumentIdentity {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly sourceChecksum: string;
}

export interface PackIdentity {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly packChecksum: string;
  readonly documents: readonly DocumentIdentity[];
  readonly instructionKinds: Readonly<Record<string, number>>;
}

export function readPackIdentity(path: string): PackIdentity {
  const database = new Database(path, { readonly: true });
  try {
    const packs = database
      .query('SELECT id, version, title, checksum AS packChecksum FROM content_packs')
      .all() as Array<{ id: string; version: string; title: string; packChecksum: string }>;
    if (packs.length !== 1 || !packs[0]) throw new Error(`${path}: expected exactly one pack.`);
    const rows = database
      .query(
        `SELECT d.id AS documentId, dv.id AS documentVersionId, dv.source_checksum AS sourceChecksum
         FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id
         ORDER BY d.id, dv.id`,
      )
      .all() as DocumentIdentity[];
    const kinds: Record<string, number> = {};
    for (const row of database
      .query(
        `SELECT json_extract(metadata_json, '$.documentKind') AS kind, count(*) AS n
         FROM documents GROUP BY 1`,
      )
      .all() as Array<{ kind: string | null; n: number }>) {
      kinds[row.kind ?? 'none'] = row.n;
    }
    // Copy the strings out of the result rows: Bun 1.2 can leave row strings backed by SQLite memory, and a
    // pack id read here was seen to change after later databases were opened (duplicate catalog ids).
    return JSON.parse(
      JSON.stringify({ ...packs[0], documents: rows, instructionKinds: kinds }),
    ) as PackIdentity;
  } finally {
    database.close();
  }
}

/** The digest of `esklp_release.py`: sorted identities as compact JSON. */
export function sourceSetDigest(documents: readonly DocumentIdentity[]): string {
  const sorted = [...documents].sort((a, b) =>
    a.documentId === b.documentId
      ? a.documentVersionId < b.documentVersionId
        ? -1
        : 1
      : a.documentId < b.documentId
        ? -1
        : 1,
  );
  const payload = sorted.map((item) => ({
    documentId: item.documentId,
    documentVersionId: item.documentVersionId,
    sourceChecksum: item.sourceChecksum,
  }));
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}
