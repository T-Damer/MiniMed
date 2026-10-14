import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  routeInstructionModule,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// DRUG-UI1 (owner 2026-10-14): opening a drug, the instruction text starts on the first screen.
// Installs the smallest ЕСКЛП group and its ГРЛС instruction module from their published bytes
// (local release copies, see docs/data-ledger.json); skipped when absent.
// Screenshots: DRUGUI_SHOTS=<directory>.
const SHOTS = process.env['DRUGUI_SHOTS'];

// The chosen theme of the screenshots (Settings → theme): DRUGUI_THEME=dark.
const THEME = process.env['DRUGUI_THEME'] ?? 'light';

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
] as const;

async function openInstruction(page: Page, name: string): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.getByRole('searchbox', { name: 'Поиск по препаратам' }).fill(name);
  await page.locator('.medication-product-card').first().click({ timeout: 60_000 });
  await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 30_000 });
  const offer = page.locator('.document-medication-product__offer-button');
  if (await offer.isVisible({ timeout: 60_000 }).catch(() => false)) {
    await offer.click({ force: true });
  }
  await expect(page.getByRole('radio', { name: 'Инструкция' })).toBeEnabled({ timeout: 180_000 });
  await page.getByRole('radio', { name: 'Инструкция' }).check({ force: true });
  await expect(page.locator('.document-instruction-source')).toBeVisible({ timeout: 60_000 });
}

/** Top of the first body paragraph and top of the bottom navigation, in viewport pixels. */
async function measure(page: Page): Promise<{ paragraph: number; bottom: number; height: number }> {
  return page.evaluate(() => {
    const paragraph = document.querySelector('.document-overlay-section__paragraph');
    const nav = document.querySelector('.app-nav-button')?.closest('nav');
    return {
      paragraph: paragraph?.getBoundingClientRect().top ?? Number.NaN,
      bottom: nav?.getBoundingClientRect().top ?? window.innerHeight,
      height: window.innerHeight,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`the instruction text starts on the first screen of a drug at ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await routeMedicationModule(page);
    await routeInstructionModule(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mountBuiltApp(page, {
      skipLargeCompanionPacks: true,
      localStorage: {
        'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
        'minimed.theme.v1': THEME,
      },
    });
    await installMedicationModule(page);
    await openInstruction(page, 'Вермокс');
    await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible();
    await page.waitForTimeout(800);

    if (SHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/drug-${viewport.name}-${THEME}.png` });
    }

    const { paragraph, bottom, height } = await measure(page);
    console.log(
      `DRUGUI ${viewport.name}: paragraph top ${paragraph}, nav top ${bottom}, viewport ${height}`,
    );
    // The first paragraph is visible above the bottom navigation without scrolling.
    expect(paragraph).toBeLessThan(bottom - 24);
    // The header is one compact block: title, tools and the chip rows end well above the text.
    const title = await page.locator('.drug-header__title').boundingBox();
    expect(title?.y ?? 999).toBeLessThan(160);
    // The page bubble stays out of the first screen until the reader has scrolled.
    await expect(page.locator('.reader-page-dock--hidden')).toHaveCount(1);
    await page.evaluate(() => window.scrollBy(0, 400));
    await expect(page.locator('.reader-page-dock--hidden')).toHaveCount(0);
  });
}
