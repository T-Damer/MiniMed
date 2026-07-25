export const OPEN_DOCUMENT_EVENT = 'minimed:open-document';

export interface OpenDocumentRequest {
  readonly documentId: string;
  readonly anchor?: string | null;
  /** When true, keep summary cards instead of auto-opening installed full-text siblings. */
  readonly preferSummary?: boolean;
}

export function openDocumentOverlay(
  documentId: string,
  anchor: string | null = null,
  options: { readonly preferSummary?: boolean } = {},
): void {
  window.dispatchEvent(
    new CustomEvent<OpenDocumentRequest>(OPEN_DOCUMENT_EVENT, {
      detail: { documentId, anchor, preferSummary: options.preferSummary ?? false },
    }),
  );
}

/** @deprecated Use openDocumentOverlay. Kept for call-site compatibility. */
export function openDocumentInArchive(documentId: string, anchor: string | null = null): void {
  openDocumentOverlay(documentId, anchor);
}
