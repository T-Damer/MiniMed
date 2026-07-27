import type { MedicalCore } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import { WorkerSearchMedicalCore } from '@/features/search/WorkerSearchMedicalCore';

describe('WorkerSearchMedicalCore', () => {
  it('falls back to the application core when Web Workers are unavailable', async () => {
    const response = { ok: false as const, error: { code: 'UNKNOWN' as const, message: 'base' } };
    const search = vi.fn(async () => response);
    const analyzeQuery = vi.fn(async () => response);
    const base = { search, analyzeQuery } as unknown as MedicalCore;
    const core = new WorkerSearchMedicalCore(base);

    await expect(
      core.search({
        query: 'test',
        mode: 'lexical',
        filters: {},
        limit: 10,
        includeSuggestions: true,
      }),
    ).resolves.toEqual(response);
    await core.analyzeQuery({ query: 'test', includeSuggestions: true });

    expect(search).toHaveBeenCalledOnce();
    expect(analyzeQuery).toHaveBeenCalledOnce();
  });
});
