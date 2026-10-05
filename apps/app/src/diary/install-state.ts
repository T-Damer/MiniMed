import { createSignal } from 'solid-js';

import {
  type BrowserFacts,
  type DiaryPlatform,
  detectPlatform,
  type InstallAdvice,
  installAdvice,
  isInAppBrowser,
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

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { readonly standalone?: boolean }).standalone;
  return iosStandalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

const [promptEvent, setPromptEvent] = createSignal<InstallPromptEvent | null>(null);
const [installed, setInstalled] = createSignal(false);

/**
 * Must run before the page renders: Chrome fires `beforeinstallprompt` once, early, and the event
 * is lost if nothing is listening yet.
 */
export function listenForInstallPrompt(): void {
  setInstalled(isStandalone());
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

/** Shows the browser's own install dialog. Returns whether the patient accepted it. */
export async function requestInstall(): Promise<boolean> {
  const event = promptEvent();
  if (!event) return false;
  setPromptEvent(null);
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') setInstalled(true);
  return choice.outcome === 'accepted';
}
