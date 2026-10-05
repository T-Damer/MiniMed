import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  CapacitorMedicalStore,
  type LocalMedDatabasePlugin,
  type NativeDatabaseHealth,
  type NativeQueryOptions,
  type NativeSqlRow,
  type NativeSqlValue,
  type NativeVectorSearchOptions,
  type NativeVectorSearchResult,
} from '@localmed/storage-capacitor';

interface NativeQuery {
  all(...parameters: NativeSqlValue[]): readonly unknown[];
  get(...parameters: NativeSqlValue[]): unknown;
}

interface NativeDatabase {
  query(sql: string): NativeQuery;
  close(): void;
}

interface BunSqliteModule {
  readonly Database: new (path: string, options: { readonly readonly: boolean }) => NativeDatabase;
}

function asRow(value: unknown): NativeSqlRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a SQLite object row.');
  }
  const values = Object.values(value as Record<string, unknown>);
  if (
    values.some(
      (item) =>
        item !== null &&
        typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isFinite(item)),
    )
  ) {
    throw new TypeError('SQLite row contains an unsupported value.');
  }
  return value as NativeSqlRow;
}

function asRows(values: readonly unknown[]): readonly NativeSqlRow[] {
  return values.map(asRow);
}

function readString(value: NativeSqlRow, key: string): string {
  const result = value[key];
  if (typeof result !== 'string') throw new TypeError(`Expected string column: ${key}`);
  return result;
}

function parseArgs(argsJson: NativeQueryOptions['argsJson']): readonly NativeSqlValue[] {
  if (argsJson === undefined) return [];
  let value: unknown;
  try {
    value = JSON.parse(argsJson);
  } catch (cause) {
    throw new TypeError('Native SQLite args must be valid JSON.', { cause });
  }
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        item !== null &&
        typeof item !== 'string' &&
        (typeof item !== 'number' || !Number.isFinite(item)),
    )
  ) {
    throw new TypeError('Native SQLite args must be an array of finite strings, numbers, or null.');
  }
  return value as NativeSqlValue[];
}

function scalar(
  database: NativeDatabase,
  sql: string,
  parameters: readonly NativeSqlValue[] = [],
): unknown {
  const value = database.query(sql).get(...parameters);
  if (value === undefined) return undefined;
  const values = Object.values(asRow(value));
  if (values.length !== 1) throw new TypeError('Expected one SQLite scalar column.');
  return values[0];
}

function finiteInteger(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`Expected a non-negative integer ${label}.`);
  }
  return number;
}

function readHealth(database: NativeDatabase, databasePath: string): NativeDatabaseHealth {
  const metadataSchemaVersion = scalar(
    database,
    "SELECT value FROM app_metadata WHERE key = 'schema_version' LIMIT 1",
  );
  const schemaVersion = finiteInteger(
    metadataSchemaVersion ?? scalar(database, 'SELECT schema_version FROM content_packs LIMIT 1'),
    'schema version',
  );
  const fts5Available =
    finiteInteger(
      scalar(database, "SELECT EXISTS(SELECT 1 FROM pragma_module_list WHERE name = 'fts5')"),
      'FTS5 flag',
    ) === 1;
  if (!fts5Available) throw new Error('SQLite was built without FTS5 support.');

  return {
    schemaVersion,
    sqliteVersion: String(scalar(database, 'SELECT sqlite_version()')),
    fts5Available,
    contentPackIds: asRows(database.query('SELECT id FROM content_packs ORDER BY id').all()).map(
      (value) => readString(value, 'id'),
    ),
    documentCount: finiteInteger(
      scalar(database, 'SELECT count(*) FROM documents'),
      'document count',
    ),
    databasePath,
    copied: false,
    sizeBytes: statSync(databasePath).size,
  };
}

interface ProfileVectors {
  readonly chunkIds: readonly string[];
  readonly values: Int8Array;
  readonly norms: Float64Array;
}

// One read per profile and file: the scan then runs over memory, like a warm native adapter.
const vectorCache = new WeakMap<NativeDatabase, Map<string, ProfileVectors>>();

