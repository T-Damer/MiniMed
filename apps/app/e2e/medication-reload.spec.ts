import { expect, test } from '@playwright/test';
import {
  installMedicationModule,
  openFirstMedicationCard,
  routeMedicationModule,
} from './medication-module-fixture';
import { mountBuiltApp } from './mount-built-app';

// Since 0.6.47 the core holds only pointers, so the medication catalog lists products once a
// medication module is installed; the fixture installs the smallest one from its published bytes.
test('a medication card keeps its catalog product after a page reload', async ({ page }) => {
  test.setTimeout(180_000);
  await routeMedicationModule(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationModule(page);
  const heading = await openFirstMedicationCard(page);
  const openedUrl = page.url();

  await page.reload();

  expect(page.url()).toBe(openedUrl);
  await expect(page.locator('.drug-header__title')).toHaveText(heading, { timeout: 30_000 });
});
