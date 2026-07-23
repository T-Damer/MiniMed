export const OPEN_DOCUMENT_EVENT = 'minimed:open-document';

export interface OpenDocumentRequest {
  readonly documentId: string;
  readonly anchor?: string | null;
}

export function openDocumentOverlay(documentId: string, anchor: string | null = null): void {
  window.dispatchEvent(
    new CustomEvent<OpenDocumentRequest>(OPEN_DOCUMENT_EVENT, {
      detail: { documentId, anchor },
    }),
  );
}

/** @deprecated Use openDocumentOverlay. Kept for call-site compatibility. */
export function openDocumentInArchive(documentId: string, anchor: string | null = null): void {
  openDocumentOverlay(documentId, anchor);
}
