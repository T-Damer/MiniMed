import { Capacitor } from '@capacitor/core';

/**
 * Public page the patient opens. The native shell's own origin is not reachable by patients. The
 * service's short link redirects to wherever the pages are published (GitVerse Pages for now, as it
 * opens reliably in Russia; the `#…` fragment survives the redirect), so a link outlives a move.
 */
const PUBLIC_DIARY_PAGE = 'https://med.1damer.com/diary/';

/** Static hosts the app is published on, which have no diary service of their own. */
const PUBLISHED_HOSTS = ['.github.io', '.gitverse.site'];

/** Whether the page is served by a static host (GitHub Pages, GitVerse Pages). */
export function isPublishedHost(hostname: string): boolean {
  return PUBLISHED_HOSTS.some((suffix) => hostname.endsWith(suffix));
}

export function diaryPageUrl(): string {
  const configured = import.meta.env.VITE_DIARY_PAGE_URL;
  if (configured) return configured;
  if (Capacitor.isNativePlatform()) return PUBLIC_DIARY_PAGE;
  return new URL('diary/', document.baseURI).toString();
}

/** The pilot's service (ADR-0027: Yandex Cloud behind an API Gateway). */
const PUBLIC_DIARY_SERVER = 'https://med.1damer.com';

/**
 * Origin of the connected diary service (ADR-0026). `VITE_DIARY_SERVER` when set (a self-hosted
 * service, an empty value for the page's own origin); else the pilot's service for the published
 * pages and the native shells, which have no service of their own; else the page's own origin, as
 * when the service serves the app.
 */
export function diaryServiceBase(): string {
  const configured = import.meta.env.VITE_DIARY_SERVER;
  if (configured !== undefined) return configured;
  if (Capacitor.isNativePlatform() || isPublishedHost(window.location.hostname)) {
    return PUBLIC_DIARY_SERVER;
  }
  return '';
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
