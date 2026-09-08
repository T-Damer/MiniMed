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
    await expect(core.analyzeQuery({ query: 'test', includeSuggestions: true })).resolves.toEqual(
      RESPONSE,
    );

    expect(search).toHaveBeenCalledOnce();
    expect(analyzeQuery).toHaveBeenCalledOnce();
  });

  it('keeps direct-only search on the connected backend without constructing a worker', async () => {
    const postMessage = vi.fn();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      vi.fn(function FakeWorker(this: {
        postMessage: typeof postMessage;
        terminate: typeof terminate;
      }) {
        this.postMessage = postMessage;
        this.terminate = terminate;
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
    expect(Worker).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();

    await core.close();
    expect(terminate).not.toHaveBeenCalled();
  });

  it('does not construct a worker before the first request', async () => {
    const postMessage = vi.fn();
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      vi.fn(function FakeWorker(this: {
        postMessage: typeof postMessage;
        terminate: typeof terminate;
      }) {
        this.postMessage = postMessage;
        this.terminate = terminate;
      }),
    );

    const search = vi.fn(async () => RESPONSE);
    const getCapabilities = vi.fn(async () => ({
      ok: true as const,
      value: { ...CAPABILITIES, searchExecution: 'worker-compatible' as const },
    }));
    const base = { search, getCapabilities } as unknown as MedicalCore;
    const core = new WorkerSearchMedicalCore(base);

    expect(Worker).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();

    await core.close();
    expect(terminate).not.toHaveBeenCalled();
  });

  it('starts one browser worker lazily and delivers its response', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } });
    const terminate = vi.fn();
    class FakeWorker {
      onmessage?: (event: { data: { id: number; result: typeof RESPONSE } }) => void;
      terminate = terminate;
      postMessage(message: { id: number }): void {
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: RESPONSE } }));
      }
    }
    const workerConstructor = vi.fn(function createWorker() {
      return new FakeWorker();
    });
    vi.stubGlobal('Worker', workerConstructor);
    const getCapabilities = vi.fn(async () => ({ ok: true as const, value: CAPABILITIES }));
    const analyzeQuery = vi.fn(async () => RESPONSE);
    const core = new WorkerSearchMedicalCore({
      getCapabilities,
      analyzeQuery,
    } as unknown as MedicalCore);
    expect(workerConstructor).not.toHaveBeenCalled();
    const request = { query: 'отит', includeSuggestions: true };
    expect(await Promise.all([core.analyzeQuery(request), core.analyzeQuery(request)])).toEqual([
      RESPONSE,
      RESPONSE,
    ]);
    expect(workerConstructor).toHaveBeenCalledOnce();
    expect(getCapabilities).toHaveBeenCalledOnce();
    expect(analyzeQuery).not.toHaveBeenCalled();
    await core.close();
    expect(terminate).toHaveBeenCalledOnce();
  });
});
