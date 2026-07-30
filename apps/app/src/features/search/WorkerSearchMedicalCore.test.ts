import type { CoreCapabilities, MedicalCore } from '@localmed/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkerSearchMedicalCore } from '@/features/search/WorkerSearchMedicalCore';

const CAPABILITIES: CoreCapabilities = {
  lexicalSearch: true,
  queryAnalysis: true,
  semanticSearch: false,
  embeddingProfileIds: [],
  cloudChat: false,
  localCaseExtraction: true,
  platform: 'test',
  sqliteVersion: 'test',
  fts5Available: true,
  storageBackend: 'in-memory',
  persistentStorage: false,
  storageInstallation: 'memory',
  storageSizeBytes: null,
};

const RESPONSE = {
  ok: false as const,
  error: { code: 'UNKNOWN' as const, message: 'base' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkerSearchMedicalCore', () => {
  it('falls back to the application core when Web Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const search = vi.fn(async () => RESPONSE);
    const analyzeQuery = vi.fn(async () => RESPONSE);
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
    ).resolves.toEqual(RESPONSE);
    await expect(
      core.analyzeQuery({ query: 'test', includeSuggestions: true }),
    ).resolves.toEqual(RESPONSE);

    expect(search).toHaveBeenCalledOnce();
    expect(analyzeQuery).toHaveBeenCalledOnce();
  });

  it('keeps direct-only search on the connected backend and releases the unused worker', async () => {
    const postMessage = vi.fn();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      vi.fn(function FakeWorker(this: Record<string, unknown>) {
        this['postMessage'] = postMessage;
        this['terminate'] = terminate;
      }),
    );

    const search = vi.fn(async () => RESPONSE);
    const getCapabilities = vi.fn(async () => ({
      ok: true as const,
      value: { ...CAPABILITIES, searchExecution: 'direct-only' as const },
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
    ).resolves.toEqual(RESPONSE);

    expect(getCapabilities).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
    expect(terminate).toHaveBeenCalledOnce();

    await core.close();
    expect(terminate).toHaveBeenCalledOnce();
  });
});
