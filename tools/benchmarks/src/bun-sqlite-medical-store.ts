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

    async searchVectors(_options: NativeVectorSearchOptions): Promise<NativeVectorSearchResult> {
      throw new Error('Vector search is unsupported: the ESKLP benchmark pack has no embeddings.');
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
