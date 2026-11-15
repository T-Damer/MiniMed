import { createSignal } from 'solid-js';

import { parseDocumentReadRoute } from '@/state/document-route';

/**
 * The selection a reader asked the dictionary about. Readers (text documents, EPUB, the PDF text
 * layer) only publish it here; one sheet mounted at the app root answers, so no reader needs the
 * medical core and the sheet's code stays out of the start-up bundle until the first lookup.
 */
export interface ReaderDictionaryRequest {
  readonly id: number;
  readonly text: string;
  /** The document being read, when it is one of the library's: its own terms answer first. */
  readonly documentId?: string;
}

const [request, setRequest] = createSignal<ReaderDictionaryRequest>();
let nextId = 0;

export const readerDictionaryRequest = request;

export function openReaderDictionary(text: string): void {
  nextId += 1;
  const route = parseDocumentReadRoute(window.location.hash);
  setRequest({
    id: nextId,
    text,
    ...(route?.kind === 'official' ? { documentId: route.documentId } : {}),
  });
}

export function closeReaderDictionary(): void {
  setRequest(undefined);
}
