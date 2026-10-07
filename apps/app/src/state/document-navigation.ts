import {
  knownDocumentTitle,
  OPENING_DOCUMENT_TITLE,
  rememberDocumentTitle,
} from '@/features/library/document-title-hints';
import { buildOfficialDocumentHash, type ExactDocumentIdentity } from '@/state/document-route';
import { appendDocumentCrumb, beginDocumentTrail, loadDocumentTrail } from '@/state/document-trail';
import { flushReaderPositions } from '@/state/history-entries';

export const OPEN_DOCUMENT_EVENT = 'minimed:open-document';
const PREFER_SUMMARY_KEY = 'minimed:document-prefer-summary';

export interface OpenDocumentRequest {
  readonly documentId: string;
  readonly anchor?: string | null;
  /** When true, keep summary cards instead of auto-opening installed full-text siblings. */
  readonly preferSummary?: boolean;
  readonly expectedIdentity?: ExactDocumentIdentity;
}

export interface OpenDocumentOverlayOptions {
  readonly preferSummary?: boolean;
  readonly expectedIdentity?: ExactDocumentIdentity;
  /** The document's name when the caller has it; otherwise the app's remembered catalog names. */
  readonly title?: string;
  /**
   * The reader is moving on from the document it shows to the one that stands in for it (a module
   * pointer that became its installed text): the new address takes the old one's history entry, so
   * back returns to where the user came from rather than to the redirecting route.
   */
  readonly replace?: boolean;
}

/**
 * Points the current history entry at another address and tells the app's route listeners (a
 * `replaceState` raises no `hashchange`). The entry keeps its state, so its stamp stays.
 */
export function replaceLocationHash(hash: string): void {
  const oldURL = window.location.href;
  window.history.replaceState(window.history.state, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
}

export function openDocumentOverlay(
  documentId: string,
  anchor: string | null = null,
  options: OpenDocumentOverlayOptions = {},
): void {
  if (options.title) rememberDocumentTitle(documentId, options.title);
  // The page being left keeps the place the reader had reached, for the way back.
  if (!options.replace) flushReaderPositions();
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
    // The name is known from the link, the card or the catalog before the text loads.
    title: knownDocumentTitle(documentId) ?? OPENING_DOCUMENT_TITLE,
    ...(anchor ? { section: anchor } : {}),
    ...(options.expectedIdentity ? { expectedIdentity: options.expectedIdentity } : {}),
  });

  const hash = buildOfficialDocumentHash(documentId, anchor ?? undefined, options.expectedIdentity);
  if (options.replace) {
    replaceLocationHash(hash);
    return;
  }
  window.location.hash = hash;
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
