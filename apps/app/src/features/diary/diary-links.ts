import { Capacitor } from '@capacitor/core';

/** Public page the patient opens. The native shell's own origin is not reachable by patients. */
const PUBLIC_DIARY_PAGE = 'https://t-damer.github.io/MiniMed/app/diary/';

export function diaryPageUrl(): string {
  const configured = import.meta.env.VITE_DIARY_PAGE_URL;
  if (configured) return configured;
  if (Capacitor.isNativePlatform()) return PUBLIC_DIARY_PAGE;
  return new URL('diary/', document.baseURI).toString();
}
