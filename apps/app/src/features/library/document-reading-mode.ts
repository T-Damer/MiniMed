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

/** Set by the active user-document reader: whether the file has extractable text. */
const [userDocumentTextAvailable, setUserDocumentTextAvailable] = createSignal(true);

export function markUserDocumentTextAvailable(available: boolean): void {
  setUserDocumentTextAvailable(available);
}

/** Set by the active user-document reader: whether the opened file is a PDF. */
const [userDocumentPdfActive, setUserDocumentPdfActive] = createSignal(false);

export function markUserDocumentPdf(active: boolean): void {
  setUserDocumentPdfActive(active);
}

const TWO_PAGE_KEY = 'minimed.userDocTwoPage';

function readTwoPageMode(): boolean {
  try {
    return localStorage.getItem(TWO_PAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Shared two-page PDF spread so the floating reading menu can toggle it. */
const [twoPageMode, setTwoPageModeSignal] = createSignal(readTwoPageMode());

export function setTwoPageMode(twoPages: boolean): void {
  setTwoPageModeSignal(twoPages);
  try {
    localStorage.setItem(TWO_PAGE_KEY, twoPages ? '1' : '0');
  } catch {
    // ignore
  }
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
    showBookModeButton: () => userDocRoute() && userDocumentTextAvailable(),
    pdfActive: userDocumentPdfActive,
    twoPageMode,
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
