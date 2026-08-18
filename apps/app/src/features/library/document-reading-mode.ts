import { createEffect, createSignal, onCleanup } from 'solid-js';

import {
  getBookReadingMode,
  setBookReadingMode,
  subscribeAppPreferences,
} from '@/state/app-preferences';
import { parseDocumentReadRoute } from '@/state/document-route';

export function isUserDocumentReadRoute(hash = window.location.hash): boolean {
  return parseDocumentReadRoute(hash)?.kind === 'user';
}

export function useDocumentBookReadingMode() {
  const [bookMode, setBookMode] = createSignal(getBookReadingMode());
  const [userDocRoute, setUserDocRoute] = createSignal(isUserDocumentReadRoute());

  createEffect(() => {
    const syncRoute = (): void => {
      setUserDocRoute(isUserDocumentReadRoute());
    };
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    onCleanup(() => window.removeEventListener('hashchange', syncRoute));
  });

  createEffect(() => {
    const unsubscribe = subscribeAppPreferences((preferences) => {
      setBookMode(preferences.bookReadingMode);
    });
    onCleanup(unsubscribe);
  });

  const toggleBookMode = (): void => {
    const next = !bookMode();
    setBookMode(next);
    setBookReadingMode(next);
  };

  return {
    bookMode,
    showBookModeButton: userDocRoute,
    toggleBookMode,
  };
}

export function useBookReadingModeActive() {
  const [bookMode, setBookMode] = createSignal(getBookReadingMode());
  createEffect(() => {
    const unsubscribe = subscribeAppPreferences((preferences) => {
      setBookMode(preferences.bookReadingMode);
    });
    onCleanup(unsubscribe);
  });
  return bookMode;
}
