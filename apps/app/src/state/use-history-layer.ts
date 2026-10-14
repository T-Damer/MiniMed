import { type Accessor, createEffect, onCleanup } from 'solid-js';

import { openHistoryLayer } from '@/state/history-layer';

/**
 * Makes something that opens over the page (a popover, a preview card, a menu) a history layer
 * while `open()` is true: back — the browser's, Android's, or a swipe — closes it before the page
 * under it goes. `close` is how the component closes itself; the component's own close paths
 * (Escape, a tap outside, a choice) just set its state, and the cleanup takes the entry off.
 */
export function useHistoryLayer(open: Accessor<boolean>, close: () => void): void {
  createEffect(() => {
    if (!open()) return;
    const layer = openHistoryLayer({ onPop: close });
    onCleanup(() => layer.dispose());
  });
}
