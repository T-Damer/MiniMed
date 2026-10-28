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
 * An iPad (including iPadOS in its desktop-class mode, which reports itself as a Mac). Its Safari
 * keeps the share button in the top toolbar, not at the bottom of the screen as on an iPhone.
 */
export function isIpad(facts: BrowserFacts): boolean {
  if (/iPad/u.test(facts.userAgent)) return true;
  return facts.platform === 'MacIntel' && (facts.maxTouchPoints ?? 0) > 1;
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

/** Which miniature the install guide draws: decided from the browser alone. */
export type InstallGuideKind = 'messenger' | 'android' | 'iphone' | 'ipad' | 'desktop';

export function installGuideKind(input: {
  readonly messenger: boolean;
  readonly platform: DiaryPlatform;
  readonly ipad: boolean;
}): InstallGuideKind {
  if (input.messenger) return 'messenger';
  if (input.platform === 'ios') return input.ipad ? 'ipad' : 'iphone';
  if (input.platform === 'android') return 'android';
  return 'desktop';
}

/**
 * The «add to home screen» warning stays until the diary runs from the icon. Inside a messenger
 * it is always shown (the browser there cannot install anything); on a desktop without an install
 * prompt there is nothing to ask for.
 */
export function installWarningVisible(input: {
  readonly messenger: boolean;
  readonly advice: InstallAdvice;
}): boolean {
  if (input.messenger) return true;
  return input.advice !== 'installed' && input.advice !== 'none';
}

/** One short line per step; the guide animates the same steps in the same order. */
export const INSTALL_GUIDE_STEPS: Readonly<Record<InstallGuideKind, readonly string[]>> = {
  messenger: [
    'Нажмите «⋯» или «⋮» вверху',
    'Выберите «Открыть в браузере»',
    'Дневник откроется в браузере',
  ],
  android: [
    'Нажмите «⋮» в Chrome',
    'Выберите «Добавить на гл. экран»',
    'Нажмите «Установить»',
    'Значок появится на экране',
  ],
  iphone: [
    'Нажмите «⋯» внизу Safari',
    'Выберите «Поделиться»',
    'Пролистайте до «На экран «Домой»»',
    'Нажмите «Добавить»',
    'Значок появится на экране',
  ],
  ipad: [
    'Нажмите «Поделиться» вверху',
    'Выберите «На экран «Домой»»',
    'Нажмите «Добавить»',
    'Значок появится на экране',
  ],
  desktop: [
    'Нажмите значок установки в адресной строке',
    'Нажмите «Установить»',
    'Дневник откроется как приложение',
  ],
};

/** Heading of the warning row and of the guide. */
export function installWarningTitle(messenger: boolean): string {
  return messenger ? 'Откройте дневник в браузере' : 'Добавьте дневник на экран «Домой»';
}

/**
 * On iOS the home-screen icon keeps its own storage, so entries already made in Safari stay in
 * Safari. Said once, only when there is something to lose.
 */
export function installGuideNote(kind: InstallGuideKind, entries: number): string | null {
  if (entries <= 0) return null;
  if (kind !== 'iphone' && kind !== 'ipad') return null;
  const device = kind === 'ipad' ? 'iPad' : 'iPhone';
  return `На ${device} значок хранит записи отдельно от Safari. Прежние перенесите: «Отправить врачу», затем в дневнике со значка «Ещё» → «Восстановить записи».`;
}
