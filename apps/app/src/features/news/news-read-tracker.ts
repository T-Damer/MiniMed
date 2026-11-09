/**
 * Scrolling past an item marks it read (ADR-0024, amended 2026-10-08). Each item that left the
 * screen upward is reported once; the writes are batched so a long fling costs one storage write
 * per window, not one per item.
 */
export interface ReadTracker {
  /** An item the reader scrolled past. */
  track(itemId: string): void;
  /** Writes what is pending now (leaving the page, the tab going to the background). */
  flush(): void;
  /** Flushes and stops. */
  dispose(): void;
}

export const READ_BATCH_MS = 900;

export function createReadTracker(
  commit: (itemIds: readonly string[]) => void,
  delayMs = READ_BATCH_MS,
): ReadTracker {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pending.size === 0) return;
    const ids = [...pending];
    pending.clear();
    commit(ids);
  };
  return {
    track(itemId) {
      pending.add(itemId);
      // A throttle window, not a debounce: a fling that never pauses must still write.
      timer ??= setTimeout(flush, delayMs);
    },
    flush,
    dispose: flush,
  };
}

export interface PassedEntry {
  readonly isIntersecting: boolean;
  readonly rootBounds: { readonly top: number } | null;
  readonly boundingClientRect: { readonly bottom: number; readonly height: number };
}

/** True when the element is out of view because it scrolled off the top (not because it is below or hidden). */
export function hasPassedTop(entry: PassedEntry): boolean {
  return (
    !entry.isIntersecting &&
    entry.rootBounds !== null &&
    entry.boundingClientRect.height > 0 &&
    entry.boundingClientRect.bottom <= entry.rootBounds.top
  );
}

export interface PassedObserver {
  observe(element: Element, itemId: string): void;
  disconnect(): void;
}

/** True when a box lies wholly above the top of the viewport (a hidden, zero-height one never does). */
export function isAboveTop(
  box: { readonly bottom: number; readonly height: number },
  top: number,
): boolean {
  return box.height > 0 && box.bottom <= top;
}

/**
 * Reports each observed element once, the first time it is seen above the viewport.
 *
 * An IntersectionObserver fires only when an element's intersection changes, so a row that goes
 * from below the screen to above it in one step (a fast fling, a jump of the scroll position, a
 * 5000 px wheel) never fires and was never marked read (E2E-MAIN, 2026-11-09: 5 of 60 rows). Every
 * callback therefore also sweeps the rows still watched and reports those that now lie above the
 * top; the callback runs after layout, so the boxes read are already computed.
 */
export function createPassedObserver(onPassed: (itemId: string) => void): PassedObserver {
  const ids = new Map<Element, string>();
  const report = (element: Element, id: string): void => {
    observer.unobserve(element);
    ids.delete(element);
    onPassed(id);
  };
  const observer = new IntersectionObserver((entries) => {
    let top = 0;
    for (const entry of entries) {
      if (entry.rootBounds) top = entry.rootBounds.top;
      if (!hasPassedTop(entry)) continue;
      const id = ids.get(entry.target);
      if (id !== undefined) report(entry.target, id);
    }
    for (const [element, id] of ids) {
      if (!element.isConnected) {
        observer.unobserve(element);
        ids.delete(element);
      } else if (isAboveTop(element.getBoundingClientRect(), top)) report(element, id);
    }
  });
  return {
    observe(element, itemId) {
      ids.set(element, itemId);
      observer.observe(element);
    },
    disconnect: () => {
      observer.disconnect();
      ids.clear();
    },
  };
}
