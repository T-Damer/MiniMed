export const CONTENT_CHANGED_EVENT = 'minimed:content-changed';

export function notifyContentChanged(): void {
  window.dispatchEvent(new CustomEvent(CONTENT_CHANGED_EVENT));
}
