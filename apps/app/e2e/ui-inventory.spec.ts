import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';
import { routeLocalCatalogModules } from './perf-harness';

/**
 * PERF6 (owner 2026-11-11 «страницы и инструменты выглядят по-разному»): one phone screenshot of
 * every main screen and tool, light and dark, for the visual gap table. Not a gate; run on purpose
 * against a profile with the core installed (the one `perf-baseline` fills, or a copy):
 *
 *   UI_INVENTORY=1 UI_OUT=/tmp/shots E2E_PORT=4291 bunx playwright test ui-inventory --workers=1
 */
test.skip(!process.env['UI_INVENTORY'], 'screenshots for a visual review; run with UI_INVENTORY=1');

const ROOT = resolve(import.meta.dirname, '../../..');
const PROFILE_DIR = process.env['PERF_PROFILE_DIR'] ?? resolve(ROOT, 'playwright/perf-profile');
const OUT = process.env['UI_OUT'] ?? resolve(ROOT, 'playwright/ui-inventory');
const ONLY = (process.env['UI_SCREENS'] ?? '').split(',').filter(Boolean);
const b64 = (id: string): string => Buffer.from(id).toString('base64url');

export const INVENTORY_SCREENS = [
  ['01-search', '#/search'],
  ['02-search-results', '#/search?q=%D0%BF%D0%BD%D0%B5%D0%B2%D0%BC%D0%BE%D0%BD%D0%B8%D1%8F'],
  ['03-files', '#/modules/documents/user'],
  ['04-knowledge', '#/modules'],
  ['05-documents', '#/modules/documents'],
  ['06-reader', `#/modules/documents/d/${b64('kr.rf.714_2')}`],
  ['07-notes', '#/notes'],
  ['08-diaries', '#/notes/diaries'],
  ['09-calculators', '#/calculators'],
  ['10-bmi', '#/calculators/bmi'],
  ['11-ecg-photo', '#/calculators/ecg-photo-caliper'],
  ['12-assessments', '#/assessments'],
  ['13-assessment-psy', '#/assessments/psychiatry'],
  ['14-drug-interactions', '#/notes/drug-interactions'],
  ['15-drug-comparison', '#/notes/drug-comparison'],
  ['16-vaccination', '#/notes/vaccination'],
  ['17-skin-photo', '#/notes/skin-photo'],
  ['18-psy-status', '#/notes/psy-status'],
  ['19-forms', '#/notes/forms'],
  ['20-patients', '#/notes/patients'],
  ['21-news', '#/news'],
  ['22-settings', '#/settings'],
  ['23-settings-downloads', '#/settings/downloads'],
  ['24-settings-images', '#/settings/images'],
  ['25-files-images', '#/modules/documents/user?kind=images'],
  ['26-files-computer', '#/modules/documents/user?place=computer'],
] as const;

test('screenshots of every main screen', async () => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const schemes = (process.env['UI_SCHEMES'] ?? 'light,dark').split(',') as ('light' | 'dark')[];
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
    args: ['--mute-audio'],
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    window.localStorage.setItem('minimed:core-download-consent:v1', '1');
  });
  await routeLocalCatalogModules(context);
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 600_000, polling: 500 },
  );
  for (const scheme of schemes) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [name, hash] of INVENTORY_SCREENS) {
      if (ONLY.length > 0 && !ONLY.some((part) => name.includes(part))) continue;
      await page.evaluate((target) => {
        window.location.hash = target;
      }, hash);
      await page.waitForTimeout(Number(process.env['UI_WAIT_MS'] ?? '2500'));
      await page.screenshot({ path: resolve(OUT, `${name}-${scheme}.png`) });
    }
  }
  await context.close();
});
