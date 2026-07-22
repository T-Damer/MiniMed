export const OPEN_DOCUMENT_EVENT = 'minimed:open-document';

export function openDocumentInArchive(documentId: string): void {
  window.history.replaceState({ view: 'documents' }, '', '#/documents');
  window.dispatchEvent(new CustomEvent<string>(OPEN_DOCUMENT_EVENT, { detail: documentId }));
}
