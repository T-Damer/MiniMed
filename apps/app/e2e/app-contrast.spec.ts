import { expect, type Page, test } from '@playwright/test';

import { checkContrast } from './contrast';
import {
  E2E_ASSET_ORIGIN,
  mountBuiltApp,
  waitForSearchEditable,
  waitForSearchReady,
} from './mount-built-app';

// Owner rule (2026-11-08): element contrast is checked in both themes; an element with poor
// contrast has to change. The main screens at phone and desktop width, light and dark: text 4.5:1
// (3:1 large) and the glyph of every icon-only button 3:1 against its background. Findings are
// soft, so one run lists every failing screen. Diary screens: diary-screens.spec.ts.

const CIWA = 'minimed.calculator.ciwa-ar';
const MEDICATION_POINTER =
  'core.catalog.pointer.medication.esklp.mnn.аскорбиновая-кислота-парацетамол-bfbe39d48f8ac5dc';

/**
 * Left out everywhere, with the reason. The active bottom-navigation glyph stands on the nav's
 * separate cream bubble (a gradient element beside the button, not behind it in the DOM), which
 * the compositing cannot see; its pairs are fixed in bottom-nav.css / theme-dark.css (accent on
 * #fbf7ea, #1b2a21 on #d4cbb4: both above 7:1).
 */
const ALLOWLIST = '.app-bottom-nav .app-nav-button--active';

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
  await page.waitForTimeout(900);
}

const audit = (page: Page, name: string, scope?: string) =>
  checkContrast(page, name, scope, { icons: true, opacity: true, skip: ALLOWLIST || undefined });

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`main app screens at ${viewport.width}px, ${scheme}: contrast`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      await waitForSearchEditable(page);

      await go(page, '#/search');
      await audit(page, 'home-search');

      await go(page, '#/calculators');
      await audit(page, 'calculators-list');

      await go(page, `#/calculators/${CIWA}`);
      await expect(page.getByRole('button', { name: 'Информация' }).first()).toBeVisible();
      await audit(page, 'calculator-ciwa-ar');
      await page.getByRole('button', { name: 'Информация' }).first().click();
      const sources = page.getByText('Источники', { exact: true }).first();
      await expect(sources).toBeVisible();
      await sources.click();
      await page.waitForTimeout(500);
      await audit(page, 'calculator-ciwa-ar-help', '[role="dialog"]');
      await page.keyboard.press('Escape');

      await go(page, '#/assessments');
      await audit(page, 'assessments-catalog');
      await go(page, '#/assessments/psychology');
      await audit(page, 'assessments-specialty');
      await go(page, '#/assessments/psychology/braverman-behavioral-profile');
      await audit(page, 'questionnaire');

      await go(page, '#/settings');
      await audit(page, 'settings');

      await go(page, '#/notes');
      await audit(page, 'patients-notes');

      await go(page, '#/notes/drug-comparison');
      await audit(page, 'drug-comparison');

      await waitForSearchReady(page);
      const token = Buffer.from(MEDICATION_POINTER).toString('base64url');
      await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/d/${token}`);
      await page.locator('.document-text-chunk').first().waitFor();
      await audit(page, 'reader-document');
    });
  }
}
