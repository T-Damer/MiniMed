import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { MedicalCore } from '@localmed/contracts';
import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Toaster } from 'solid-sonner';

import { nativeBackAction } from '@/app/native-back';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { createBrowserCore } from '@/composition/create-browser-core';
import {
  type InitializedMedicalCore,
  initializeMedicalCore,
  swapMedicalCore,
} from '@/composition/medical-core-lifecycle';
import { AssessmentsView } from '@/features/assessments/AssessmentsView';
import { CalculatorsView } from '@/features/calculators/CalculatorsView';
import { KnowledgeBaseView } from '@/features/knowledge/KnowledgeBaseView';
import { DocumentPageHost } from '@/features/library/DocumentPageHost';
import { migrateLegacyUserDocumentHash } from '@/features/library/user-library-routing';
import { LocalModelController } from '@/features/models/controller';
import { GroundedMedicalCore } from '@/features/models/GroundedMedicalCore';
import { ModelNavIndicator } from '@/features/models/ModelNavIndicator';
import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { refreshContentModuleCatalog } from '@/features/modules/catalog-service';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
  subscribeContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { NotesView } from '@/features/notes/NotesView';
import { SearchHome } from '@/features/search/SearchHome';
import { WorkerSearchMedicalCore } from '@/features/search/WorkerSearchMedicalCore';
import { SettingsView } from '@/features/settings/SettingsView';
import {
  APP_UPDATE_READY_EVENT,
  type AppUpdateProgress,
  type AppUpdateReadyDetail,
  activateAppUpdate,
  checkNativeApkUpdate,
} from '@/state/app-update';
import { notifyContentChanged } from '@/state/content-events';
import {
  isDocumentReadRoute,
  migrateLegacyDocumentHash,
  migrateLegacyOverlaySearch,
  parseDocumentReadRoute,
} from '@/state/document-route';
import { beginDocumentTrail, clearDocumentTrail, loadDocumentTrail } from '@/state/document-trail';
import { hapticFeedback } from '@/state/haptics';
import { installAndroidApk } from '@/state/native-update';
import { overlayFromLocationSearch, stripOrphanedOverlaySearch } from '@/state/overlay-route';
import { dueReminderNotes, loadPatientNotes, PATIENT_NOTES_EVENT } from '@/state/patient-notes';
import { rememberReturnTo } from '@/state/return-navigation';
import { pickSearchFocusTarget } from '@/state/search-focus-target';
import { installUiFeedback } from '@/state/ui-feedback';
import { ensureUserLibraryIngestRunning } from '@/state/user-library-ingest';

type View = 'search' | 'modules' | 'assessments' | 'calculators' | 'notes' | 'settings';
type RootNavigationDirection = 'forward' | 'backward';

interface RootNavigationMotion {
  readonly from: View;
  readonly to: View;
  readonly direction: RootNavigationDirection;
}

interface BottomNavBubblePosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface BottomNavBubbleMotion {
  readonly origin: 'center' | 'left' | 'right';
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotate: number;
}

interface BottomNavBubbleTravel {
  readonly edge: -1 | 0 | 1;
  readonly overscroll: number;
}

interface BottomNavGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startIndex: number;
  lastX: number;
  lastTime: number;
  lastDirection: number;
  moved: boolean;
}

const VIEWS: readonly {
  readonly id: View;
  readonly label: string;
  readonly icon: AppGlyphName;
}[] = [
  { id: 'search', label: 'Поиск', icon: 'search' },
  { id: 'modules', label: 'База знаний', icon: 'modules' },
  { id: 'assessments', label: 'Тесты', icon: 'list-checks' },
  { id: 'calculators', label: 'Калькуляторы', icon: 'calculator' },
  { id: 'notes', label: 'Заметки', icon: 'notes' },
  { id: 'settings', label: 'Настройки', icon: 'system' },
];
const VIEW_ORDER = new Map(VIEWS.map((item, index) => [item.id, index]));

const DEFAULT_MODEL_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/models/catalog.preview.json';
const DEFAULT_MODEL_ASSET_BASE_URL = '';
const SLOW_BOOT_DELAY_MS = 10_000;
const ROOT_NAVIGATION_MOTION_MS = 320;
const DEFAULT_BOTTOM_NAV_BUBBLE: BottomNavBubblePosition = {
  left: 0,
  top: 0,
  width: 42,
  height: 42,
};

