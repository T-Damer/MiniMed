import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import {
  bootstrapDocumentReadLocation,
  type RootView,
  redirectLegacySettingsRoutes,
  rootViewRestoresRoute,
  syncDocumentReadState,
  viewFromLocation,
} from '@/app/root-view';
import { medicalImageViewerActive } from '@/features/library/document-reading-mode';
import { visitRoute } from '@/state/app-back';
import { isDocumentReadRoute } from '@/state/document-route';
import { currentHistoryEntry, installHistoryEntryTracking } from '@/state/history-entries';
import { READER_CHROME_HOLD_EVENT } from '@/state/reader-chrome-hold';
import { installScrollRestoration, rememberedScroll } from '@/state/scroll-restore';
import { trackToolNavigation } from '@/state/tool-navigation';

const CHROME_HIDE_AFTER = 96;
const CHROME_DIRECTION_THRESHOLD = 1;

export function useRootNavigation() {
  // First listener on the history: every entry is stamped before any route code reads it.
  onCleanup(installHistoryEntryTracking());
  // A tab opened on the bare address is on the search page: say so in the address, so that a tab
  // tap that steps back to this first entry lands on `#/search` like every other way there.
  if (window.location.hash === '') {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}#/search`,
    );
  }
  onCleanup(installScrollRestoration());
  bootstrapDocumentReadLocation();
  const [view, setView] = createSignal<RootView>(viewFromLocation());
  const [documentReadActive, setDocumentReadActive] = createSignal(
    isDocumentReadRoute(window.location.hash),
  );
  // Keep-alive registry: a root pane constructs its component the first time it becomes
  // the navigation target and stays mounted (hidden) afterwards. Never-visited tabs cost
  // nothing at boot; visited tabs preserve scroll position, draft input, and local state
  // without re-running their bootstrap on every tab switch.
  const [mountedViews, setMountedViews] = createSignal<ReadonlySet<RootView>>(
    new Set([viewFromLocation()]),
  );
  const [showScrollTop, setShowScrollTop] = createSignal(false);
  const [chromeHidden, setChromeHidden] = createSignal(false);

  let scrollFrame: number | undefined;
  let lastScrollTop = window.scrollY;
  let chromeHoldUntil = 0;
  const rootNavigationQueue: Array<{ readonly next: RootView; readonly commit: () => void }> = [];
  /** Where each tab was left: hash and query (a tool keeps its state in the query). */
  const lastRouteByView = new Map<RootView, { readonly hash: string; readonly search: string }>();
  const scrollByView = new Map<RootView, number>();

  const snapshotCurrentRoute = (
    hash = window.location.hash,
    search = window.location.search,
  ): void => {
    if (isDocumentReadRoute(hash)) return;
    scrollByView.set(view(), window.scrollY);
    lastRouteByView.set(view(), { hash: hash || `#/${view()}`, search });
  };
  const lastPlace = (target: RootView): { readonly hash: string; readonly search: string } =>
    lastRouteByView.get(target) ?? { hash: `#/${target}`, search: '' };

  const restoreScrollFor = (target: RootView, schedule = true): void => {
    // The entry the page is on remembers its own place (back, forward); a tab visit falls back to
    // the place the tab was left at.
    const top = rememberedScroll(currentHistoryEntry().id) ?? scrollByView.get(target) ?? 0;
    if (schedule) {
      requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
      return;
    }
    window.scrollTo({ top, behavior: 'instant' });
  };

  const moveToRootView = (next: RootView): boolean => {
    if (view() === next) return false;
    const mounted = mountedViews().has(next);
    setView(next);
    setMountedViews((current) => {
      if (current.has(next)) return current;
      const expanded = new Set(current);
      expanded.add(next);
      return expanded;
    });
    // In the same frame: the new page is never drawn at the old page's scroll.
    restoreScrollFor(next, false);
    // A page built just now lays itself out after this frame.
    if (!mounted) restoreScrollFor(next);
    return true;
  };

  /** How long a tab switch counts as one: the hash changes it causes land inside this window. */
  const SWITCH_SETTLE_MS = 200;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * A tab switch is instant, like an iOS tab bar (owner 2026-10-29): the new page is shown at its
   * saved scroll in the same frame. The earlier cross-fade drew the incoming page shifted while the
   * window still had the old page's scroll, so its sticky header and scroll-driven parts were drawn
   * for the wrong place and jumped (blinked) when it ended; a view transition would hold every tap
   * while it runs. `using-root-view-transition` marks the switch for a moment, so a view that
   * resets its scroll on its own hash change leaves the restored place alone.
   */
  const runNextRootNavigation = (): void => {
    const root = document.documentElement;
    for (
      let request = rootNavigationQueue.shift();
      request;
      request = rootNavigationQueue.shift()
    ) {
      root.classList.add('using-root-view-transition');
      request.commit();
    }
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      root.classList.remove('using-root-view-transition');
    }, SWITCH_SETTLE_MS);
  };

  const transitionToRootView = (next: RootView, commit: () => void): boolean => {
    const plannedView = rootNavigationQueue[rootNavigationQueue.length - 1]?.next ?? view();
    if (plannedView === next) {
      if (rootNavigationQueue.length === 0) commit();
      return false;
    }
    rootNavigationQueue.push({ next, commit });
    runNextRootNavigation();
    return true;
  };

  const rootViewClasses = (target: RootView): Readonly<Record<string, boolean>> => ({
    active: view() === target,
  });

  const isViewVisible = (target: RootView): boolean => view() === target;

  const hasMountedView = (target: RootView): boolean => mountedViews().has(target);

  /**
   * Tabs share one history (see `state/app-back.ts`): a tab tap goes to the place the tab was left
   * at — by stepping back to it when this branch of the history holds it, else by a push — so back
   * returns to the tab used before and a round trip between two tabs leaves no pile of entries.
   */
  const navigate = (next: RootView): void => {
    transitionToRootView(next, () => {
      const changed = view() !== next;
      if (!changed) {
        if (documentReadActive()) {
          const place = lastPlace(next);
          visitRoute(place.hash, place.search);
          return;
        }
        moveToRootView(next);
        // The tab's own first screen: layers pushed on it are stepped over, else it replaces.
        visitRoute(`#/${next}`, '', 'replace');
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
      }
      snapshotCurrentRoute();
      // A tab that opens at its list forgets where it was left, scroll position included.
      const restores = rootViewRestoresRoute(next);
      if (!restores) scrollByView.delete(next);
      moveToRootView(next);
      const place = restores ? lastPlace(next) : { hash: `#/${next}`, search: '' };
      visitRoute(place.hash, place.search);
    });
  };

  const applyDocumentReadState = (): void => {
    setDocumentReadActive(syncDocumentReadState());
  };

  const handleHashChange = (event: HashChangeEvent): void => {
    trackToolNavigation(event.oldURL, event.newURL);
    redirectLegacySettingsRoutes();
    applyDocumentReadState();
    // A new place starts with its controls in view. Moving from one document to another kept the
    // header and the bottom bar hidden from the previous page's scroll, so a page that was still
    // loading showed only its loader (owner 2026-10-26).
    if (chromeHidden()) setChromeHidden(false);
    const next = viewFromLocation();
    if (next === view()) return;
    transitionToRootView(next, () => {
      let previousHash: string | undefined;
      let previousSearch: string | undefined;
      if (event.oldURL) {
        try {
          const previousUrl = new URL(event.oldURL, window.location.href);
          previousHash = previousUrl.hash || undefined;
          previousSearch = previousUrl.search;
        } catch {
          previousHash = undefined;
        }
      }
      const known = lastRouteByView.get(view());
      snapshotCurrentRoute(
        previousHash ?? known?.hash ?? `#/${view()}`,
        previousSearch ?? known?.search ?? '',
      );
      moveToRootView(next);
    });
  };

  const activeReaderScrollElement = (): HTMLElement | undefined =>
    document.querySelector<HTMLElement>('.user-document-reader--fullscreen') || undefined;

  const readScrollTop = (event?: Event): number => {
    const target = event?.target;
    if (target instanceof HTMLElement && target.matches('.user-document-reader--fullscreen')) {
      return target.scrollTop;
    }
    return window.scrollY;
  };

  const scrollToTop = (): void => {
    const reader = activeReaderScrollElement();
    if (reader) {
      reader.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Virtualized rows remeasure while scrolling; a smooth animation can lose its target.
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleScroll = (event?: Event): void => {
    const scrollTop = readScrollTop(event);
    const direction = scrollTop - lastScrollTop;
    lastScrollTop = scrollTop;
    const canHideChrome = documentReadActive() && !medicalImageViewerActive();
    if (!canHideChrome || performance.now() < chromeHoldUntil) {
      if (chromeHidden()) setChromeHidden(false);
    } else if (scrollTop <= CHROME_DIRECTION_THRESHOLD || direction < -CHROME_DIRECTION_THRESHOLD) {
      setChromeHidden(false);
    } else if (scrollTop > CHROME_HIDE_AFTER && direction > CHROME_DIRECTION_THRESHOLD) {
      setChromeHidden(true);
    }
    if (scrollFrame !== undefined) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      setShowScrollTop(scrollTop > 48);
    });
  };

  const handleChromeHold = (event: Event): void => {
    const duration =
      event instanceof CustomEvent && typeof event.detail === 'number' ? event.detail : 600;
    chromeHoldUntil = performance.now() + Math.min(Math.max(duration, 0), 3000);
    if (chromeHidden()) setChromeHidden(false);
  };

  createEffect(() => {
    const canHideChrome = documentReadActive() && !medicalImageViewerActive();
    if (!canHideChrome) {
      if (chromeHidden()) setChromeHidden(false);
      lastScrollTop = window.scrollY;
    }
    document.documentElement.classList.toggle('app-chrome-hidden', canHideChrome && chromeHidden());
  });

  onMount(() => {
    redirectLegacySettingsRoutes();
    applyDocumentReadState();
    setView(viewFromLocation());
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener(READER_CHROME_HOLD_EVENT, handleChromeHold);
    handleScroll();
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('scroll', handleScroll);
    document.removeEventListener('scroll', handleScroll, { capture: true });
    window.removeEventListener(READER_CHROME_HOLD_EVENT, handleChromeHold);
    document.documentElement.classList.remove('app-chrome-hidden');
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    if (settleTimer) clearTimeout(settleTimer);
  });

  return {
    view,
    documentReadActive,
    showScrollTop,
    chromeHidden,
    scrollToTop,
    navigate,
    rootViewClasses,
    isViewVisible,
    hasMountedView,
  };
}
