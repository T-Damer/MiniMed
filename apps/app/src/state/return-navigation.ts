import { isDocumentReadRoute } from '@/state/document-route';

export interface ReturnToLocation {
  readonly hash: string;
  readonly search: string;
}

const STORAGE_KEY = 'minimed:return-to';
export const RETURN_TO_EVENT = 'minimed:return-to';

function normalizeHash(hash: string): string {
  if (!hash) return '#/search';
  return hash.startsWith('#') ? hash : `#/${hash.replace(/^\/+/u, '')}`;
}

export function rememberReturnTo(): void {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      hash: normalizeHash(window.location.hash),
      search: window.location.search,
    } satisfies ReturnToLocation),
  );
  window.dispatchEvent(new Event(RETURN_TO_EVENT));
}

export function peekReturnTo(): ReturnToLocation | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReturnToLocation;
    if (typeof parsed.hash !== 'string' || typeof parsed.search !== 'string') return null;
    return { hash: normalizeHash(parsed.hash), search: parsed.search };
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(RETURN_TO_EVENT));
}

export function consumeReturnTo(): ReturnToLocation | null {
  const location = peekReturnTo();
  if (!location) return null;
  clearReturnTo();
  return location;
}

export function restoreReturnTo(location: ReturnToLocation): void {
  const oldURL = window.location.href;
  const newURL = `${window.location.origin}${window.location.pathname}${location.search}${location.hash}`;
  window.history.pushState(null, '', newURL);
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL }));
}

export function consumeAndRestoreReturnTo(): boolean {
  const location = consumeReturnTo();
  if (!location) return false;
  restoreReturnTo(location);
  return true;
}

function hasDocumentOverlaySearch(search: string, hash: string): boolean {
  if (isDocumentReadRoute(hash)) return true;
  return search.includes('dialog=') || search.includes('o=');
}

export function returnToControlLabel(location: ReturnToLocation): string {
  const hashRoute = location.hash.replace(/^#\/?/u, '');
  if (hashRoute === 'search') return 'К поиску';
  if (hasDocumentOverlaySearch(location.search, location.hash)) return 'К документу';
  if (hashRoute === 'modules' || hashRoute.startsWith('modules/')) return 'К базе знаний';
  return 'Вернуться';
}

export function returnToControlIcon(location: ReturnToLocation): 'house' | 'arrow-u-up-left' {
  const hashRoute = location.hash.replace(/^#\/?/u, '');
  if (hashRoute === 'search') return 'arrow-u-up-left';
  if (hasDocumentOverlaySearch(location.search, location.hash)) return 'arrow-u-up-left';
  return 'house';
}

export function returnToRouteDetail(location: ReturnToLocation): string {
  if (hasDocumentOverlaySearch(location.search, location.hash)) return 'Открытый документ';
  const hashRoute = location.hash.replace(/^#\/?/u, '');
  if (hashRoute === 'search') return 'Поиск';
  if (hashRoute === 'modules' || hashRoute.startsWith('modules/')) return 'База знаний';
  if (hashRoute === 'assessments' || hashRoute.startsWith('assessments/')) return 'Тесты';
  if (hashRoute === 'calculators' || hashRoute.startsWith('calculators/')) return 'Калькуляторы';
  if (hashRoute === 'notes' || hashRoute.startsWith('notes/')) return 'Заметки';
  if (hashRoute === 'settings') return 'Настройки';
  if (!hashRoute) return 'Поиск';
  return hashRoute;
}
