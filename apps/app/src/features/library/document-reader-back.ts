import { type DocumentTrail, sliceTrailToCrumb } from '@/state/document-trail';
import { hasInAppPreviousEntry } from '@/state/history-entries';

export interface DocumentNavigateOptions {
  /** Take the current history entry instead of adding one (no way back to the page being left). */
  readonly replace?: boolean;
}

export type DocumentNavigate = (href: string, options?: DocumentNavigateOptions) => void;

/** Where the reader's back control returns to: the previous document of the trail, else its origin. */
export function documentReaderBackTarget(trail: DocumentTrail | null | undefined): string | null {
  if (!trail) return null;
  const previous = trail.crumbs.length > 1 ? trail.crumbs[trail.crumbs.length - 2] : undefined;
  return previous?.href ?? trail.origin.hash;
}

/**
 * The reader's own «Назад». It leaves the way the system back does: when an entry of this app lies
 * below the current one that entry *is* the place the reader returns to, so the history steps back
 * (a push of the previous address would grow the history with every press and send a later system
 * back to the document just left). Only when there is no such entry — a deep link, a reload of an
 * entry from an older build — the reader goes to the previous document or its origin by replacing
 * the current entry.
 */
export function navigateDocumentReaderBack(
  trail: DocumentTrail | null | undefined,
  onNavigate: DocumentNavigate | undefined,
): void {
  if (hasInAppPreviousEntry()) {
    window.history.back();
    return;
  }
  if (trail && trail.crumbs.length > 1 && onNavigate) {
    const previousIndex = trail.crumbs.length - 2;
    const previous = trail.crumbs[previousIndex];
    if (previous) {
      sliceTrailToCrumb(trail, previousIndex);
      onNavigate(previous.href, { replace: true });
      return;
    }
  }
  if (trail?.origin && onNavigate) {
    onNavigate(trail.origin.hash, { replace: true });
    return;
  }
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  if (onNavigate) onNavigate('#/modules/documents', { replace: true });
  else window.location.replace('#/modules/documents');
}
