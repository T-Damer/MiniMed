import type { SqlValue } from '@sqlite.org/sqlite-wasm';

export type SqlRow = Record<string, SqlValue>;

export function readString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`Expected string column: ${key}`);
  return value;
}

export function readNullableString(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError(`Expected nullable string column: ${key}`);
  return value;
}

export function readNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw new TypeError(`Expected number column: ${key}`);
  return value;
}

export function readNullableNumber(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') throw new TypeError(`Expected nullable number column: ${key}`);
  return value;
}

export function readBlob(row: SqlRow, key: string): Uint8Array {
  const value = row[key];
  if (!(value instanceof Uint8Array)) throw new TypeError(`Expected blob column: ${key}`);
  return value;
}
