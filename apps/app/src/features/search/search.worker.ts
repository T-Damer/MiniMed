/// <reference lib="webworker" />

import type { MedicalCore } from '@localmed/contracts';

import { createBrowserWorkerCore } from '@/composition/create-browser-core';
import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '@/features/search/search-worker-protocol';

let core: Promise<MedicalCore> | undefined;

self.onmessage = async (event: MessageEvent<SearchWorkerRequest>): Promise<void> => {
  const message = event.data;
  try {
    core ??= createBrowserWorkerCore(message.contentBaseUrl);
    const activeCore = await core;
    const result =
      message.method === 'search'
        ? await activeCore.search(message.request)
        : await activeCore.analyzeQuery(message.request);
    self.postMessage({ id: message.id, result } satisfies SearchWorkerResponse);
  } catch (cause) {
    self.postMessage({
      id: message.id,
      error: cause instanceof Error ? cause.message : 'Фоновый поиск не запустился.',
    } satisfies SearchWorkerResponse);
  }
};
