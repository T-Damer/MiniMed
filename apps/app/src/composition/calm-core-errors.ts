import type { LocalMedError, MedicalCore } from '@localmed/contracts';
import { localMedError } from '@localmed/contracts';

/**
 * What the doctor reads when the core could not read its database. One calm line, never the
 * storage engine's own words («SQLITE_NOMEM: sqlite3 result code 7: out of memory»).
 */
export const CORE_READ_FAILED_MESSAGE = 'Не удалось прочитать базу. Повторите попытку.';

/** Failures of the storage layer; the rest of the core's errors already say something useful. */
const STORAGE_FAILURE_CODES: ReadonlySet<LocalMedError['code']> = new Set([
  'DATABASE_UNAVAILABLE',
  'FTS5_UNAVAILABLE',
  'UNKNOWN',
]);

/** True for the calm message above, so a screen can offer «Повторить» beside it. */
export function isCoreReadFailure(message: string): boolean {
  return message === CORE_READ_FAILED_MESSAGE;
}

/**
 * The same error with a message fit for the screen. The engine's text moves to `details.raw` (for
 * a console, a bug report) and is logged once per kind; the code stays, so callers can still tell a
 * failed read from a missing document.
 */
export function calmCoreError(error: LocalMedError): LocalMedError {
  if (!STORAGE_FAILURE_CODES.has(error.code) || error.message === CORE_READ_FAILED_MESSAGE) {
    return error;
  }
  return localMedError(error.code, CORE_READ_FAILED_MESSAGE, {
    ...error.details,
    raw: error.message,
  });
}

function isResult(value: unknown): value is { readonly ok: boolean; readonly error?: unknown } {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

function calmResult(value: unknown): unknown {
  if (!isResult(value) || value.ok || typeof value.error !== 'object' || value.error === null) {
    return value;
  }
  const error = value.error as LocalMedError;
  if (typeof error.message !== 'string') return value;
  const calm = calmCoreError(error);
  if (calm !== error) console.warn('The medical core could not read its database.', error);
  return calm === error ? value : { ...value, error: calm };
}

/**
 * Wraps a core so every failed result of a storage fault carries `CORE_READ_FAILED_MESSAGE`. One
 * place for the whole app: each screen shows `error.message` as it is, so none can leak a raw
 * SQLite error.
 */
export function withCalmCoreErrors<T extends MedicalCore>(core: T): T {
  return new Proxy(core, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: readonly unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, target, args);
        return result instanceof Promise ? result.then(calmResult) : result;
      };
    },
  });
}
