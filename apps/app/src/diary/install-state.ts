import { createSignal } from 'solid-js';

import {
  type BrowserFacts,
  type DiaryPlatform,
  detectPlatform,
  type InstallAdvice,
  installAdvice,
  isInAppBrowser,
  isIpad,
} from '@/features/diary/diary-install';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

function browserFacts(): BrowserFacts {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

/** Running from the home-screen icon (iOS `navigator.standalone`, or an installed web app). */
export function isStandaloneApp(): boolean {
  const iosStandalone = (navigator as Navigator & { readonly standalone?: boolean }).standalone;
  // Full screen too: icons installed while the manifest asked for it keep that mode until the
  // browser refreshes the installed app.
  return (
    iosStandalone === true ||
    window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
  );
}

const [promptEvent, setPromptEvent] = createSignal<InstallPromptEvent | null>(null);
const [installed, setInstalled] = createSignal(false);

/**
 * Must run before the page renders: Chrome fires `beforeinstallprompt` once, early, and the event
 * is lost if nothing is listening yet.
 */
export function listenForInstallPrompt(): void {
  setInstalled(isStandaloneApp());
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    setPromptEvent(event as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    setPromptEvent(null);
    setInstalled(true);
  });
}

export function platform(): DiaryPlatform {
  return detectPlatform(browserFacts());
}

export function onIpad(): boolean {
  return isIpad(browserFacts());
}

export function insideMessenger(): boolean {
  return isInAppBrowser(browserFacts());
}

export function currentInstallAdvice(): InstallAdvice {
  return installAdvice({
    standalone: installed(),
    canPrompt: promptEvent() !== null,
    platform: platform(),
  });
}

/** What became of the browser's own install dialog. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/**
 * Shows the browser's own install dialog. «dismissed» is the person's answer (they closed the
 * dialog or chose «Отмена»): callers take it as «not now» and do not follow it with the guide.
 */
export async function requestInstall(): Promise<InstallOutcome> {
  const event = promptEvent();
  if (!event) return 'unavailable';
  setPromptEvent(null);
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') setInstalled(true);
  return choice.outcome;
}