function viewFromLocation(hash = window.location.hash): View {
  if (isDocumentReadRoute(hash)) {
    const trail = loadDocumentTrail();
    if (trail) return trail.origin.view;
    const parsed = parseDocumentReadRoute(hash);
    return parsed?.kind === 'user' ? 'modules' : 'search';
  }
  const value = hash.replace(/^#\/?/u, '');
  if (value === 'documents') return 'modules';
  if (value === 'settings' || value === 'modules/model' || value === 'status') return 'settings';
  if (value.startsWith('modules/')) return 'modules';
  if (value === 'assessments' || value.startsWith('assessments/')) return 'assessments';
  if (value === 'calculators' || value.startsWith('calculators/')) return 'calculators';
  if (value.startsWith('notes/')) return 'notes';
  if (value === 'history') return 'search';
  return VIEWS.some((item) => item.id === value) ? (value as View) : 'search';
}

function redirectLegacySettingsRoutes(): void {
  const value = window.location.hash.replace(/^#\/?/u, '');
  if (value === 'modules/model' || value === 'status') {
    window.history.replaceState({ view: 'settings' }, '', '#/settings');
  }
}

function countAvailableModules(
  modules: readonly { releaseState: string; tags: readonly string[] }[],
): number {
  return modules.filter(
    (module) =>
      module.releaseState === 'published' && !module.tags.includes('individual-recommendation'),
  ).length;
}

function environmentFlag(name: string, fallback: boolean): boolean {
  const value = import.meta.env[name]?.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function createLocalModelController(): LocalModelController {
  const configuredCatalogUrl = import.meta.env.VITE_LOCAL_MODEL_CATALOG_URL?.trim();
  const remoteCatalogUrl =
    configuredCatalogUrl === 'bundled' ? '' : configuredCatalogUrl || DEFAULT_MODEL_CATALOG_URL;
  const mirrorBaseUrl =
    import.meta.env.VITE_LOCAL_MODEL_ASSET_BASE_URL?.trim() || DEFAULT_MODEL_ASSET_BASE_URL;
  return new LocalModelController({
    remoteCatalogUrl,
    mirrorBaseUrl,
    allowUpstreamFallback: environmentFlag('VITE_LOCAL_MODEL_ALLOW_UPSTREAM', true),
    allowAutomationDownloads: environmentFlag('VITE_LOCAL_MODEL_ALLOW_AUTOMATION_DOWNLOADS', false),
    defaultAutoLoad: environmentFlag('VITE_LOCAL_MODEL_AUTOLOAD', true),
  });
}

function bootstrapDocumentReadLocation(): void {
  migrateLegacyDocumentHash();
  migrateLegacyUserDocumentHash();
  migrateLegacyOverlaySearch();
}

export function App(): JSX.Element {
  bootstrapDocumentReadLocation();
  const isNativeShell = Capacitor.getPlatform() !== 'web';
  const [view, setView] = createSignal<View>(viewFromLocation());
  const [documentReadActive, setDocumentReadActive] = createSignal(
    isDocumentReadRoute(window.location.hash),
  );
  const [rootNavigationMotion, setRootNavigationMotion] = createSignal<RootNavigationMotion>();
  const [ready, setReady] = createSignal<InitializedMedicalCore>();
  const [error, setError] = createSignal<string>();
  const [bootSlow, setBootSlow] = createSignal(false);
  const [availableModuleCount, setAvailableModuleCount] = createSignal(0);
  const [downloadedModuleCount, setDownloadedModuleCount] = createSignal(0);
  const [dueReminderCount, setDueReminderCount] = createSignal(0);
  const [showScrollTop, setShowScrollTop] = createSignal(false);
  const [appUpdateWorker, setAppUpdateWorker] = createSignal<ServiceWorker>();
  const [availableApkUrl, setAvailableApkUrl] = createSignal<string>();
  const [appUpdating, setAppUpdating] = createSignal(false);
  const [appUpdateProgress, setAppUpdateProgress] = createSignal<AppUpdateProgress>();
  const [bottomNavBubble, setBottomNavBubble] =
    createSignal<BottomNavBubblePosition>(DEFAULT_BOTTOM_NAV_BUBBLE);
  const [bottomNavBubbleMotion, setBottomNavBubbleMotion] = createSignal<BottomNavBubbleMotion>({
    origin: 'center',
    scaleX: 1,
    scaleY: 1,
    rotate: 0,
  });
  const [bottomNavDragIndex, setBottomNavDragIndex] = createSignal<number>();
  const [bottomNavPressed, setBottomNavPressed] = createSignal(false);
  const [bottomNavDragging, setBottomNavDragging] = createSignal(false);
  const modelController = createLocalModelController();
  const [assistantCore, setAssistantCore] = createSignal<GroundedMedicalCore>();
  const [searchCore, setSearchCore] = createSignal<WorkerSearchMedicalCore>();
  let coreToClose: MedicalCore | undefined;
  let unsubscribeInstalledModules: (() => void) | undefined;
  let unsubscribeModuleRuntime: (() => void) | undefined;
  let nativeBackListener: Awaited<ReturnType<typeof NativeApp.addListener>> | undefined;
  let stopButtonHaptics: (() => void) | undefined;
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  let rootNavigationMotionFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let rootNavigationMotionEndFrame: number | undefined;
  let rootNavigationIncomingListener:
    | { readonly element: HTMLElement; readonly handler: (event: AnimationEvent) => void }
    | undefined;
  let bottomNav: HTMLElement | undefined;
  let bottomNavResizeObserver: ResizeObserver | undefined;
  let bottomNavGesture: BottomNavGesture | undefined;
  let bottomNavBubbleFrame: number | undefined;
  let bottomNavBubbleSettleTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressNavClickUntil = 0;
  const rootNavigationQueue: Array<{ readonly next: View; readonly commit: () => void }> = [];
  // Each of the 6 root views stays mounted (hidden, never unmounted — see the `hidden={view() !== X}`
  // sections below), so its own component state (open document, calculator inputs, etc.) already
  // survives a tab switch. What used to erase it was this file: every root navigation collapsed the URL
  // to the bare `#/<view>` and reset scroll to 0, so a view's own hashchange listener (e.g.
  // MedicationCatalogView's) would see a route that no longer matches its sub-page and reset itself —
  // and Solid's <Show> inside CalculatorsView/AssessmentsView would unmount the open form entirely.
  // Remembering the last hash and scroll offset per view and restoring them on return fixes both.
  const lastRouteByView = new Map<View, string>();
  const scrollByView = new Map<View, number>();
  const snapshotCurrentRoute = (hash = window.location.hash): void => {
    if (isDocumentReadRoute(hash)) return;
    // During the overlay animation the window still belongs to the outgoing view. Saving
    // `window.scrollY` onto the already-switched incoming view would overwrite its real offset.
    if (!rootNavigationMotion()) {
      scrollByView.set(view(), window.scrollY);
    }
    lastRouteByView.set(view(), hash || `#/${view()}`);
  };
  const restoreScrollFor = (target: View, schedule = true): void => {
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

  const finishRootNavigationMotion = (target: View): void => {
    cancelRootNavigationMotionEnd();
    if (!rootNavigationMotion()) return;
    setRootNavigationMotion(undefined);
    document.documentElement.classList.remove('using-root-view-transition');
    clearIncomingScrollShift();
    // Commit window scroll in the same turn as dropping the overlay shift so the incoming page
    // does not paint at the outgoing offset for a frame.
    restoreScrollFor(target, false);
  };

  const finishRootNavigationMotionIfActive = (): void => {
    const motion = rootNavigationMotion();
    if (motion) finishRootNavigationMotion(motion.to);
  };

  const scheduleRootNavigationMotionEnd = (target: View): void => {
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

  const moveToRootView = (next: View): boolean => {
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
          (VIEW_ORDER.get(next) ?? 0) > (VIEW_ORDER.get(current) ?? 0) ? 'forward' : 'backward',
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

    const current = view();
    if (current === request.next) {
      request.commit();
      runNextRootNavigation();
      return;
    }
    request.commit();
    runNextRootNavigation();
  };

  const transitionToRootView = (next: View, commit: () => void): boolean => {
    const plannedView = rootNavigationQueue[rootNavigationQueue.length - 1]?.next ?? view();
    if (plannedView === next) {
      if (rootNavigationQueue.length === 0) commit();
      return false;
    }
    rootNavigationQueue.push({ next, commit });
    runNextRootNavigation();
    return true;
  };

  const rootViewClasses = (target: View): Readonly<Record<string, boolean>> => {
    const motion = rootNavigationMotion();
    return {
      active: view() === target,
      'root-view-enter-forward': motion?.to === target && motion.direction === 'forward',
      'root-view-enter-backward': motion?.to === target && motion.direction === 'backward',
      'root-view-exit-forward': motion?.from === target && motion.direction === 'forward',
      'root-view-exit-backward': motion?.from === target && motion.direction === 'backward',
    };
  };

  // While a root-nav transition is running, the outgoing view stays visible (not `hidden`) so the
  // incoming view can overlay it instead of leaving an empty frame during the animation.
  const isViewVisible = (target: View): boolean => {
    const motion = rootNavigationMotion();
    return view() === target || motion?.from === target;
  };

  const navigate = (next: View): void => {
    transitionToRootView(next, () => {
      const changed = view() !== next;
      // Tapping the tab you're already on is a "go home" gesture: reset that section to its root
      // instead of restoring a remembered sub-route.
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

  const syncDocumentReadState = (): void => {
    migrateLegacyDocumentHash();
    migrateLegacyUserDocumentHash();
    const overlayPending = overlayFromLocationSearch(window.location.search);
    if (overlayPending && !isDocumentReadRoute(window.location.hash)) {
      const trail = loadDocumentTrail();
      if (!trail || trail.crumbs.length === 0) {
        beginDocumentTrail('official');
      }
    }
    migrateLegacyOverlaySearch();
    const active = isDocumentReadRoute(window.location.hash);
    setDocumentReadActive(active);
    if (!active) clearDocumentTrail();
    stripOrphanedOverlaySearch(active);
  };

  const handleHashChange = (event: HashChangeEvent): void => {
    if (event.isTrusted) {
      finishRootNavigationMotionIfActive();
    }
    redirectLegacySettingsRoutes();
    syncDocumentReadState();
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

  const navButtons = (): readonly HTMLButtonElement[] =>
    bottomNav ? Array.from(bottomNav.querySelectorAll<HTMLButtonElement>('.app-nav-button')) : [];

  const settleBottomNavBubbleMotion = (): void => {
    if (bottomNavBubbleSettleTimer) clearTimeout(bottomNavBubbleSettleTimer);
    bottomNavBubbleSettleTimer = setTimeout(() => {
      bottomNavBubbleSettleTimer = undefined;
      if (bottomNavDragging()) return;
      setBottomNavBubbleMotion({ origin: 'center', scaleX: 1, scaleY: 1, rotate: 0 });
    }, 380);
  };

  const scheduleBottomNavBubble = (): void => {
    if (bottomNavBubbleFrame !== undefined) cancelAnimationFrame(bottomNavBubbleFrame);
    bottomNavBubbleFrame = requestAnimationFrame(() => {
      bottomNavBubbleFrame = requestAnimationFrame(() => {
        bottomNavBubbleFrame = undefined;
        const nav = bottomNav;
        const activeIndex = VIEW_ORDER.get(view()) ?? 0;
        const button = navButtons()[activeIndex];
        if (!nav || !button) return;
        const navRect = nav.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        if (buttonRect.width <= 0 || buttonRect.height <= 0) return;
        const next = {
          left: buttonRect.left - navRect.left,
          top: buttonRect.top - navRect.top,
          width: buttonRect.width,
          height: buttonRect.height,
        };
        const previous = bottomNavBubble();
        const dx = next.left - previous.left;
        if (!bottomNavDragging() && Math.abs(dx) > 4) {
          const speed = Math.min(1, Math.abs(dx) / 64);
          const direction = Math.sign(dx);
          setBottomNavBubbleMotion({
            origin: direction > 0 ? 'left' : 'right',
            scaleX: 1 + speed * 0.58,
            scaleY: 1 - speed * 0.16,
            rotate: direction * speed * 7,
          });
          settleBottomNavBubbleMotion();
        }
        setBottomNavBubble(next);
      });
    });
  };

  const bindBottomNavResizeObserver = (element: HTMLElement): void => {
    bottomNav = element;
    bottomNavResizeObserver?.disconnect();
    bottomNavResizeObserver = new ResizeObserver(() => scheduleBottomNavBubble());
    bottomNavResizeObserver.observe(element);
    scheduleBottomNavBubble();
  };

  const navIndexAtX = (clientX: number): number => {
    const buttons = navButtons();
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect();
      const distance = Math.abs(clientX - (rect.left + rect.width / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  };

  const moveBottomNavBubbleTo = (clientX: number): BottomNavBubbleTravel => {
    const nav = bottomNav;
    const current = bottomNavBubble();
    const buttons = navButtons();
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!nav || !current || !first || !last) return { edge: 0, overscroll: 0 };
    const navRect = nav.getBoundingClientRect();
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const minCenter = firstRect.left - navRect.left + firstRect.width / 2;
    const maxCenter = lastRect.left - navRect.left + lastRect.width / 2;
    const relativeX = clientX - navRect.left;
    const edge: -1 | 0 | 1 = relativeX < 0 ? -1 : relativeX > navRect.width ? 1 : 0;
    const outsideDistance = edge === -1 ? -relativeX : edge === 1 ? relativeX - navRect.width : 0;
    const overscroll = Math.min(1, outsideDistance / Math.max(1, navRect.width * 0.35));
    const center = Math.max(minCenter, Math.min(maxCenter, relativeX));
    const left =
      edge === -1 ? 0 : edge === 1 ? navRect.width - current.width : center - current.width / 2;
    setBottomNavBubble({ ...current, left });
    return { edge, overscroll };
  };

  const bubbleStyle = (position: BottomNavBubblePosition): string => {
    const motion = bottomNavBubbleMotion();
    const pressScale = bottomNavPressed() ? 0.92 : 1;
    return `left:${position.left}px;top:${position.top}px;width:${position.width}px;height:${position.height}px;transform-origin:${motion.origin} center;transform:scaleX(${motion.scaleX * pressScale}) scaleY(${motion.scaleY * pressScale}) rotate(${motion.rotate}deg)`;
  };

  const finishBottomNavGesture = (event: PointerEvent | undefined, commit = true): void => {
    const gesture = bottomNavGesture;
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    const targetIndex = bottomNavDragIndex() ?? gesture.startIndex;
    const target = VIEWS[targetIndex];
    if (gesture.moved && commit) {
      suppressNavClickUntil = performance.now() + 350;
      if (target && target.id !== view()) {
        hapticFeedback('medium');
        navigate(target.id);
      }
    }
    bottomNavGesture = undefined;
    setBottomNavPressed(false);
    setBottomNavDragging(false);
    setBottomNavBubbleMotion({ origin: 'center', scaleX: 1, scaleY: 1, rotate: 0 });
    setBottomNavDragIndex(undefined);
    if (event && bottomNav?.hasPointerCapture(event.pointerId)) {
      bottomNav.releasePointerCapture(event.pointerId);
    }
    scheduleBottomNavBubble();
  };

  const handleBottomNavPointerDown = (event: PointerEvent): void => {
    if (!bottomNav || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const startIndex = navIndexAtX(event.clientX);
    const now = performance.now();
    bottomNavGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startIndex,
      lastX: event.clientX,
      lastTime: now,
      lastDirection: 0,
      moved: false,
    };
    setBottomNavDragIndex(startIndex);
    setBottomNavPressed(true);
    setBottomNavBubbleMotion({ origin: 'center', scaleX: 1, scaleY: 1, rotate: 0 });
    moveBottomNavBubbleTo(event.clientX);
  };

  const handleBottomNavPointerMove = (event: PointerEvent): void => {
    const gesture = bottomNavGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.moved) {
      if (Math.hypot(deltaX, deltaY) < 8) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        finishBottomNavGesture(event, false);
        return;
      }
      bottomNav?.setPointerCapture(event.pointerId);
      gesture.moved = true;
      setBottomNavDragging(true);
      suppressNavClickUntil = performance.now() + 350;
    }
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(8, now - gesture.lastTime);
    const deltaSinceLastMove = event.clientX - gesture.lastX;
    if (deltaSinceLastMove !== 0) gesture.lastDirection = Math.sign(deltaSinceLastMove);
    const velocity = Math.min(1, Math.abs(deltaSinceLastMove) / elapsed / 0.8);
    gesture.lastX = event.clientX;
    gesture.lastTime = now;
    const travel = moveBottomNavBubbleTo(event.clientX);
    setBottomNavBubbleMotion({
      origin: travel.edge === -1 ? 'left' : travel.edge === 1 ? 'right' : 'center',
      scaleX: Math.max(0.38, 1 + velocity * 0.72 - travel.overscroll * 0.62),
      scaleY: 1 - velocity * 0.18 + travel.overscroll * 0.12,
      rotate: gesture.lastDirection * (velocity * 8 + travel.overscroll * 2),
    });
    const nextIndex = navIndexAtX(event.clientX);
    if (nextIndex !== bottomNavDragIndex()) hapticFeedback('selection');
    setBottomNavDragIndex(nextIndex);
  };

  const handleBottomNavClick = (next: View): void => {
    if (performance.now() < suppressNavClickUntil) {
      suppressNavClickUntil = 0;
      return;
    }
    navigate(next);
  };

  const cancelBottomNavGesture = (event: PointerEvent): void => {
    finishBottomNavGesture(event, false);
  };

  const cancelBottomNavOnWindowBlur = (): void => {
    if (bottomNavGesture) finishBottomNavGesture(undefined, false);
  };

  createEffect(() => {
    if (!ready() || bottomNavDragIndex() !== undefined) return;
    view();
    scheduleBottomNavBubble();
  });

  const handleAppUpdate = (event: Event): void => {
    setAppUpdateWorker((event as CustomEvent<AppUpdateReadyDetail>).detail.worker);
  };

  const activateAvailableUpdate = (): void => {
    if (appUpdating()) return;
    setAppUpdating(true);
    setAppUpdateProgress(undefined);
    const apkUrl = availableApkUrl();
    if (apkUrl) {
      void installAndroidApk(apkUrl, (progress) => {
        setAppUpdateProgress({
          phase: 'download',
          loaded: progress.loaded,
          total: progress.total,
        });
      })
        .catch(() => undefined)
        .finally(() => {
          setAppUpdating(false);
          setAppUpdateProgress(undefined);
        });
      return;
    }
    const worker = appUpdateWorker();
    if (worker) {
      setAppUpdateProgress({ phase: 'activate' });
      activateAppUpdate(worker);
      return;
    }
    setAppUpdating(false);
    setAppUpdateProgress(undefined);
  };

  const connectInstalledModules = async (): Promise<void> => {
    const current = ready();
    if (!current) throw new Error('Локальный поиск ещё не готов.');
    const next = await swapMedicalCore(current, createBrowserCore, (core) => {
      const previousSearchCore = searchCore();
      const nextSearchCore = new WorkerSearchMedicalCore(core);
      setSearchCore(nextSearchCore);
      if (previousSearchCore) void previousSearchCore.close();
      const assistant = assistantCore();
      if (assistant) assistant.setBase(nextSearchCore);
      else setAssistantCore(new GroundedMedicalCore(nextSearchCore, modelController));
    });
    coreToClose = next.core;
    setReady(next);
    setDownloadedModuleCount(peekContentModuleRuntime()?.listInstalled().length ?? 0);
    notifyContentChanged();
  };

  const refreshDueReminders = (): void => {
    setDueReminderCount(dueReminderNotes(loadPatientNotes()).length);
  };
  const handleSearchShortcut = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== 'f' || (!event.ctrlKey && !event.metaKey) || event.altKey)
      return;
    const target = pickSearchFocusTarget();
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  };
  let reminderTimer: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    redirectLegacySettingsRoutes();
    syncDocumentReadState();
    setView(viewFromLocation());
    stopButtonHaptics = installUiFeedback();
    document.documentElement.classList.toggle(
      'platform-android',
      Capacitor.getPlatform() === 'android',
    );
    if (Capacitor.getPlatform() === 'android') {
      void checkNativeApkUpdate()
        .then((url) => {
          if (url) setAvailableApkUrl(url);
        })
        .catch(() => undefined);
    }
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', scheduleBottomNavBubble);
    window.addEventListener('pointerup', finishBottomNavGesture);
    window.addEventListener('pointercancel', cancelBottomNavGesture);
    window.addEventListener('blur', cancelBottomNavOnWindowBlur);
    window.addEventListener('keydown', handleSearchShortcut);
    window.addEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.addEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    refreshDueReminders();
    ensureUserLibraryIngestRunning();
    reminderTimer = setInterval(refreshDueReminders, 30_000);
    handleScroll();
    scheduleBottomNavBubble();
    if (Capacitor.getPlatform() === 'android') {
      nativeBackListener = await NativeApp.addListener('backButton', ({ canGoBack }) => {
        const openDialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
        const openDialog = openDialogs[openDialogs.length - 1];
        if (openDialog) {
          const closeButton = openDialog.querySelector<HTMLButtonElement>(
            '.overlay-dialog-header button',
          );
          closeButton?.click();
          if (!closeButton) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          return;
        }
        if (document.querySelector('.search-history-drawer-backdrop, .reader-column.open')) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          return;
        }
        const nativePrintBack = document.querySelector<HTMLButtonElement>(
          '[data-native-print-back]',
        );
        if (nativePrintBack) {
          nativePrintBack.click();
          return;
        }
        const route = window.location.hash.replace(/^#\/?/u, '');
        const action = nativeBackAction(route, view(), canGoBack);
        if (action.type === 'parent') {
          window.location.hash = action.hash;
        } else if (action.type === 'history') {
          window.history.back();
        } else if (action.type === 'search') {
          navigate('search');
        } else {
          void NativeApp.minimizeApp();
        }
      });
    }
    const bindModuleRuntime = (runtime: ReturnType<typeof getContentModuleRuntime>): void => {
      unsubscribeInstalledModules?.();
      const syncInstalledCount = (): void => {
        setDownloadedModuleCount(runtime.listInstalled().length);
      };
      syncInstalledCount();
      unsubscribeInstalledModules = runtime.subscribe(syncInstalledCount);
    };
    bindModuleRuntime(getContentModuleRuntime(MODULE_CATALOG));
    unsubscribeModuleRuntime = subscribeContentModuleRuntime(bindModuleRuntime);
    bootTimer = setTimeout(() => setBootSlow(true), SLOW_BOOT_DELAY_MS);
    try {
      const initialized = await initializeMedicalCore(createBrowserCore);
      const initializedSearchCore = new WorkerSearchMedicalCore(initialized.core);
      coreToClose = initialized.core;
      setSearchCore(initializedSearchCore);
      setAssistantCore(new GroundedMedicalCore(initializedSearchCore, modelController));
      setReady(initialized);
      void refreshContentModuleCatalog()
        .then((result) => {
          setAvailableModuleCount(countAvailableModules(result.catalog.modules));
        })
        .catch(() => undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Не удалось открыть локальную базу знаний.',
      );
    } finally {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = undefined;
    }
  });

  onCleanup(() => {
    document.documentElement.classList.remove('platform-android');
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('scroll', handleScroll);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('resize', scheduleBottomNavBubble);
    window.removeEventListener('pointerup', finishBottomNavGesture);
    window.removeEventListener('pointercancel', cancelBottomNavGesture);
    window.removeEventListener('blur', cancelBottomNavOnWindowBlur);
    window.removeEventListener('keydown', handleSearchShortcut);
    window.removeEventListener(PATIENT_NOTES_EVENT, refreshDueReminders);
    window.removeEventListener(APP_UPDATE_READY_EVENT, handleAppUpdate);
    if (reminderTimer) clearInterval(reminderTimer);
    if (bootTimer) clearTimeout(bootTimer);
    cancelRootNavigationMotionEnd();
    bottomNavResizeObserver?.disconnect();
    if (bottomNavBubbleFrame !== undefined) cancelAnimationFrame(bottomNavBubbleFrame);
    if (bottomNavBubbleSettleTimer) clearTimeout(bottomNavBubbleSettleTimer);
    unsubscribeInstalledModules?.();
    unsubscribeModuleRuntime?.();
    void nativeBackListener?.remove();
    stopButtonHaptics?.();
    if (coreToClose) void coreToClose.close();
    const activeSearchCore = searchCore();
    if (activeSearchCore) void activeSearchCore.close();
    void modelController.dispose();
  });

  return (
    <div
      class="app-shell archive-app"
      classList={{ 'app-shell--booting': !ready(), 'app-shell--native': isNativeShell }}
    >
      <Portal>
        <Toaster
          class="app-notification-host"
          position="top-center"
          closeButton
          duration={4200}
          containerAriaLabel="Уведомления"
          toastOptions={{
            className: 'app-notification',
            closeButtonAriaLabel: 'Закрыть уведомление',
          }}
        />
      </Portal>
      <main class="app-main">
        <section
          class="app-view"
          classList={rootViewClasses('assessments')}
          hidden={documentReadActive() || !isViewVisible('assessments')}
          aria-hidden={view() !== 'assessments'}
        >
          <AssessmentsView />
        </section>
        <section
          class="app-view"
          classList={rootViewClasses('calculators')}
          hidden={documentReadActive() || !isViewVisible('calculators')}
          aria-hidden={view() !== 'calculators'}
        >
          <CalculatorsView />
        </section>

        <Show
          when={ready()}
          fallback={
            <Show when={view() !== 'assessments' && view() !== 'calculators'}>
              <section class="boot-screen boot-screen--shell-booting archive-boot">
                <div class="boot-card paper-sheet">
                  <span class="boot-spinner" />
                  <p class="archive-kicker">Локальная медицинская база</p>
                  <h1>{error() ? 'База не открылась' : 'Открываем документы…'}</h1>
                  <p>
                    {error() ??
                      (bootSlow()
                        ? 'Загрузка базы занимает необычно много времени. Оставьте окно открытым, мы продолжаем загрузку в фоне.'
                        : 'Подготавливаем локальный поиск. Интернет для работы не нужен.')}
                  </p>
                  <Show when={error() || bootSlow()}>
                    <button type="button" onClick={() => window.location.reload()}>
                      Повторить загрузку
                    </button>
                  </Show>
                </div>
              </section>
            </Show>
          }
        >
          {(state) => (
            <>
              <section
                class="app-view"
                classList={rootViewClasses('search')}
                hidden={documentReadActive() || !isViewVisible('search')}
                aria-hidden={view() !== 'search'}
              >
                <SearchHome
                  baseCore={searchCore() ?? state().core}
                  assistantCore={assistantCore()}
                  localModelController={modelController}
                  active={view() === 'search'}
                  onOpenKnowledgeBase={() => navigate('modules')}
                  onOpenModelSettings={() => {
                    rememberReturnTo();
                    navigate('settings');
                  }}
                  appUpdateReady={Boolean(appUpdateWorker() || availableApkUrl())}
                  appUpdating={appUpdating()}
                  {...(appUpdateProgress()
                    ? { appUpdateProgress: appUpdateProgress() as AppUpdateProgress }
                    : {})}
                  onActivateAppUpdate={activateAvailableUpdate}
                />
              </section>
              <section
                class="app-view"
                classList={rootViewClasses('modules')}
                hidden={documentReadActive() || !isViewVisible('modules')}
                aria-hidden={view() !== 'modules'}
              >
                <KnowledgeBaseView
                  core={state().core}
                  status={state().status}
                  active={view() === 'modules'}
                  onContentChanged={connectInstalledModules}
                  onAvailableUpdates={setAvailableModuleCount}
                />
              </section>
              <section
                class="app-view"
                classList={rootViewClasses('settings')}
                hidden={documentReadActive() || !isViewVisible('settings')}
                aria-hidden={view() !== 'settings'}
              >
                <SettingsView controller={modelController} status={state().status} />
              </section>
              <section
                class="app-view"
                classList={rootViewClasses('notes')}
                hidden={documentReadActive() || !isViewVisible('notes')}
                aria-hidden={view() !== 'notes'}
              >
                <NotesView core={searchCore() ?? state().core} active={view() === 'notes'} />
              </section>
              <Show when={documentReadActive()}>
                <section class="app-view app-view--document-read active" aria-hidden={false}>
                  <DocumentPageHost
                    getCore={() => state().core}
                    reconnectContent={connectInstalledModules}
                  />
                </section>
              </Show>
            </>
          )}
        </Show>
      </main>

      <Show when={ready()}>
        <div class="floating-system-status" aria-live="polite">
          <ContentDownloadStatus floating />
        </div>
      </Show>

      <Show when={ready()}>
        <nav
          ref={bindBottomNavResizeObserver}
          class="app-bottom-nav"
          classList={{
            'app-bottom-nav--dragging': bottomNavDragging(),
            'app-bottom-nav--pressed': bottomNavPressed(),
          }}
          aria-label="Разделы приложения"
          onPointerDown={handleBottomNavPointerDown}
          onPointerMove={handleBottomNavPointerMove}
          onPointerUp={finishBottomNavGesture}
          onPointerCancel={cancelBottomNavGesture}
        >
          <span
            class="app-bottom-nav__bubble"
            style={bubbleStyle(bottomNavBubble())}
            aria-hidden="true"
          />
          {VIEWS.map((item, index) => {
            const selected = () => (bottomNavDragIndex() ?? VIEW_ORDER.get(view()) ?? 0) === index;
            const label = () => {
              if (item.id === 'modules') {
                return `${item.label}, доступно: ${availableModuleCount()}, загружено: ${downloadedModuleCount()}`;
              }
              if (item.id === 'notes' && dueReminderCount() > 0) {
                return `${item.label}, напоминаний: ${dueReminderCount()}`;
              }
              return item.label;
            };
            return (
              <div class="app-nav-item">
                <Show when={item.id === 'settings'}>
                  <ModelNavIndicator controller={modelController} />
                </Show>
                <button
                  class="app-nav-button"
                  classList={{ 'app-nav-button--active': selected() }}
                  type="button"
                  aria-label={label()}
                  aria-current={view() === item.id ? 'page' : undefined}
                  title={label()}
                  onClick={() => handleBottomNavClick(item.id)}
                >
                  <AppGlyph
                    name={item.icon}
                    class={`app-nav-button__icon${selected() ? ' app-nav-button__icon--active' : ''}`}
                  />
                  <Show when={item.id === 'modules' && availableModuleCount() > 0}>
                    <span class="app-nav-badge app-nav-badge--available" aria-hidden="true">
                      {availableModuleCount() > 99 ? '99+' : availableModuleCount()}
                    </span>
                  </Show>
                  <Show when={item.id === 'modules' && downloadedModuleCount() > 0}>
                    <span class="app-nav-badge app-nav-badge--downloaded" aria-hidden="true">
                      {downloadedModuleCount() > 99 ? '99+' : downloadedModuleCount()}
                    </span>
                  </Show>
                  <Show when={item.id === 'notes' && dueReminderCount() > 0}>
                    <span class="app-nav-badge app-nav-badge--reminder" aria-hidden="true">
                      {dueReminderCount() > 9 ? '9+' : dueReminderCount()}
                    </span>
                  </Show>
                </button>
              </div>
            );
          })}
        </nav>
      </Show>

      <Show when={ready() && showScrollTop()}>
        <button
          class="scroll-top-button"
          classList={{ 'scroll-top-button--notes': view() === 'notes' }}
          type="button"
          aria-label="Вернуться наверх"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <AppGlyph name="arrow-up" class="scroll-top-button__icon" />
        </button>
      </Show>
    </div>
  );
}
