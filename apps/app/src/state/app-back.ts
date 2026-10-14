/**
 * The app's navigation model, in one place.
 *
 * **Back peels one layer.** The in-app ‹, the browser's back and Android's hardware back all do the
 * same thing: the history steps back by one entry. Layers (`history-layer.ts`) are entries, so a
 * sheet closes before the page under it goes, and a screen is left for the place the user came
 * from — a tool opened from search returns to the search results, with the query and the scroll
 * the page kept, not to the tools catalogue.
 *
 * **No in-app entry below** (a deep link in a fresh tab, a reload of an entry from an older
 * build): there is nothing to step back to, so ‹ *replaces* the screen with its logical parent
 * instead of pushing it. The history never grows because of a back control.
 *
 * **Tabs.** Tapping a tab goes to the place that tab was left at. If the history already holds that
 * place on the current branch the app steps back to it (so switching A → B → A leaves no pile of
 * entries and back keeps its meaning); otherwise it pushes. Back from a tab's first screen then
 * returns to the previously used tab, and leaves the app only from the entry the session began on.
 */
import {
  currentHistoryEntry,
  hasInAppPreviousEntry,
  placeOf,
  stepsBackToPlace,
} from '@/state/history-entries';
import { popTopHistoryLayer } from '@/state/history-layer';

/** Points the current entry at another address and tells the route listeners (replace raises no event). */
export function replaceRoute(hash: string, search = window.location.search): void {
  const oldURL = window.location.href;
  const newURL = `${window.location.origin}${window.location.pathname}${search}${hash}`;
  window.history.replaceState(window.history.state, '', newURL);
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL }));
}

/** Pushes a new entry for another address and tells the route listeners (push raises no event). */
export function pushRoute(hash: string, search = window.location.search): void {
  const oldURL = window.location.href;
  const newURL = `${window.location.origin}${window.location.pathname}${search}${hash}`;
  window.history.pushState(null, '', newURL);
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL }));
}

/**
 * What a back control does. With an app entry below, the history steps back. Without one, the
 * screen is replaced by `fallbackHash`, its logical parent (a replace, never a push).
 */
export function navigateBack(fallbackHash: string): void {
  if (hasInAppPreviousEntry()) {
    window.history.back();
    return;
  }
  replaceRoute(fallbackHash, '');
}

/** Whether a back press has anything to step back to inside the app. */
export function canStepBack(): boolean {
  return hasInAppPreviousEntry();
}

/**
 * Goes to a tab's place. When the history already holds that place below the current entry the
 * history steps back to it; otherwise the place is pushed. Returns whether it stepped back.
 */
export function visitRoute(
  hash: string,
  search = '',
  whenNew: 'push' | 'replace' = 'push',
): 'stepped' | 'pushed' | 'replaced' {
  const steps = stepsBackToPlace(placeOf(hash, search));
  if (steps !== null && steps < 0) {
    window.history.go(steps);
    return 'stepped';
  }
  if (whenNew === 'replace') {
    replaceRoute(hash, search);
    return 'replaced';
  }
  pushRoute(hash, search);
  return 'pushed';
}

/**
 * Android's hardware back (and any other "back, whatever is open" request): a layer first, then
 * the history, then the screen's parent. Returns what it did so the native shell can exit when
 * there was nothing left.
 */
export function backOneLayer(options: {
  /** The logical parent of the current route, used when no app entry lies below. */
  readonly parentHash: string | null;
  /** Where a screen with neither history nor parent goes (the home tab), or null at the home tab. */
  readonly homeHash: string | null;
}): 'layer' | 'history' | 'parent' | 'home' | 'exit' {
  if (popTopHistoryLayer()) return 'layer';
  if (hasInAppPreviousEntry()) {
    window.history.back();
    return 'history';
  }
  if (options.parentHash) {
    replaceRoute(options.parentHash, '');
    return 'parent';
  }
  if (options.homeHash) {
    replaceRoute(options.homeHash, '');
    return 'home';
  }
  return 'exit';
}

/** The depth of the entry the page is on (0: nothing of the app below). */
export function historyDepth(): number {
  return currentHistoryEntry().depth;
}