function loadVectors(database: NativeDatabase, profileId: string): ProfileVectors {
  const byProfile = vectorCache.get(database) ?? new Map<string, ProfileVectors>();
  vectorCache.set(database, byProfile);
  const cached = byProfile.get(profileId);
  if (cached) return cached;
  const rows = database
    .query(
      'SELECT chunk_id, vector, vector_norm FROM chunk_embeddings WHERE profile_id = ? ORDER BY chunk_id',
    )
    .all(profileId) as { chunk_id: string; vector: Uint8Array; vector_norm: number }[];
  const dimensions = rows[0]?.vector.length ?? 0;
  const values = new Int8Array(rows.length * dimensions);
  rows.forEach((row, index) => {
    values.set(
      new Int8Array(row.vector.buffer, row.vector.byteOffset, dimensions),
      index * dimensions,
    );
  });
  const loaded = {
    chunkIds: rows.map((row) => row.chunk_id),
    values,
    norms: Float64Array.from(rows, (row) => row.vector_norm),
  };
  byProfile.set(profileId, loaded);
  return loaded;
}

function allowedChunkIds(
  database: NativeDatabase,
  options: NativeVectorSearchOptions,
): ReadonlySet<string> | null {
  if (!options.documentIds?.length && !options.sectionTypes?.length) return null;
  const clauses: string[] = [];
  const parameters: NativeSqlValue[] = [];
  if (options.documentIds?.length) {
    clauses.push('d.id IN (SELECT value FROM json_each(?))');
    parameters.push(JSON.stringify(options.documentIds));
  }
  if (options.sectionTypes?.length) {
    clauses.push('s.section_type IN (SELECT value FROM json_each(?))');
    parameters.push(JSON.stringify(options.sectionTypes));
  }
  const rows = database
    .query(
      `SELECT c.id AS id FROM chunks c
       JOIN sections s ON s.id = c.section_id
       JOIN documents d ON d.current_version_id = c.document_version_id
       WHERE ${clauses.join(' AND ')}`,
    )
    .all(...parameters) as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

export async function createBunFileMedicalStore(
  databasePathValue: string,
): Promise<CapacitorMedicalStore> {
  const databasePath = resolve(databasePathValue);
  const databaseName = basename(databasePath);
  const sqlite = (await import('bun:sqlite' as string)) as unknown as BunSqliteModule;
  let database: NativeDatabase | undefined;

  const plugin: LocalMedDatabasePlugin = {
    async openPack(options): Promise<NativeDatabaseHealth> {
      if (resolve(options.assetPath) !== databasePath) {
        throw new Error('The Bun benchmark plugin received an unexpected SQLite path.');
      }
      if (options.databaseName !== databaseName) {
        throw new Error('The Bun benchmark plugin received an unexpected SQLite name.');
      }
      if (database) return readHealth(database, databasePath);

      const opened = new sqlite.Database(databasePath, { readonly: true });
      database = opened;
      try {
        return readHealth(opened, databasePath);
      } catch (cause) {
        opened.close();
        database = undefined;
        throw cause;
      }
    },

    async query(options): Promise<{ readonly rows: readonly NativeSqlRow[] }> {
      if (!database) throw new Error('The Bun benchmark SQLite database is not open.');
      const args = parseArgs(options.argsJson);
      return { rows: asRows(database.query(options.sql).all(...args)) };
    },

    async searchVectors(options: NativeVectorSearchOptions): Promise<NativeVectorSearchResult> {
      if (!database) throw new Error('The Bun benchmark SQLite database is not open.');
      if (options.specialties?.length || options.ageGroups?.length) {
        throw new Error('The Bun benchmark vector scan does not apply metadata filters.');
      }
      const vectors = loadVectors(database, options.profileId);
      const allowed = allowedChunkIds(database, options);
      const query = new Int8Array(Buffer.from(options.vectorBase64, 'base64'));
      const hits: { chunkId: string; score: number }[] = [];
      for (const [index, chunkId] of vectors.chunkIds.entries()) {
        if (allowed && !allowed.has(chunkId)) continue;
        const norm = vectors.norms[index] ?? 0;
        if (norm === 0 || options.vectorNorm === 0) continue;
        let dot = 0;
        const offset = index * query.length;
        for (let dimension = 0; dimension < query.length; dimension += 1) {
          dot += (query[dimension] ?? 0) * (vectors.values[offset + dimension] ?? 0);
        }
        hits.push({ chunkId, score: dot / (options.vectorNorm * norm) });
      }
      return {
        hits: hits
          .toSorted(
            (left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId),
          )
          .slice(0, options.limit),
      };
    },

    async close(): Promise<void> {
      const opened = database;
      database = undefined;
      opened?.close();
    },
  };

  return new CapacitorMedicalStore({
    assetPath: databasePath,
    databaseName,
    // The production native bridge verifies this checksum; this direct local benchmark adapter
    // opens the caller-selected path and does not read the whole database just to hash it.
    expectedSha256: 'benchmark-direct-path-hash-not-validated',
    plugin,
  });
}
