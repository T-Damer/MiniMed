import { createSignal, onCleanup, onMount } from 'solid-js';

/** Must match `breakpoints.css` tablet query. Wider viewports keep this two-column cap. */
export const LAYOUT_TABLET_MIN_PX = 760;

export function layoutColumnCount(widthPx: number): 1 | 2 {
  if (widthPx >= LAYOUT_TABLET_MIN_PX) return 2;
  return 1;
}

export function chunkLayoutRows<T>(
  items: readonly T[],
  columns: number,
): readonly (readonly T[])[] {
  const cols = Math.max(1, Math.floor(columns));
  if (items.length === 0) return [];
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += cols) {
    rows.push(items.slice(index, index + cols));
  }
  return rows;
}

export function createLayoutColumnCount() {
  const [columns, setColumns] = createSignal<1 | 2>(
    typeof window === 'undefined' ? 1 : layoutColumnCount(window.innerWidth),
  );

  onMount(() => {
    const tabletQuery = window.matchMedia(`(min-width: ${LAYOUT_TABLET_MIN_PX}px)`);
    const sync = (): void => {
      setColumns(layoutColumnCount(window.innerWidth));
    };
    tabletQuery.addEventListener('change', sync);
    sync();
    onCleanup(() => {
      tabletQuery.removeEventListener('change', sync);
    });
  });

  return columns;
}
