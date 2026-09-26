import { createEffect, createSignal, onCleanup } from 'solid-js';

import {
  getBookReadingMode,
  setBookReadingMode,
  subscribeAppPreferences,
} from '@/state/app-preferences';

/** Set by the active user-document reader: whether the opened file is a PDF. */
const [userDocumentPdfActive, setUserDocumentPdfActive] = createSignal(false);

export function markUserDocumentPdf(active: boolean): void {
  setUserDocumentPdfActive(active);
}

/** Set by the active user-document reader while a CT/MRI viewer owns the full page. */
export const [medicalImageViewerActive, markMedicalImageViewerActive] = createSignal(false);

const TWO_PAGE_KEY = 'minimed.userDocTwoPage';
const TEXT_SCALE_KEY = 'minimed.userDocTextScale';

export const DOCUMENT_TEXT_SCALE_LEVELS = [90, 100, 110, 125, 140] as const;
export const DEFAULT_DOCUMENT_TEXT_SCALE = 100;

export function normalizeDocumentTextScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DOCUMENT_TEXT_SCALE;
  return DOCUMENT_TEXT_SCALE_LEVELS.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest,
  );
}

export function stepDocumentTextScale(current: number, direction: -1 | 1): number {
  const normalized = normalizeDocumentTextScale(current);
  const index = DOCUMENT_TEXT_SCALE_LEVELS.indexOf(
    normalized as (typeof DOCUMENT_TEXT_SCALE_LEVELS)[number],
  );
  const nextIndex = Math.max(
    0,
    Math.min(DOCUMENT_TEXT_SCALE_LEVELS.length - 1, index + direction),
  );
  return DOCUMENT_TEXT_SCALE_LEVELS[nextIndex] ?? DEFAULT_DOCUMENT_TEXT_SCALE;
}

function readTwoPageMode(): boolean {
  try {
    return localStorage.getItem(TWO_PAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readTextScale(): number {
  try {
    const stored = localStorage.getItem(TEXT_SCALE_KEY);
    if (!stored) return DEFAULT_DOCUMENT_TEXT_SCALE;
    return normalizeDocumentTextScale(Number(stored));
  } catch {
    return DEFAULT_DOCUMENT_TEXT_SCALE;
  }
}

/** Shared two-page PDF spread so the floating reading menu can toggle it. */
const [twoPageMode, setTwoPageModeSignal] = createSignal(readTwoPageMode());
/** Shared persistent scale for text/Markdown readers; independent of PDF pinch zoom. */
const [textScalePercent, setTextScaleSignal] = createSignal(readTextScale());

export function setTwoPageMode(twoPages: boolean): void {
  setTwoPageModeSignal(twoPages);
  try {
    localStorage.setItem(TWO_PAGE_KEY, twoPages ? '1' : '0');
  } catch {
    // ignore
  }
}

export function setDocumentTextScale(percent: number): void {
  const normalized = normalizeDocumentTextScale(percent);
  setTextScaleSignal(normalized);
  try {
    localStorage.setItem(TEXT_SCALE_KEY, String(normalized));
  } catch {
    // Reading scale still works for the current session when storage is unavailable.
  }
}

export function useDocumentBookReadingMode() {
  const [bookMode, setBookMode] = createSignal(getBookReadingMode());

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

  const increaseTextScale = (): void => {
    setDocumentTextScale(stepDocumentTextScale(textScalePercent(), 1));
  };

  const decreaseTextScale = (): void => {
    setDocumentTextScale(stepDocumentTextScale(textScalePercent(), -1));
  };

  const resetTextScale = (): void => {
    setDocumentTextScale(DEFAULT_DOCUMENT_TEXT_SCALE);
  };

  return {
    bookMode,
    pdfActive: userDocumentPdfActive,
    twoPageMode,
    textScalePercent,
    toggleBookMode,
    increaseTextScale,
    decreaseTextScale,
    resetTextScale,
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
