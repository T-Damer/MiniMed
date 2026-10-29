import { describe, expect, it } from 'vitest';

import { type AppRuntimeFacts, appVariantLinks, currentAppVariant } from './app-variants';

const URLS = { apk: 'apk', webApp: 'web', diary: 'diary' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36';

function ids(facts: AppRuntimeFacts): string[] {
  return appVariantLinks(facts, URLS).map((link) => link.id);
}

describe('app variants', () => {
  it('hides the variant being run and always keeps GitHub', () => {
    expect(ids({ nativePlatform: 'android', userAgent: ANDROID })).toEqual([
      'ios',
      'web',
      'diary',
      'github',
    ]);
    expect(ids({ nativePlatform: 'ios', userAgent: IPHONE })).toEqual([
      'android',
      'web',
      'diary',
      'github',
    ]);
    expect(ids({ nativePlatform: 'web', userAgent: MAC, platform: 'MacIntel' })).toEqual([
      'android',
      'ios',
      'diary',
      'github',
    ]);
  });

  it('treats iOS Safari and the home-screen icon as the iPhone variant', () => {
    expect(currentAppVariant({ nativePlatform: 'web', userAgent: IPHONE })).toBe('ios');
    expect(
      currentAppVariant({
        nativePlatform: 'web',
        userAgent: MAC,
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe('ios');
  });

  it('treats an Android browser as the web app, which still offers the APK', () => {
    expect(currentAppVariant({ nativePlatform: 'web', userAgent: ANDROID })).toBe('web');
    expect(ids({ nativePlatform: 'web', userAgent: ANDROID })).toContain('android');
  });

  it('hides the diary inside the diary', () => {
    expect(ids({ nativePlatform: 'web', userAgent: MAC, insideDiary: true })).not.toContain(
      'diary',
    );
  });

  it('points each variant at its address', () => {
    const links = appVariantLinks({ nativePlatform: 'web', userAgent: MAC }, URLS);
    expect(links.find((link) => link.id === 'android')?.href).toBe('apk');
    expect(links.find((link) => link.id === 'ios')?.href).toBe('web');
    expect(links.find((link) => link.id === 'diary')?.href).toBe('diary');
  });
});
