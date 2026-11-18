import { ROOT_VIEWS } from '@/app/root-view';
import { loadAppPreferences, subscribeAppPreferences } from '@/state/app-preferences';
import { type AppProfile, profileAllows } from '@/state/app-profile';
import { isDocumentReadRoute } from '@/state/document-route';
import {
  parseReaderPosition,
  readHistoryEntry,
  subscribeReaderPosition,
  withHistoryEntry,
} from '@/state/history-entries';

const LAST_PAGE_KEY = 'minimed.last-page.v1';

function pageHash(hash: unknown, profile?: AppProfile): string | undefined {
  if (typeof hash !== 'string' || !/^#\/[a-z-]+(?:\/[^#]*)?(?:\?[^#]*)?$/u.test(hash))
    return undefined;
  if (!profileAllows(hash, profile)) return undefined;
  if (isDocumentReadRoute(hash)) return hash;
  const path = hash.split('?')[0] ?? '';
  const root = path.slice(2).split('/')[0];
  if (!ROOT_VIEWS.some(({ id }) => id === root)) return undefined;
  // Keep the location of the search workspace without storing a copy of the query text.
  return path;
}

function storageKey(profile?: AppProfile): string {
  return `${LAST_PAGE_KEY}:${profile?.id ?? 'main'}`;
}

/** Restore only a fresh launch at the bare address. Explicit routes retain their own history. */
export function restoreLastPage(profile?: AppProfile): string | undefined {
  if (window.location.hash || !loadAppPreferences().restoreLastPage) return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(profile));
    if (!raw) return undefined;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== 'object' || !saved || !('hash' in saved)) return undefined;
    const hash = pageHash(saved.hash, profile);
    if (!hash || hash === (profile?.home ?? '#/search')) return undefined;
    const position =
      isDocumentReadRoute(hash) && 'position' in saved
        ? parseReaderPosition(saved.position)
        : undefined;
    window.history.replaceState(
      withHistoryEntry(null, {
        id: crypto.randomUUID(),
        depth: 0,
        ...(position ? { position } : {}),
      }),
      '',
      hash,
    );
    return hash;
  } catch (error) {
    console.warn('Unable to restore the previous page.', error);
    return undefined;
  }
}

export function trackLastPage(profile?: AppProfile): () => void {
  const key = storageKey(profile);
  let last: string | undefined;
  const save = (): void => {
    try {
      if (!loadAppPreferences().restoreLastPage) {
        window.localStorage.removeItem(key);
        last = undefined;
        return;
      }
      const hash = pageHash(window.location.hash, profile);
      if (!hash) return;
      const position = isDocumentReadRoute(hash)
        ? readHistoryEntry(window.history.state)?.position
        : undefined;
      const value = JSON.stringify({ hash, ...(position ? { position } : {}) });
      if (value === last) return;
      window.localStorage.setItem(key, value);
      last = value;
    } catch (error) {
      console.warn('Unable to save the current page.', error);
    }
  };
  const events = ['hashchange', 'popstate', 'pagehide'] as const;
  for (const event of events) window.addEventListener(event, save);
  const unsubscribe = subscribeAppPreferences(save);
  const unsubscribePosition = subscribeReaderPosition(save);
  save();
  return () => {
    for (const event of events) window.removeEventListener(event, save);
    unsubscribe();
    unsubscribePosition();
  };
}
