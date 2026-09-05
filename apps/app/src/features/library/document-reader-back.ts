import { type DocumentTrail, sliceTrailToCrumb } from '@/state/document-trail';

export function navigateDocumentReaderBack(
  trail: DocumentTrail | null | undefined,
  onNavigate: ((href: string) => void) | undefined,
): void {
  if (trail && trail.crumbs.length > 1 && onNavigate) {
    const previousIndex = trail.crumbs.length - 2;
    const previous = trail.crumbs[previousIndex];
    if (previous) {
      sliceTrailToCrumb(trail, previousIndex);
      onNavigate(previous.href);
      return;
    }
  }
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
