import { createSignal, onCleanup, onMount } from 'solid-js';

import {
  bootstrapDocumentReadLocation,
  ROOT_VIEW_ORDER,
  type RootView,
  redirectLegacySettingsRoutes,
  syncDocumentReadState,
  viewFromLocation,
} from '@/app/root-view';
import { isDocumentReadRoute } from '@/state/document-route';

type RootNavigationDirection = 'forward' | 'backward';

interface RootNavigationMotion {
  readonly from: RootView;
  readonly to: RootView;
  readonly direction: RootNavigationDirection;
}

const ROOT_NAVIGATION_MOTION_MS = 320;

export function useRootNavigation() {
  bootstrapDocumentReadLocation();
  const [view, setView] = createSignal<RootView>(viewFromLocation());
  const [documentReadActive, setDocumentReadActive] = createSignal(
    isDocumentReadRoute(window.location.hash),
  );
  const [rootNavigationMotion, setRootNavigationMotion] = createSignal<RootNavigationMotion>();
  const [showScrollTop, setShowScrollTop] = createSignal(false);

  let rootNavigationMotionFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let rootNavigationMotionEndFrame: number | undefined;
  let rootNavigationIncomingListener:
    | { readonly element: HTMLElement; readonly handler: (event: AnimationEvent) => void }
    | undefined;
  const rootNavigationQueue: Array<{ readonly next: RootView; readonly commit: () => void }> = [];
  const lastRouteByView = new Map<RootView, string>();
  const scrollByView = new Map<RootView, number>();

  const snapshotCurrentRoute = (hash = window.location.hash): void => {
    if (isDocumentReadRoute(hash)) return;
    if (!rootNavigationMotion()) {
      scrollByView.set(view(), window.scrollY);
    }
    lastRouteByView.set(view(), hash || `#/${view()}`);
  };

  const restoreScrollFor = (target: RootView, schedule = true): void => {
    const top = scrollByView.get(target) ?? 0;
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
      document.querySelector('.overlay-dialog') !== null;
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

  const navigate = (next: RootView): void => {
    transitionToRootView(next, () => {
      const changed = view() !== next;
      if (!changed) {
        if (documentReadActive()) {
          const targetHash = lastRouteByView.get(next) ?? `#/${next}`;
          window.location.hash = targetHash;
          return;
        }
        moveToRootView(next);
        const oldURL = window.location.href;
        window.history.replaceState({ view: next }, '', `#/${next}`);
        window.dispatchEvent(
          new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }),
        );
        window.scrollTo({ top: 0, behavior: 'instant' });
        return;
      }
      snapshotCurrentRoute();
      moveToRootView(next);
      const targetHash = lastRouteByView.get(next) ?? `#/${next}`;
      const oldURL = window.location.href;
      window.history.replaceState({ view: next }, '', targetHash);
      window.dispatchEvent(
        new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }),
      );
    });
  };

  const applyDocumentReadState = (): void => {
    setDocumentReadActive(syncDocumentReadState());
  };

  const handleHashChange = (event: HashChangeEvent): void => {
    if (event.isTrusted) {
      finishRootNavigationMotionIfActive();
    }
    redirectLegacySettingsRoutes();
    applyDocumentReadState();
    const next = viewFromLocation();
    if (next === view()) return;
    transitionToRootView(next, () => {
      let previousHash: string | undefined;
      if (event.oldURL) {
        try {
          previousHash = new URL(event.oldURL, window.location.href).hash || undefined;
        } catch {
          previousHash = undefined;
        }
      }
      snapshotCurrentRoute(previousHash ?? lastRouteByView.get(view()) ?? `#/${view()}`);
      moveToRootView(next);
    });
  };

  const handleScroll = (): void => {
    setShowScrollTop(window.scrollY > 48);
    if (document.documentElement.classList.contains('using-root-view-transition')) {
      finishRootNavigationMotionIfActive();
    }
  };

  const handleVisibilityChange = (): void => {
    finishRootNavigationMotionIfActive();
  };

  onMount(() => {
    redirectLegacySettingsRoutes();
    applyDocumentReadState();
    setView(viewFromLocation());
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleScroll();
  });

  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('scroll', handleScroll);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    cancelRootNavigationMotionEnd();
  });

  return {
    view,
    documentReadActive,
    showScrollTop,
    navigate,
    rootViewClasses,
    isViewVisible,
  };
}
