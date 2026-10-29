import { type BrowserFacts, detectPlatform } from '@/features/diary/diary-install';
import { ANDROID_APK_URL, GITHUB_REPOSITORY_URL, MINIMED_WEB_APP_URL } from '../../../../release';

/** The ways the app is delivered. `ios` and `web` are the same web app, installed or in a tab. */
export type AppVariantId = 'android' | 'ios' | 'web' | 'diary';

export interface AppVariant {
  readonly id: AppVariantId;
  readonly label: string;
  /** Opens in a new tab (an external site) instead of downloading / navigating in place. */
  readonly external: boolean;
}

/** Declared once; the link list is this data minus the variant the user is running. */
export const APP_VARIANTS: readonly AppVariant[] = [
  { id: 'android', label: 'Android', external: false },
  { id: 'ios', label: 'iPhone', external: true },
  { id: 'web', label: 'Компьютер', external: true },
  { id: 'diary', label: 'Дневник пациента', external: true },
];

export const GITHUB_LINK_LABEL = 'GitHub';

export interface AppRuntimeFacts extends BrowserFacts {
  /** `Capacitor.getPlatform()`: `android`, `ios` or `web`. */
  readonly nativePlatform: string;
  /** Inside the patient diary page itself. */
  readonly insideDiary?: boolean;
}

/**
 * Which variant is running now. iOS has no store build, so iOS Safari and the home-screen icon are
 * the iPhone variant; an Android browser is the web app, and offers the APK.
 */
export function currentAppVariant(facts: AppRuntimeFacts): AppVariantId {
  if (facts.insideDiary) return 'diary';
  if (facts.nativePlatform === 'android') return 'android';
  if (facts.nativePlatform === 'ios') return 'ios';
  return detectPlatform(facts) === 'ios' ? 'ios' : 'web';
}

export interface AppVariantUrls {
  readonly apk: string;
  readonly webApp: string;
  readonly diary: string;
}

export interface AppVariantLink {
  readonly id: AppVariantId | 'github';
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
}

export function appVariantLinks(facts: AppRuntimeFacts, urls: AppVariantUrls): AppVariantLink[] {
  const current = currentAppVariant(facts);
  const hrefs: Record<AppVariantId, string> = {
    android: urls.apk,
    ios: urls.webApp,
    web: urls.webApp,
    diary: urls.diary,
  };
  // An Android browser is the web app: it keeps the APK but not a link to itself.
  const links: AppVariantLink[] = APP_VARIANTS.filter((variant) => variant.id !== current).map(
    (variant) => ({ ...variant, href: hrefs[variant.id] }),
  );
  links.push({
    id: 'github',
    label: GITHUB_LINK_LABEL,
    href: GITHUB_REPOSITORY_URL,
    external: true,
  });
  return links;
}

export function defaultAppVariantUrls(diaryPage: string): AppVariantUrls {
  return { apk: ANDROID_APK_URL, webApp: MINIMED_WEB_APP_URL, diary: diaryPage };
}
