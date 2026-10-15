/**
 * For an editor that keeps typed text in a short debounce and writes it synchronously (browser
 * storage): `onPageLeave(flush)` runs `flush` when the page is unloaded or hidden (`pagehide`,
 * `beforeunload`, `freeze`, hidden `visibilitychange`), so a reload or an app kill inside the
 * debounce loses nothing. The returned function unregisters it. Asynchronous writes use
 * `debounced-saver.ts` instead.
 */
export function onPageLeave(flush: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  window.addEventListener('freeze', flush);
  document.addEventListener('visibilitychange', onHidden);
  return () => {
    window.removeEventListener('pagehide', flush);
    window.removeEventListener('beforeunload', flush);
    window.removeEventListener('freeze', flush);
    document.removeEventListener('visibilitychange', onHidden);
  };
}
