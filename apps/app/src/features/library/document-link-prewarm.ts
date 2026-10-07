import type { MedicalDocumentSummary } from '@localmed/contracts';

/** After the search home has settled; a reader opened sooner builds the matcher itself. */
const PREPARE_DELAY_MS = 2000;
const PREPARE_IDLE_TIMEOUT_MS = 6000;

/**
 * Starts building the inline-link matcher of the document list in the background, once the
 * browser is idle, so the first document the user opens does not spend ~230 ms (≈900 ms on a
 * throttled CPU) of its first render on it. The work runs in slices of a few milliseconds
 * (`prepareDocumentLinkMatcher`), the module is loaded only now, and a list is prepared once.
 */
export function prepareDocumentLinksWhenIdle(documents: readonly MedicalDocumentSummary[]): void {
  const start = (): void => {
    void import('@/features/library/document-medication-links')
      .then((module) => module.prepareDocumentLinkMatcher(documents))
      .catch((error: unknown) => {
        console.error('Не удалось подготовить ссылки между документами.', error);
      });
  };
  const idle = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  window.setTimeout(() => {
    if (typeof idle === 'function') idle(start, { timeout: PREPARE_IDLE_TIMEOUT_MS });
    else start();
  }, PREPARE_DELAY_MS);
}
