import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { animatePageEnter, consumePageEnterClaim } from '@/app/page-enter';

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
import { readerChromePinned } from '@/state/reader-chrome-pin';
import { installScrollRestoration, rememberedScroll } from '@/state/scroll-restore';
import { trackToolNavigation } from '@/state/tool-navigation';

const CHROME_HIDE_AFTER = 96;
const CHROME_DIRECTION_THRESHOLD = 1;
/** A downward run this long hides the reader's controls. */
const CHROME_HIDE_DISTANCE = 40;
/** An upward run this long brings them back. */
const CHROME_SHOW_DISTANCE = 24;
/** This close to the end of the page they come back (nothing more to read below). */
const CHROME_END_SLACK = 8;
/**
 * After the controls slide in or out the page may shift under them (the sticky heading line, scroll
 * anchoring); those movements are not the reader's and are ignored for this long. Without it a
 * shown bar shifted the page down, which read as a downward scroll and hid it again.
 */
const CHROME_SETTLE_MS = 260;

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
  const [chromeHidden, setChromeHidden] = createSignal(false);

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

  const readScrollTop = (event?: Event): number => {
    const target = event?.target;
    if (target instanceof HTMLElement && target.matches('.user-document-reader--fullscreen')) {
      return target.scrollTop;
    }
    return window.scrollY;
  };

  /**
   * The reader's controls follow a deliberate scroll, not every pixel (owner 2026-11-06: the bar
   * hid oddly). Distance is summed per direction: a downward run of `CHROME_HIDE_DISTANCE` hides
   * them, an upward run of `CHROME_SHOW_DISTANCE`, the top of the page or its end shows them. A
   * jitter, a layout shift or a short flick back and forth leaves them where they are.
   */
  let scrollRun = 0;
  let chromeToggledAt = Number.NEGATIVE_INFINITY;
  let endCheck: number | undefined;
  /** The end of the page brings the controls back; read once per frame, where layout is due anyway. */
  const scheduleEndCheck = (target: EventTarget | null | undefined): void => {
    if (endCheck !== undefined) return;
    endCheck = requestAnimationFrame(() => {
      endCheck = undefined;
      if (!chromeHidden()) return;
      const scroller =
        target instanceof HTMLElement && target.matches('.user-document-reader--fullscreen')
          ? target
          : document.documentElement;
      const top = scroller === document.documentElement ? window.scrollY : scroller.scrollTop;
      if (scroller.scrollHeight - scroller.clientHeight - top <= CHROME_END_SLACK) {
        scrollRun = 0;
        setChromeHidden(false);
      }
    });
  };
  const handleScroll = (event?: Event): void => {
    const scrollTop = readScrollTop(event);
    const direction = scrollTop - lastScrollTop;
    lastScrollTop = scrollTop;
    const canHideChrome =
      documentReadActive() && !medicalImageViewerActive() && !readerChromePinned();
    if (!canHideChrome || performance.now() < chromeHoldUntil) {
      scrollRun = 0;
      if (chromeHidden()) setChromeHidden(false);
      return;
    }
    if (direction === 0) return;
    if (performance.now() - chromeToggledAt < CHROME_SETTLE_MS) {
      scrollRun = 0;
      return;
    }
    // A change of direction starts a new run.
    scrollRun = Math.sign(direction) === Math.sign(scrollRun) ? scrollRun + direction : direction;
    if (scrollTop <= CHROME_DIRECTION_THRESHOLD || scrollRun <= -CHROME_SHOW_DISTANCE) {
      setChromeHidden(false);
    } else if (scrollTop > CHROME_HIDE_AFTER && scrollRun >= CHROME_HIDE_DISTANCE) {
      setChromeHidden(true);
    }
    if (chromeHidden() && direction > 0) scheduleEndCheck(event?.target);
  };

  const handleChromeHold = (event: Event): void => {
    const duration =
      event instanceof CustomEvent && typeof event.detail === 'number' ? event.detail : 600;
    chromeHoldUntil = performance.now() + Math.min(Math.max(duration, 0), 3000);
    if (chromeHidden()) setChromeHidden(false);
  };

  createEffect(() => {
    const canHideChrome =
      documentReadActive() && !medicalImageViewerActive() && !readerChromePinned();
    if (!canHideChrome) {
      if (chromeHidden()) setChromeHidden(false);
      lastScrollTop = window.scrollY;
    }
    const hidden = canHideChrome && chromeHidden();
    if (document.documentElement.classList.contains('app-chrome-hidden') !== hidden) {
      chromeToggledAt = performance.now();
      scrollRun = 0;
    }
    document.documentElement.classList.toggle('app-chrome-hidden', hidden);
  });

  // The arrived page's blocks grow in (app/page-enter.ts) from the first frame that draws them: a
  // start a frame later showed the whole page for one frame, then blanked it and grew it back. A
  // page still mounting (a lazy chunk) is tried again for a few frames; readers keep their own
  // chrome and start at once.
  let enterFrame: number | undefined;
  /** When the views' tree last changed: a page that mounted with the address change shows here. */
  let lastTreeChangeAt = Number.NEGATIVE_INFINITY;
  let treeWatcher: MutationObserver | undefined;
  /** An entry waits for the page to mount: until this moment the next tree change starts it. */
  let enterWaitsUntil = Number.NEGATIVE_INFINITY;
  const watchTree = (): void => {
    const main = document.querySelector('.app-main');
    if (!main || treeWatcher) return;
    treeWatcher = new MutationObserver(() => {
      lastTreeChangeAt = performance.now();
      // The observer's callback runs right after the task that changed the tree, before the next
      // frame is drawn: a page that mounts later than its address (a lazy chunk, a view the tabs
      // reveal) starts its entry here, so the first frame that draws it is already the start.
      if (lastTreeChangeAt > enterWaitsUntil) return;
      const view = document.querySelector('.app-view.active');
      // A skeleton is the page's placeholder: its entry is the real content's, when that arrives.
      if (view?.querySelector('.page-skeleton__paper, .page-skeleton__bar')) return;
      if (animatePageEnter(view)) {
        enterWaitsUntil = Number.NEGATIVE_INFINITY;
        stopEnter();
      }
    });
    treeWatcher.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  };
  const stopEnter = (): void => {
    if (enterFrame !== undefined) cancelAnimationFrame(enterFrame);
    enterFrame = undefined;
  };
  /** The route listener that mounts the page may run just before this one: a little slack. */
  const MOUNT_SLACK_MS = 50;
  /** How long after the address changes a tree change still counts as the arrival's mount. */
  const ENTER_WAIT_MS = 800;
  const scheduleEnter = (): void => {
    if (consumePageEnterClaim()) return;
    if (isDocumentReadRoute(window.location.hash)) return;
    stopEnter();
    watchTree();
    enterWaitsUntil = performance.now() + ENTER_WAIT_MS;
    // A page that mounted in the same turn as the address (a screen that mounts at once) is drawn
    // for the first time by the next frame: the entry starts there. A page that has not mounted by
    // then (a lazy chunk) is waited for, two frames at least, and tried again until it is there.
    const changedAt = performance.now();
    let frames = 0;
    const tick = (): void => {
      frames += 1;
      const mounted = lastTreeChangeAt >= changedAt - MOUNT_SLACK_MS;
      if (!mounted && frames < 2) {
        enterFrame = requestAnimationFrame(tick);
        return;
      }
      const started = animatePageEnter(document.querySelector('.app-view.active'));
      if (started || frames >= 20) {
        enterWaitsUntil = Number.NEGATIVE_INFINITY;
        stopEnter();
      } else enterFrame = requestAnimationFrame(tick);
    };
    enterFrame = requestAnimationFrame(tick);
  };

  onMount(() => {
    redirectLegacySettingsRoutes();
    applyDocumentReadState();
    setView(viewFromLocation());
    watchTree();
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('hashchange', scheduleEnter);
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener(READER_CHROME_HOLD_EVENT, handleChromeHold);
    handleScroll();
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('hashchange', scheduleEnter);
    stopEnter();
    treeWatcher?.disconnect();
    window.removeEventListener('scroll', handleScroll);
    document.removeEventListener('scroll', handleScroll, { capture: true });
    window.removeEventListener(READER_CHROME_HOLD_EVENT, handleChromeHold);
    document.documentElement.classList.remove('app-chrome-hidden');
    if (settleTimer) clearTimeout(settleTimer);
    if (endCheck !== undefined) cancelAnimationFrame(endCheck);
  });

  return {
    view,
    documentReadActive,
    chromeHidden,
    navigate,
    rootViewClasses,
    isViewVisible,
    hasMountedView,
  };
}
