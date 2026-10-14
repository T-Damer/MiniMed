/**
 * The note editor reports its text through a short debounce. Anything that leaves the page or the
 * editor (reload, tab hidden, route change) first calls `flushNoteEditors`, which makes every open
 * editor report its current text at once, so the draft written from it is never one pause behind.
 */
const flushers = new Set<() => void>();
let lifecycleInstalled = false;

export function flushNoteEditors(): void {
  for (const flush of [...flushers]) flush();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushNoteEditors();
}

function installLifecycle(): void {
  if (lifecycleInstalled || typeof window === 'undefined') return;
  lifecycleInstalled = true;
  window.addEventListener('pagehide', flushNoteEditors);
  window.addEventListener('beforeunload', flushNoteEditors);
  window.addEventListener('freeze', flushNoteEditors);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

/** Registers an editor's flush; the returned function unregisters it. */
export function registerNoteEditorFlush(flush: () => void): () => void {
  installLifecycle();
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}
