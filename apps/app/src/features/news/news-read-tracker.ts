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

/** Reports each observed element once, the first time it is seen above the viewport. */
export function createPassedObserver(onPassed: (itemId: string) => void): PassedObserver {
  const ids = new WeakMap<Element, string>();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!hasPassedTop(entry)) continue;
      const id = ids.get(entry.target);
      observer.unobserve(entry.target);
      if (id !== undefined) onPassed(id);
    }
  });
  return {
    observe(element, itemId) {
      ids.set(element, itemId);
      observer.observe(element);
    },
    disconnect: () => observer.disconnect(),
  };
}
