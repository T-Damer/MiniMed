import { createSignal, onCleanup } from 'solid-js';

import type { RootView } from '@/app/root-view';

export type FloatingWindowResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface FloatingWindowState {
  readonly id: string;
  readonly view: RootView;
  readonly route: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zIndex: number;
  readonly collapsed: boolean;
}

const STORAGE_KEY = 'minimed.floating-windows.v3';
const MIN_WIDTH = 260;
const MIN_HEIGHT = 340;
const MAX_WINDOW_COUNT = 3;
const CASCADE_OFFSET = 34;

function isRootView(value: unknown): value is RootView {
  return (
    value === 'search' ||
    value === 'modules' ||
    value === 'assessments' ||
    value === 'calculators' ||
    value === 'notes' ||
    value === 'settings'
  );
}

function isRoute(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('#/') && value.length <= 2048;
}

function routeBelongsToView(route: string, view: RootView): boolean {
  const root = route.replace(/^#\/?/u, '').split('/')[0];
  if (root === view) return true;
  if (view === 'search' && root === 'history') return true;
  if (view === 'modules' && root === 'documents') return true;
  return view === 'settings' && route === '#/modules/model';
}

function normalizeWindowSizes(
  windows: readonly FloatingWindowState[],
): readonly FloatingWindowState[] {
  const first = windows[0];
  if (!first) return windows;
  return windows.map((windowState) => ({
    ...windowState,
    width: first.width,
    height: first.height,
  }));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function requestFrame(callback: FrameRequestCallback): number | undefined {
  if (typeof window.requestAnimationFrame !== 'function') {
    callback(0);
    return undefined;
  }
  return window.requestAnimationFrame(callback);
}

function cancelFrame(frame: number | undefined): void {
  if (frame !== undefined && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frame);
  }
}

function viewportSize(): { readonly width: number; readonly height: number } {
  const width =
    typeof document !== 'undefined' && document.documentElement.clientWidth > 0
      ? document.documentElement.clientWidth
      : window.innerWidth;
  const height =
    typeof document !== 'undefined' && document.documentElement.clientHeight > 0
      ? document.documentElement.clientHeight
      : window.innerHeight;
  return { width, height };
}

function readStoredWindows(): readonly FloatingWindowState[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index): FloatingWindowState[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<FloatingWindowState>;
      if (
        !(
          isRootView(candidate.view) &&
          isRoute(candidate.route) &&
          typeof candidate.x === 'number' &&
          Number.isFinite(candidate.x) &&
          typeof candidate.y === 'number' &&
          Number.isFinite(candidate.y) &&
          typeof candidate.width === 'number' &&
          Number.isFinite(candidate.width) &&
          typeof candidate.height === 'number' &&
          Number.isFinite(candidate.height) &&
          typeof candidate.zIndex === 'number' &&
          Number.isFinite(candidate.zIndex)
        )
      )
        return [];
      return [
        {
          id:
            typeof candidate.id === 'string' && candidate.id.length > 0
              ? candidate.id
              : `legacy-${index}-${candidate.view}`,
          view: candidate.view,
          route: candidate.route,
          x: candidate.x,
          y: candidate.y,
          width: candidate.width,
          height: candidate.height,
          zIndex: candidate.zIndex,
          collapsed: candidate.collapsed === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

function persistWindows(windows: readonly FloatingWindowState[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(windows));
  } catch {
    // Floating layout is optional; the page remains usable when storage is unavailable.
  }
}

function defaultRoute(view: RootView): string {
  const route = window.location.hash;
  const root = route.replace(/^#\/?/u, '').split('/')[0];
  return route.startsWith('#/') && root === view ? route : `#/${view}`;
}

function defaultWindow(
  id: string,
  view: RootView,
  route: string,
  zIndex: number,
): FloatingWindowState {
  const { width: viewportWidth, height: viewportHeight } = viewportSize();
  const width = clamp(
    Math.round(viewportWidth * 0.25),
    Math.min(MIN_WIDTH, viewportWidth),
    viewportWidth,
  );
  const height = clamp(
    Math.round(width * 1.35),
    Math.min(MIN_HEIGHT, viewportHeight),
    viewportHeight,
  );
  return {
    id,
    view,
    route,
    x: viewportWidth - width,
    y: clamp(72, 0, viewportHeight - height),
    width,
    height,
    zIndex,
    collapsed: false,
  };
}

function clampWindow(windowState: FloatingWindowState): FloatingWindowState {
  const { width: viewportWidth, height: viewportHeight } = viewportSize();
  const minWidth = Math.min(MIN_WIDTH, viewportWidth);
  const minHeight = Math.min(MIN_HEIGHT, viewportHeight);
  const width = Math.min(Math.max(minWidth, windowState.width), viewportWidth);
  const height = Math.min(Math.max(minHeight, windowState.height), viewportHeight);
  return {
    ...windowState,
    width,
    height,
    x: clamp(windowState.x, 0, viewportWidth - width),
    y: clamp(windowState.y, 0, viewportHeight - height),
  };
}

export function createFloatingWindows() {
  const restoredWindows = normalizeWindowSizes(
    readStoredWindows()
      .filter((windowState) => windowState.view !== 'settings')
      .sort((left, right) => left.zIndex - right.zIndex)
      .slice(-MAX_WINDOW_COUNT),
  ).map(clampWindow);
  const [windows, setWindows] = createSignal<readonly FloatingWindowState[]>(restoredWindows);
  const [activeWindowId, setActiveWindowId] = createSignal<string | undefined>(
    restoredWindows.at(-1)?.id,
  );
  const [stacked, setStacked] = createSignal(restoredWindows.length > 1);
  const [resizePreview, setResizePreview] = createSignal<readonly FloatingWindowState[]>();
  const [dragPreview, setDragPreview] = createSignal<readonly FloatingWindowState[]>();
  const [resizingWindowId, setResizingWindowId] = createSignal<string>();
  const [loadingWindowIds, setLoadingWindowIds] = createSignal<ReadonlySet<string>>(new Set());
  const [fullscreenWindowId, setFullscreenWindowId] = createSignal<string>();
  let nextZIndex = Math.max(100, ...windows().map((windowState) => windowState.zIndex + 1));
  let activeDrag:
    | {
        readonly id: string;
        readonly pointerId: number;
        readonly startX: number;
        readonly startY: number;
        readonly wasStacked: boolean;
        readonly originWindows: readonly FloatingWindowState[];
        moved: boolean;
      }
    | undefined;
  let activeResize:
    | {
        readonly id: string;
        readonly pointerId: number;
        readonly startX: number;
        readonly startY: number;
        readonly origin: FloatingWindowState;
        readonly corner: FloatingWindowResizeCorner;
      }
    | undefined;
  let resizeFrame: number | undefined;
  let pendingResizeMove: PointerEvent | undefined;
  let dragFrame: number | undefined;
  let pendingDragMove: PointerEvent | undefined;
  const frameListeners = new Map<
    string,
    {
      readonly frame: HTMLIFrameElement;
      readonly load: () => void;
      readonly sync: () => void;
    }
  >();
  let nextWindowId = 0;

  const createWindowId = (view: RootView): string =>
    `${view}-${Date.now().toString(36)}-${(nextWindowId++).toString(36)}`;

  const resolveWindowId = (idOrView: string): string | undefined =>
    windows().find((windowState) => windowState.id === idOrView)?.id ??
    windows().find((windowState) => windowState.view === idOrView)?.id;

  const commit = (next: readonly FloatingWindowState[]): void => {
    const normalized = normalizeWindowSizes(next);
    setWindows(normalized);
    persistWindows(normalized);
  };

  const displayWindows = (): readonly FloatingWindowState[] =>
    resizePreview() ?? dragPreview() ?? windows();

  const cascadeOffsetFor = (id: string): { readonly x: number; readonly y: number } => {
    const { width: viewportWidth, height: viewportHeight } = viewportSize();
    const orderedWindows = [...displayWindows()].sort((left, right) => right.zIndex - left.zIndex);
    const index = orderedWindows.findIndex((windowState) => windowState.id === id);
    if (index < 0 || orderedWindows.length < 2) return { x: 0, y: 0 };
    const lead = orderedWindows[0];
    if (!lead) return { x: 0, y: 0 };
    const depth = orderedWindows.length - 1;
    const cascadeOffset = Math.max(
      0,
      Math.min(
        CASCADE_OFFSET,
        (viewportWidth - lead.width) / depth,
        (viewportHeight - lead.height) / depth,
      ),
    );
    const minX = lead.x - depth * cascadeOffset;
    const maxX = lead.x + lead.width;
    const minY = lead.y - depth * cascadeOffset;
    const maxY = lead.y + lead.height;
    const correctionX = minX < 0 ? -minX : maxX > viewportWidth ? viewportWidth - maxX : 0;
    const correctionY = minY < 0 ? -minY : maxY > viewportHeight ? viewportHeight - maxY : 0;
    return {
      x: correctionX - index * cascadeOffset,
      y: correctionY - index * cascadeOffset,
    };
  };

  const setStackedMode = (): void => {
    if (windows().length > 1) {
      const firstWindow = windows()[0];
      if (!firstWindow) return;
      const first = clampWindow(firstWindow);
      commit(
        windows().map((windowState) => ({
          ...windowState,
          x: first.x,
          y: first.y,
          width: first.width,
          height: first.height,
        })),
      );
    }
    setStacked(windows().length > 1);
  };

  const focus = (id: string): void => {
    const resolvedId = resolveWindowId(id);
    const current = windows().find((windowState) => windowState.id === resolvedId);
    if (!current) return;
    setActiveWindowId(current.id);
    if (current.zIndex === nextZIndex - 1) return;
    const zIndex = nextZIndex++;
    commit(
      windows().map((windowState) =>
        windowState.id === current.id ? { ...windowState, zIndex } : windowState,
      ),
    );
  };

  const open = (view: RootView, route = defaultRoute(view)): void => {
    if (view === 'settings') return;
    const existingWindow = windows().find(
      (windowState) => windowState.view === view && windowState.route === route,
    );
    if (existingWindow) {
      focus(existingWindow.id);
      return;
    }
    if (windows().length >= MAX_WINDOW_COUNT) return;
    const existing = windows();
    const first = existing[0];
    const nextWindow = defaultWindow(createWindowId(view), view, route, nextZIndex++);
    setActiveWindowId(nextWindow.id);
    commit([
      ...existing,
      first
        ? clampWindow({
            ...nextWindow,
            x: first.x,
            y: first.y,
            width: first.width,
            height: first.height,
          })
        : nextWindow,
    ]);
    setStackedMode();
  };

  const close = (id: string): void => {
    const resolvedId = resolveWindowId(id);
    if (!resolvedId) return;
    setFrameLoading(resolvedId, false);
    if (fullscreenWindowId() === resolvedId) setFullscreenWindowId(undefined);
    const next = windows().filter((windowState) => windowState.id !== resolvedId);
    if (activeWindowId() === resolvedId) {
      const nextActive = [...next].sort((left, right) => right.zIndex - left.zIndex)[0]?.id;
      setActiveWindowId(nextActive);
    }
    commit(next);
    setStackedMode();
  };

  const toggle = (view: RootView, route = defaultRoute(view)): void => {
    const existingWindow = windows().find(
      (windowState) => windowState.view === view && windowState.route === route,
    );
    if (existingWindow) close(existingWindow.id);
    else open(view, route);
  };

  const setRoute = (id: string, route: string): void => {
    if (!isRoute(route)) return;
    const resolvedId = resolveWindowId(id);
    if (!resolvedId) return;
    const current = windows().find((windowState) => windowState.id === resolvedId);
    if (!current || !routeBelongsToView(route, current.view) || current.route === route) return;
    commit(
      windows().map((windowState) =>
        windowState.id === resolvedId ? { ...windowState, route } : windowState,
      ),
    );
  };

  const toggleCollapsed = (id: string): void => {
    const resolvedId = resolveWindowId(id);
    if (!resolvedId) return;
    commit(
      windows().map((windowState) =>
        windowState.id === resolvedId
          ? { ...windowState, collapsed: !windowState.collapsed }
          : windowState,
      ),
    );
  };

  const toggleFullscreen = (id: string): void => {
    const resolvedId = resolveWindowId(id);
    if (!resolvedId) return;
    if (fullscreenWindowId() === resolvedId) {
      setFullscreenWindowId(undefined);
      return;
    }
    focus(resolvedId);
    setFullscreenWindowId(resolvedId);
  };

  const setFrameLoading = (id: string, loading: boolean): void => {
    setLoadingWindowIds((current) => {
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const stopResize = (): void => {
    if (!activeResize) return;
    cancelFrame(resizeFrame);
    resizeFrame = undefined;
    const pending = pendingResizeMove;
    pendingResizeMove = undefined;
    if (pending) applyResizeMove(pending);
    const preview = resizePreview();
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    activeResize = undefined;
    if (preview) commit(preview);
    setResizePreview(undefined);
    setResizingWindowId(undefined);
  };

  const applyResizeMove = (event: PointerEvent): void => {
    const resize = activeResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    const deltaX = event.clientX - resize.startX;
    const deltaY = event.clientY - resize.startY;
    const growsLeft = resize.corner.includes('w');
    const growsTop = resize.corner.includes('n');
    const resized = clampWindow({
      ...resize.origin,
      x: resize.origin.x + (growsLeft ? deltaX : 0),
      y: resize.origin.y + (growsTop ? deltaY : 0),
      width: resize.origin.width + (growsLeft ? -deltaX : deltaX),
      height: resize.origin.height + (growsTop ? -deltaY : deltaY),
    });
    setResizePreview(
      windows().map((windowState) => ({
        ...windowState,
        ...(windowState.id === resize.id ? { x: resized.x, y: resized.y } : {}),
        width: resized.width,
        height: resized.height,
      })),
    );
  };

  const handleResizeMove = (event: PointerEvent): void => {
    const resize = activeResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    pendingResizeMove = event;
    if (resizeFrame === undefined) {
      resizeFrame = requestFrame(() => {
        resizeFrame = undefined;
        const pending = pendingResizeMove;
        pendingResizeMove = undefined;
        if (pending) applyResizeMove(pending);
      });
    }
  };

  const beginResize = (
    id: string,
    event: PointerEvent,
    corner: FloatingWindowResizeCorner,
  ): void => {
    if (event.button !== 0) return;
    const resolvedId = resolveWindowId(id);
    const origin = windows().find((windowState) => windowState.id === resolvedId);
    if (!origin || activeWindowId() !== origin.id) return;
    event.preventDefault();
    activeResize = {
      id: origin.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      corner,
    };
    setResizingWindowId(id);
    setResizePreview(undefined);
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  const stopDrag = (): void => {
    if (!activeDrag) return;
    cancelFrame(dragFrame);
    dragFrame = undefined;
    const pending = pendingDragMove;
    pendingDragMove = undefined;
    if (pending) applyDragMove(pending);
    const drag = activeDrag;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    activeDrag = undefined;
    const preview = dragPreview();
    if (preview) commit(preview);
    setDragPreview(undefined);
    if (!drag.moved && !preview) {
      focus(drag.id);
    }
  };

  const applyDragMove = (event: PointerEvent): void => {
    const drag = activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.moved = true;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    setDragPreview(
      windows().map((windowState) => {
        const origin = drag.originWindows.find((candidate) => candidate.id === windowState.id);
        if (!origin || (!drag.wasStacked && windowState.id !== drag.id)) return windowState;
        return clampWindow({ ...windowState, x: origin.x + deltaX, y: origin.y + deltaY });
      }),
    );
  };

  const handlePointerMove = (event: PointerEvent): void => {
    const drag = activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    pendingDragMove = event;
    if (dragFrame === undefined) {
      dragFrame = requestFrame(() => {
        dragFrame = undefined;
        const pending = pendingDragMove;
        pendingDragMove = undefined;
        if (pending) applyDragMove(pending);
      });
    }
  };

  const beginDrag = (id: string, event: PointerEvent): void => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button')))
      return;
    const resolvedId = resolveWindowId(id);
    const current = windows().find((windowState) => windowState.id === resolvedId);
    if (!current) return;
    event.preventDefault();
    focus(current.id);
    activeDrag = {
      id: current.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      wasStacked: stacked(),
      originWindows: windows(),
      moved: false,
    };
    setDragPreview(undefined);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  };

  const handleResize = (): void => {
    commit(windows().map(clampWindow));
  };

  const bindFrame = (id: string, frame: HTMLIFrameElement): void => {
    const previous = frameListeners.get(id);
    previous?.frame.removeEventListener('load', previous.load);
    previous?.frame.contentWindow?.removeEventListener('hashchange', previous.sync);
    const sync = (): void => {
      try {
        const route = frame.contentWindow?.location.hash;
        if (route) setRoute(id, route);
      } catch {
        // Same-origin frames are expected; a detached frame can be ignored during cleanup.
      }
    };
    const load = (): void => {
      setLoadingWindowIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      sync();
    };
    setFrameLoading(id, true);
    frame.addEventListener('load', load);
    frame.contentWindow?.addEventListener('hashchange', sync);
    frameListeners.set(id, { frame, load, sync });
    if (frame.contentDocument?.readyState === 'complete') load();
    sync();
  };

  const unbindFrame = (id: string, frame: HTMLIFrameElement): void => {
    const listener = frameListeners.get(id);
    if (!listener || listener.frame !== frame) return;
    listener.frame.removeEventListener('load', listener.load);
    listener.frame.contentWindow?.removeEventListener('hashchange', listener.sync);
    frameListeners.delete(id);
    setFrameLoading(id, false);
  };

  window.addEventListener('resize', handleResize);
  onCleanup(() => {
    stopDrag();
    stopResize();
    for (const listener of frameListeners.values()) {
      listener.frame.removeEventListener('load', listener.load);
      listener.frame.contentWindow?.removeEventListener('hashchange', listener.sync);
    }
    window.removeEventListener('resize', handleResize);
  });

  return {
    windows,
    activeWindowId,
    fullscreenWindowId,
    stacked,
    isFloating: (view: RootView, route?: string): boolean =>
      windows().some(
        (windowState) =>
          windowState.view === view && (route === undefined || windowState.route === route),
      ),
    windowFor: (id: string): FloatingWindowState | undefined => {
      const resolvedId = resolveWindowId(id);
      return windows().find((windowState) => windowState.id === resolvedId);
    },
    windowForRoute: (view: RootView, route: string): FloatingWindowState | undefined =>
      windows().find((windowState) => windowState.view === view && windowState.route === route),
    displayWindowFor: (id: string): FloatingWindowState | undefined =>
      displayWindows().find((windowState) => windowState.id === id),
    cascadeOffsetFor,
    resizingWindowId,
    isFrameLoading: (id: string): boolean => loadingWindowIds().has(id),
    open,
    close,
    toggle,
    focus,
    beginDrag,
    beginResize,
    bindFrame,
    unbindFrame,
    setRoute,
    toggleCollapsed,
    toggleFullscreen,
  };
}
