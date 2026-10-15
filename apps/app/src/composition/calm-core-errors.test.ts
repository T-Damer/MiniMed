import type { LocalMedError, MedicalCore } from '@localmed/contracts';
import { err, localMedError, ok } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CORE_READ_FAILED_MESSAGE,
  calmCoreError,
  isCoreReadFailure,
  withCalmCoreErrors,
} from '@/composition/calm-core-errors';

afterEach(() => vi.restoreAllMocks());

const RAW = 'SQLITE_NOMEM: sqlite3 result code 7: out of memory';

describe('calmCoreError', () => {
  it('replaces the words of the storage engine and keeps them in the details', () => {
    const calm = calmCoreError(
      localMedError('DATABASE_UNAVAILABLE', RAW, { name: 'SQLite3Error' }),
    );
    expect(calm.message).toBe(CORE_READ_FAILED_MESSAGE);
    expect(calm.code).toBe('DATABASE_UNAVAILABLE');
    expect(calm.details).toEqual({ name: 'SQLite3Error', raw: RAW });
    expect(isCoreReadFailure(calm.message)).toBe(true);
  });

  it('also calms an unknown failure and a missing FTS5, but not a request or a missing document', () => {
    expect(calmCoreError(localMedError('UNKNOWN', 'x')).message).toBe(CORE_READ_FAILED_MESSAGE);
    expect(calmCoreError(localMedError('FTS5_UNAVAILABLE', 'FTS5 gone')).message).toBe(
      CORE_READ_FAILED_MESSAGE,
    );
    const request = localMedError('INVALID_REQUEST', 'Search query has no searchable terms.');
    expect(calmCoreError(request)).toBe(request);
    const missing = localMedError('CONTENT_NOT_FOUND', 'Document not found: x');
    expect(calmCoreError(missing)).toBe(missing);
  });
});

describe('withCalmCoreErrors', () => {
  it('rewrites a failed result of any method and passes the rest through untouched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure: LocalMedError = localMedError('DATABASE_UNAVAILABLE', RAW);
    const core = {
      search: async () => err(failure),
      getDocument: async () => err(localMedError('CONTENT_NOT_FOUND', 'Document not found: d')),
      initialize: async () => ok({ state: 'ready' }),
      close: async () => undefined,
    } as unknown as MedicalCore;
    const calm = withCalmCoreErrors(core);

    const searched = await calm.search({} as never);
    expect(searched.ok).toBe(false);
    if (!searched.ok) {
      expect(searched.error.message).toBe(CORE_READ_FAILED_MESSAGE);
      expect(searched.error.message).not.toMatch(/sqlite/iu);
    }
    const missing = await calm.getDocument('d');
    expect(!missing.ok && missing.error.message).toBe('Document not found: d');
    expect((await calm.initialize()).ok).toBe(true);
    await expect(calm.close()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
