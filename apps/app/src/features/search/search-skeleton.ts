import { type Accessor, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { type LayoutColumnCount, layoutColumnCount } from '@/state/layout-columns';

/** Rows of placeholder cards: enough to fill a phone screen under the field, no more. */
const SKELETON_ROWS = 2;

/** Same column rule as the real result grid, so the placeholder cards are as wide as the groups. */
export function skeletonColumnCount(viewportWidth: number): LayoutColumnCount {
  return layoutColumnCount(viewportWidth);
}

export function skeletonCardCount(columns: number): number {
  return Math.max(1, Math.floor(columns)) * SKELETON_ROWS;
}

export interface LingerController {
  /** Reports whether the source is active now; an inactive source unmounts after the linger. */
  readonly update: (active: boolean) => void;
  readonly dispose: () => void;
}

/** Keeps `setMounted(true)` for `lingerMs` after the source turns inactive, so a fade-out can play. */
export function createLingerController(
  setMounted: (mounted: boolean) => void,
  lingerMs: () => number,
): LingerController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return {
    update: (active) => {
      cancel();
      if (active) {
        setMounted(true);
        return;
      }
      const duration = lingerMs();
      if (duration <= 0) {
        setMounted(false);
        return;
      }
      timer = setTimeout(() => setMounted(false), duration);
    },
    dispose: cancel,
  };
}

/**
 * True while `active` is true and for `lingerMs` after it turns false, so an element can fade out
 * in place before it unmounts. The duration is read on every change so a motion setting applies.
 */
export function createLingeringFlag(
  active: Accessor<boolean>,
  lingerMs: () => number,
): Accessor<boolean> {
  const [mounted, setMounted] = createSignal(active());
  const controller = createLingerController(setMounted, lingerMs);
  createEffect(on(active, controller.update, { defer: true }));
  onCleanup(controller.dispose);
  return mounted;
}
