/**
 * How the patient can keep the diary one tap away, decided from the browser alone.
 * Pure functions, so the decisions are testable without a phone.
 */
export type DiaryPlatform = 'ios' | 'android' | 'other';

export interface BrowserFacts {
  readonly userAgent: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
}

export function detectPlatform(facts: BrowserFacts): DiaryPlatform {
  if (/iPhone|iPad|iPod/u.test(facts.userAgent)) return 'ios';
  // iPadOS 13+ reports itself as a Mac but has a touch screen.
  if (facts.platform === 'MacIntel' && (facts.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/u.test(facts.userAgent)) return 'android';
  return 'other';
}

/**
 * A messenger's built-in browser. It cannot add a page to the home screen and keeps its own
 * storage that the real browser never sees, so entries made there are easy to lose.
 */
export function isInAppBrowser(facts: BrowserFacts): boolean {
  const { userAgent } = facts;
  if (
    /FBAN|FBAV|FB_IAB|Instagram|Telegram|WhatsApp|VKApp|Line\/|MicroMessenger|; wv\)/u.test(
      userAgent,
    )
  ) {
    return true;
  }
  // Safari and every iOS browser built on it say «Safari/»; a bare WKWebView does not.
  return detectPlatform(facts) === 'ios' && !/Safari\//u.test(userAgent);
}

export type InstallAdvice =
  /** Already running from the home screen. */
  | 'installed'
  /** The browser offered a native install prompt. */
  | 'prompt'
  /** iOS Safari: only the share sheet can add it. */
  | 'ios'
  /** Another mobile browser: describe the menu entry. */
  | 'manual'
  /** Desktop or nothing useful to say. */
  | 'none';

export function installAdvice(input: {
  readonly standalone: boolean;
  readonly canPrompt: boolean;
  readonly platform: DiaryPlatform;
}): InstallAdvice {
  if (input.standalone) return 'installed';
  if (input.canPrompt) return 'prompt';
  if (input.platform === 'ios') return 'ios';
  if (input.platform === 'android') return 'manual';
  return 'none';
}

const DISMISS_DAYS = 7;

/** The «add to home screen» card comes back a week after «Не сейчас». */
export function installCardDismissed(dismissedAt: string | undefined, now: number): boolean {
  if (!dismissedAt) return false;
  const time = Date.parse(dismissedAt);
  return Number.isFinite(time) && now - time < DISMISS_DAYS * 86_400_000;
}
