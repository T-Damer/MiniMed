import { createSignal } from 'solid-js';

/**
 * The selection a reader asked the dictionary about. Readers (text documents, EPUB, the PDF text
 * layer) only publish it here; one sheet mounted at the app root answers, so no reader needs the
 * medical core and the sheet's code stays out of the start-up bundle until the first lookup.
 */
export interface ReaderDictionaryRequest {
  readonly id: number;
  readonly text: string;
}

const [request, setRequest] = createSignal<ReaderDictionaryRequest>();
let nextId = 0;

export const readerDictionaryRequest = request;

export function openReaderDictionary(text: string): void {
  nextId += 1;
  setRequest({ id: nextId, text });
}

export function closeReaderDictionary(): void {
  setRequest(undefined);
}
