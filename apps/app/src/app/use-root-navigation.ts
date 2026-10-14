import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import {
  bootstrapDocumentReadLocation,
  ROOT_VIEW_ORDER,
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

type RootNavigationDirection = 'forward' | 'backward';

interface RootNavigationMotion {
  readonly from: RootView;
  readonly to: RootView;
  readonly direction: RootNavigationDirection;
}

const ROOT_NAVIGATION_MOTION_MS = 180;
const CHROME_HIDE_AFTER = 96;
const CHROME_DIRECTION_THRESHOLD = 1;

export function useRootNavigation() {
  // First listener on the history: every entry is stamped before any route code reads it.
  onCleanup(installHistoryEntryTracking());
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
  const [rootNavigationMotion, setRootNavigationMotion] = createSignal<RootNavigationMotion>();
  const [showScrollTop, setShowScrollTop] = createSignal(false);
  const [chromeHidden, setChromeHidden] = createSignal(false);

  let rootNavigationMotionFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let rootNavigationMotionEndFrame: number | undefined;
  let scrollFrame: number | undefined;
  let lastScrollTop = window.scrollY;
  let chromeHoldUntil = 0;
  let rootNavigationIncomingListener:
    | { readonly element: HTMLElement; readonly handler: (event: AnimationEvent) => void }
    | undefined;
  const rootNavigationQueue: Array<{ readonly next: RootView; readonly commit: () => void }> = [];
  /** Where each tab was left: hash and query (a tool keeps its state in the query). */
  const lastRouteByView = new Map<RootView, { readonly hash: string; readonly search: string }>();
  const scrollByView = new Map<RootView, number>();

  const snapshotCurrentRoute = (
    hash = window.location.hash,
    search = window.location.search,
  ): void => {
    if (isDocumentReadRoute(hash)) return;
    if (!rootNavigationMotion()) {
      scrollByView.set(view(), window.scrollY);
    }
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

  const setIncomingScrollShift = (fromScroll: number, toScroll: number): void => {
    document.documentElement.style.setProperty(
      '--root-view-enter-scroll-shift',
      `${fromScroll - toScroll}px`,
    );
    document.documentElement.style.setProperty('--root-view-enter-to-scroll', `${toScroll}px`);
  };

  const clearIncomingScrollShift = (): void => {
    document.documentElement.style.removeProperty('--root-view-enter-scroll-shift');
    document.documentElement.style.removeProperty('--root-view-enter-to-scroll');
  };

  const cancelRootNavigationMotionEnd = (): void => {
    if (rootNavigationMotionFallbackTimer) {
      clearTimeout(rootNavigationMotionFallbackTimer);
      rootNavigationMotionFallbackTimer = undefined;
    }
    if (rootNavigationMotionEndFrame !== undefined) {
      cancelAnimationFrame(rootNavigationMotionEndFrame);
      rootNavigationMotionEndFrame = undefined;
    }
    if (rootNavigationIncomingListener) {
      rootNavigationIncomingListener.element.removeEventListener(
        'animationend',
        rootNavigationIncomingListener.handler,
      );
      rootNavigationIncomingListener = undefined;
    }
  };

  const finishRootNavigationMotion = (target: RootView): void => {
    cancelRootNavigationMotionEnd();
    if (!rootNavigationMotion()) return;
    setRootNavigationMotion(undefined);
    document.documentElement.classList.remove('using-root-view-transition');
    clearIncomingScrollShift();
    restoreScrollFor(target, false);
  };

  const finishRootNavigationMotionIfActive = (): void => {
    const motion = rootNavigationMotion();
    if (motion) finishRootNavigationMotion(motion.to);
  };

  const scheduleRootNavigationMotionEnd = (target: RootView): void => {
    cancelRootNavigationMotionEnd();
    rootNavigationMotionEndFrame = requestAnimationFrame(() => {
      rootNavigationMotionEndFrame = undefined;
      const incoming = document.querySelector<HTMLElement>(
        '.app-view.root-view-enter-forward, .app-view.root-view-enter-backward',
      );
      if (!incoming) {
        finishRootNavigationMotion(target);
        return;
      }
      const onAnimationEnd = (event: AnimationEvent): void => {
        if (event.target !== incoming) return;
        if (!event.animationName.startsWith('root-view-enter-')) return;
        finishRootNavigationMotion(target);
      };
      rootNavigationIncomingListener = { element: incoming, handler: onAnimationEnd };
      incoming.addEventListener('animationend', onAnimationEnd);
      rootNavigationMotionFallbackTimer = setTimeout(
        () => finishRootNavigationMotion(target),
        ROOT_NAVIGATION_MOTION_MS + 120,
      );
    });
  };

  const moveToRootView = (next: RootView): boolean => {
    const current = view();
    if (current === next) return false;
    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.querySelector('.overlay-dialog:not(.overlay-dialog--closing)') !== null ||
      new URLSearchParams(window.location.search).has('minimed-floating') ||
      !mountedViews().has(next);
    const inFlight = rootNavigationMotion();
    if (inFlight) {
      finishRootNavigationMotion(inFlight.to);
    } else {
      cancelRootNavigationMotionEnd();
    }
    if (!reduceMotion) {
      setIncomingScrollShift(window.scrollY, scrollByView.get(next) ?? 0);
      setRootNavigationMotion({
        from: current,
        to: next,
        direction:
          (ROOT_VIEW_ORDER.get(next) ?? 0) > (ROOT_VIEW_ORDER.get(current) ?? 0)
            ? 'forward'
            : 'backward',
      });
      document.documentElement.classList.add('using-root-view-transition');
    } else {
      setRootNavigationMotion(undefined);
      document.documentElement.classList.remove('using-root-view-transition');
      clearIncomingScrollShift();
    }
    setView(next);
    setMountedViews((current) => {
      if (current.has(next)) return current;
      const expanded = new Set(current);
      expanded.add(next);
      return expanded;
    });
    if (reduceMotion) {
      restoreScrollFor(next);
    } else {
      scheduleRootNavigationMotionEnd(next);
    }
    return true;
  };

  const runNextRootNavigation = (): void => {
    const request = rootNavigationQueue.shift();
    if (!request) return;
    request.commit();
    runNextRootNavigation();
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

  const rootViewClasses = (target: RootView): Readonly<Record<string, boolean>> => {
    const motion = rootNavigationMotion();
    return {
      active: view() === target,
      'root-view-enter-forward': motion?.to === target && motion.direction === 'forward',
      'root-view-enter-backward': motion?.to === target && motion.direction === 'backward',
      'root-view-exit-forward': motion?.from === target && motion.direction === 'forward',
      'root-view-exit-backward': motion?.from === target && motion.direction === 'backward',
    };
  };

  const isViewVisible = (target: RootView): boolean => {
    const motion = rootNavigationMotion();
    return view() === target || motion?.from === target;
  };

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
    if (event.isTrusted) {
      finishRootNavigationMotionIfActive();
    }
    redirectLegacySettingsRoutes();
    applyDocumentReadState();
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
    if (document.documentElement.classList.contains('using-root-view-transition')) {
      finishRootNavigationMotionIfActive();
    }
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

  const handleVisibilityChange = (): void => {
    finishRootNavigationMotionIfActive();
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
    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleScroll();
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('scroll', handleScroll);
    document.removeEventListener('scroll', handleScroll, { capture: true });
    window.removeEventListener(READER_CHROME_HOLD_EVENT, handleChromeHold);
    document.documentElement.classList.remove('app-chrome-hidden');
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    cancelRootNavigationMotionEnd();
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
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
