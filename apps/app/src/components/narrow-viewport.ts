import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** Phone width: sheets rise from the bottom edge and panels open as sheets below this. */
export const NARROW_VIEWPORT_QUERY = '(max-width: 760px)';

/** Whether the viewport is phone-width now, updated when it rotates or resizes. */
export function useNarrowViewport(): Accessor<boolean> {
  const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
  const [narrow, setNarrow] = createSignal(query.matches);
  const update = (): void => {
    setNarrow(query.matches);
  };
  query.addEventListener('change', update);
  onCleanup(() => query.removeEventListener('change', update));
  return narrow;
}
