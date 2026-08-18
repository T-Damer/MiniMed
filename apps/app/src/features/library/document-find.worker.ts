/// <reference lib="webworker" />

import { type DocumentFindUnit, findInUnits } from '@/features/library/document-find';
import type {
  DocumentFindWorkerRequest,
  DocumentFindWorkerResponse,
} from '@/features/library/document-find-protocol';

let units: readonly DocumentFindUnit[] = [];

self.onmessage = (event: MessageEvent<DocumentFindWorkerRequest>): void => {
  const message = event.data;
  try {
    if (message.type === 'set-units') {
      units = message.units;
      return;
    }
    const matches = findInUnits(units, message.query, message.mode);
    self.postMessage({ id: message.id, matches } satisfies DocumentFindWorkerResponse);
  } catch (cause) {
    self.postMessage({
      id: message.id,
      error: cause instanceof Error ? cause.message : 'Поиск в документе не выполнен.',
    } satisfies DocumentFindWorkerResponse);
  }
};
