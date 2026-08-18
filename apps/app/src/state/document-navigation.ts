import { buildOfficialDocumentHash } from '@/state/document-route';
import { appendDocumentCrumb, beginDocumentTrail, loadDocumentTrail } from '@/state/document-trail';

export const OPEN_DOCUMENT_EVENT = 'minimed:open-document';
const PREFER_SUMMARY_KEY = 'minimed:document-prefer-summary';

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
  if (options.preferSummary) {
    sessionStorage.setItem(PREFER_SUMMARY_KEY, documentId);
  } else {
    sessionStorage.removeItem(PREFER_SUMMARY_KEY);
  }

  let trail = loadDocumentTrail();
  if (!trail || trail.crumbs.length === 0) {
    trail = beginDocumentTrail('official');
  }
  appendDocumentCrumb(trail, {
    kind: 'official',
    id: documentId,
    title: 'Открываем документ',
    ...(anchor ? { section: anchor } : {}),
  });

  window.location.hash = anchor
    ? buildOfficialDocumentHash(documentId, anchor)
    : buildOfficialDocumentHash(documentId);
}

export function consumePreferSummaryDocumentId(): string | null {
  const value = sessionStorage.getItem(PREFER_SUMMARY_KEY);
  sessionStorage.removeItem(PREFER_SUMMARY_KEY);
  return value;
}

/** @deprecated Use openDocumentOverlay. Kept for call-site compatibility. */
export function openDocumentInArchive(documentId: string, anchor: string | null = null): void {
  openDocumentOverlay(documentId, anchor);
}

export function buildDocumentSectionLink(documentId: string, sectionAnchor: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${buildOfficialDocumentHash(documentId, sectionAnchor)}`;
}
