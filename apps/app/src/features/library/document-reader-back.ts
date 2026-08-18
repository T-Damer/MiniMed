import type { DocumentTrail } from '@/state/document-trail';

export function navigateDocumentReaderBack(
  trail: DocumentTrail | null | undefined,
  onNavigate: ((href: string) => void) | undefined,
): void {
  if (trail?.origin && onNavigate) {
    onNavigate(trail.origin.hash);
    return;
  }
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.hash = '#/modules/documents';
}
