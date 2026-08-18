import { onCleanup, onMount } from 'solid-js';

import {
  createFindShortcutGate,
  isFindShortcut,
  pickSearchFocusTarget,
} from '@/state/search-focus-target';

export function useFindShortcut(): void {
  const gate = createFindShortcutGate();
  const handleSearchShortcut = (event: KeyboardEvent): void => {
    if (!isFindShortcut(event)) return;
    const target = pickSearchFocusTarget();
    if (!target) return;
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    if (!gate.shouldIntercept(event.timeStamp)) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  };

  onMount(() => {
    window.addEventListener('keydown', handleSearchShortcut);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleSearchShortcut);
  });
}
