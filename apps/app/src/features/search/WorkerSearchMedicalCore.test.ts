import type { MedicalCore } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import { WorkerSearchMedicalCore } from '@/features/search/WorkerSearchMedicalCore';

const CAPABILITIES = {
  lexicalSearch: true as const,
  queryAnalysis: true as const,
  semanticSearch: false,
  embeddingProfileIds: [],
  cloudChat: false as const,
  localCaseExtraction: true,
  platform: 'test' as const,
  sqliteVersion: 'test',
  fts5Available: true,
  storageBackend: 'in-memory' as const,
  persistentStorage: false,
  storageInstallation: 'memory' as const,
  storageSizeBytes: null,
};

describe('WorkerSearchMedicalCore', () => {
  it('falls back to the application core when Web Workers are unavailable', async () => {
    const response = { ok: false as const, error: { code: 'UNKNOWN' as const, message: 'base' } };
    const search = vi.fn(async () => response);
    const analyzeQuery = vi.fn(async () => response);
    const getCapabilities = vi.fn(async () => ({ ok: true as const, value: CAPABILITIES }));
    const base = { search, analyzeQuery, getCapabilities } as unknown as MedicalCore;
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

  it('keeps search on the connected backend when it does not expose MiniMed case extraction', async () => {
    const postMessage = vi.fn();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      vi.fn(function FakeWorker(this: Record<string, unknown>) {
        this['postMessage'] = postMessage;
        this['terminate'] = terminate;
      }),
    );
    try {
      const response = {
        ok: false as const,
        error: { code: 'UNKNOWN' as const, message: 'external' },
      };
      const search = vi.fn(async () => response);
      const getCapabilities = vi.fn(async () => ({
        ok: true as const,
        value: { ...CAPABILITIES, localCaseExtraction: false },
      }));
      const base = { search, getCapabilities } as unknown as MedicalCore;
      const core = new WorkerSearchMedicalCore(base);

      await expect(
        core.search({
          query: 'грудничок свистит при дыхании',
          mode: 'hybrid',
          filters: {},
          limit: 5,
          includeSuggestions: false,
        }),
      ).resolves.toEqual(response);

      expect(getCapabilities).toHaveBeenCalledOnce();
      expect(search).toHaveBeenCalledOnce();
      expect(postMessage).not.toHaveBeenCalled();
      await core.close();
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
