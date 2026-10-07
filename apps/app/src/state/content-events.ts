import { bumpSearchContentRevision } from '@/state/search-result-cache';

export const CONTENT_CHANGED_EVENT = 'minimed:content-changed';

export function notifyContentChanged(): void {
  // Saved search results were made with the previous content; they now re-run behind their copy.
  bumpSearchContentRevision();
  window.dispatchEvent(new CustomEvent(CONTENT_CHANGED_EVENT));
}
