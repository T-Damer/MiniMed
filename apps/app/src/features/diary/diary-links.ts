import { Capacitor } from '@capacitor/core';

/** Public page the patient opens. The native shell's own origin is not reachable by patients. */
const PUBLIC_DIARY_PAGE = 'https://t-damer.github.io/MiniMed/app/diary/';

export function diaryPageUrl(): string {
  const configured = import.meta.env.VITE_DIARY_PAGE_URL;
  if (configured) return configured;
  if (Capacitor.isNativePlatform()) return PUBLIC_DIARY_PAGE;
  return new URL('diary/', document.baseURI).toString();
}

/**
 * Origin of the connected diary service (ADR-0026). Empty: the page's own origin, as when the
 * service serves the app; a native build or a separate host sets `VITE_DIARY_SERVER`.
 */
export function diaryServiceBase(): string {
  return import.meta.env.VITE_DIARY_SERVER ?? '';
}

/**
 * The patient page of the connected diary. `VITE_DIARY_CONNECTED_PAGE_URL` when the page lives apart
 * from the service (ADR-0027: page on GitHub Pages, API on its own domain); else the service's origin.
 */
export function connectedDiaryPageUrl(): string {
  const configured = import.meta.env.VITE_DIARY_CONNECTED_PAGE_URL;
  if (configured) return configured;
  const base = diaryServiceBase();
  return base
    ? new URL('diary/', `${base.replace(/\/$/u, '')}/`).toString()
    : new URL('diary/', document.baseURI).toString();
}
