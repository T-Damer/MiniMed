import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFloatingWindows } from '@/state/floating-windows';

function installWindowMock(): {
  readonly storage: Map<string, string>;
  readonly listeners: Map<string, EventListener>;
} {
  const storage = new Map<string, string>();
  const listeners = new Map<string, EventListener>();
  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 900,
    location: { hash: '#/notes' },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  });
  return { storage, listeners };
}

describe('floating windows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens, toggles, and persists a root page window', () => {
    const { storage } = installWindowMock();
    let dispose: (() => void) | undefined;
    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      manager = createFloatingWindows();
      manager.open('notes');
    });

    expect(manager?.isFloating('notes')).toBe(true);
    expect(manager?.windowFor('notes')).toEqual(
      expect.objectContaining({ view: 'notes', route: '#/notes', width: 320, height: 432 }),
    );
    expect(storage.get('minimed.floating-windows.v3')).toContain('notes');

    manager?.setRoute('notes', '#/notes/card/1');
    expect(manager?.windowFor('notes')?.route).toBe('#/notes/card/1');
    manager?.setRoute('notes', '#/calculators');
    expect(manager?.windowFor('notes')?.route).toBe('#/notes/card/1');
    manager?.open('search');
    expect(manager?.windowFor('search')?.route).toBe('#/search');
    expect(manager?.stacked()).toBe(true);
    expect(manager?.windowFor('search')).toEqual(
      expect.objectContaining({
        x: manager?.windowFor('notes')?.x,
        y: manager?.windowFor('notes')?.y,
        width: manager?.windowFor('notes')?.width,
        height: manager?.windowFor('notes')?.height,
      }),
    );

    manager?.toggle('notes', '#/notes/card/1');
    expect(manager?.windows()).toHaveLength(1);
    manager?.toggle('search', '#/search');
    expect(manager?.windows()).toEqual([]);
    dispose?.();
  });

  it('restores valid persisted windows on the next manager instance', () => {
    const { storage } = installWindowMock();
    storage.set(
      'minimed.floating-windows.v3',
      JSON.stringify([
        { view: 'search', route: '#/search', x: 20, y: 80, width: 480, height: 360, zIndex: 100 },
      ]),
    );

    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((dispose) => {
      manager = createFloatingWindows();
      expect(manager.windowFor('search')).toEqual(
        expect.objectContaining({ view: 'search', x: 20, y: 80 }),
      );
      dispose();
    });
  });

  it('previews corner resize and commits it only after the gesture ends', () => {
    const { listeners } = installWindowMock();
    let dispose: (() => void) | undefined;
    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      manager = createFloatingWindows();
      manager.open('notes');
    });

    const origin = manager?.windowFor('notes');
    const down = {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent;
    manager?.beginResize('notes', down, 'se');
    listeners.get('pointermove')?.({
      pointerId: 1,
      clientX: 160,
      clientY: 160,
    } as unknown as PointerEvent);

    expect(manager?.windowFor('notes')).toEqual(origin);
    expect(manager?.displayWindowFor(origin?.id ?? '')?.width).toBe((origin?.width ?? 0) + 60);
    listeners.get('pointerup')?.({ pointerId: 1 } as unknown as PointerEvent);
    expect(manager?.windowFor('notes')?.width).toBe((origin?.width ?? 0) + 60);
    dispose?.();
  });

  it('previews dragging and persists the new position only after the gesture ends', () => {
    const { storage, listeners } = installWindowMock();
    vi.stubGlobal('Element', class {});
    let dispose: (() => void) | undefined;
    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      manager = createFloatingWindows();
      manager.open('notes');
    });

    const origin = manager?.windowFor('notes');
    const down = {
      button: 0,
      pointerId: 2,
      clientX: 100,
      clientY: 100,
      target: undefined,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent;
    manager?.beginDrag('notes', down);
    const persisted = storage.get('minimed.floating-windows.v3');
    listeners.get('pointermove')?.({
      pointerId: 2,
      clientX: 80,
      clientY: 110,
    } as unknown as PointerEvent);

    expect(manager?.windowFor('notes')).toEqual(origin);
    expect(storage.get('minimed.floating-windows.v3')).toBe(persisted);
    listeners.get('pointerup')?.({ pointerId: 2 } as unknown as PointerEvent);
    expect(manager?.windowFor('notes')?.x).toBe((origin?.x ?? 0) - 20);
    expect(manager?.windowFor('notes')?.y).toBe((origin?.y ?? 0) + 10);
    expect(storage.get('minimed.floating-windows.v3')).not.toBe(persisted);
    dispose?.();
  });

  it('does not open settings in a mini-window', () => {
    installWindowMock();
    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((dispose) => {
      manager = createFloatingWindows();
      manager.open('settings');
      expect(manager.windows()).toEqual([]);
      dispose();
    });
  });

  it('keeps at most three windows and puts the focused header on top of the stack', () => {
    installWindowMock();
    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((dispose) => {
      manager = createFloatingWindows();
      manager.open('notes');
      manager.open('search');
      manager.open('modules');
      manager.open('assessments');

      expect(manager.windows()).toHaveLength(3);
      expect(manager.isFloating('assessments')).toBe(false);
      expect(manager.stacked()).toBe(true);

      manager.focus('notes');
      const ordered = [...manager.windows()].sort((left, right) => right.zIndex - left.zIndex);
      expect(ordered[0]?.view).toBe('notes');
      dispose();
    });
  });

  it('cascades headers diagonally and toggles temporary fullscreen', () => {
    installWindowMock();
    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((dispose) => {
      manager = createFloatingWindows();
      manager.open('notes');
      manager.open('search');
      manager.open('modules');

      const ordered = [...manager.windows()].sort((left, right) => right.zIndex - left.zIndex);
      expect(manager.cascadeOffsetFor(ordered[0]?.id ?? '')).toEqual({ x: 0, y: 0 });
      expect(manager.cascadeOffsetFor(ordered[1]?.id ?? '')).toEqual({ x: -34, y: -34 });
      expect(manager.cascadeOffsetFor(ordered[2]?.id ?? '')).toEqual({ x: -68, y: -68 });

      manager.toggleFullscreen(ordered[1]?.id ?? '');
      expect(manager.fullscreenWindowId()).toBe(ordered[1]?.id);
      expect(manager.activeWindowId()).toBe(ordered[1]?.id);
      manager.toggleFullscreen(ordered[1]?.id ?? '');
      expect(manager.fullscreenWindowId()).toBeUndefined();
      dispose();
    });
  });

  it('keeps separate windows for separate routes in the same root section', () => {
    installWindowMock();
    let manager: ReturnType<typeof createFloatingWindows> | undefined;
    createRoot((dispose) => {
      manager = createFloatingWindows();
      manager.open('calculators', '#/calculators');
      manager.open('calculators', '#/calculators/bmi');

      expect(manager.windows()).toHaveLength(2);
      expect(manager.windows().map((windowState) => windowState.route)).toEqual([
        '#/calculators',
        '#/calculators/bmi',
      ]);
      expect(manager.windows()[0]?.id).not.toBe(manager.windows()[1]?.id);
      dispose();
    });
  });
});
