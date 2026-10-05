import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  routeInstructionModule,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// ADR-0023: a product without a text of its own shows another registration's text of the same МНН
// under an unmissable label. Installs the smallest ЕСКЛП group and its ГРЛС instruction module from
// their published bytes (local release copies, see docs/data-ledger.json); skipped when absent.
const SHOTS = process.env['MED3_SHOTS'];

/** Light and dark screenshots of the label block and of the screen around it (opt-in: MED3_SHOTS). */
async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const block = page.locator('.document-instruction-fallback');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await block.scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      document
        .querySelector('.document-instruction-fallback')
        ?.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png` });
    await block.screenshot({ path: `${SHOTS}/${name}-${colorScheme}-block.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function openCatalogProduct(page: Page, name: string): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.getByRole('searchbox', { name: 'Поиск по препаратам' }).fill(name);
  await page.locator('.medication-product-card').first().click({ timeout: 60_000 });
  await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 30_000 });
}

test('a product without its own text shows another registration’s text with a label', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeMedicationModule(page);
  await routeInstructionModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationModule(page);

  // Level 1: Албендазол-Эдвансд has no text of its own; same МНН, form and strength exist.
  await openCatalogProduct(page, 'Албендазол-Эдвансд');
  const offer = page.locator('.document-medication-product__offer-button');
  await expect(offer).toContainText('Скачать инструкции группы', { timeout: 60_000 });
  await offer.click({ force: true });

  const fallback = page.locator('.document-instruction-fallback');
  await expect(fallback).toBeVisible({ timeout: 180_000 });
  await expect(fallback.locator('.document-instruction-fallback__label')).toHaveText(
    'Инструкция другого производителя: то же вещество, форма и дозировка',
  );
  await expect(fallback.locator('.document-instruction-fallback__warnings')).toHaveCount(0);
  await expect(fallback).toContainText('Препарат-источник');
  await expect(fallback).toContainText('Регистрация');
  await expect(fallback).toContainText('Это не инструкция выбранного препарата');
  // The donor's own provenance stays below the label.
  await expect(page.locator('.document-instruction-source')).toBeVisible();
  // The product's own source line never claims a ГРЛС text for it.
  await expect(page.locator('.document-medication-product__source')).not.toContainText('ГРЛС');
  await shoot(page, 'level1');

  // The «Кратко» side stays the product's own card; the tab note names the fallback.
  await expect(page.locator('.document-medication-product__reading-note')).toContainText(
    'инструкция другого производителя',
  );

  // Level 2: a different strength (or form wording) keeps the label and warns about it.
  await openCatalogProduct(page, 'Гельминтокс');
  await page.getByRole('radio', { name: 'Инструкция' }).check({ force: true });
  const warned = page.locator('.document-instruction-fallback');
  await expect(warned).toBeVisible({ timeout: 60_000 });
  await expect(warned.locator('.document-instruction-fallback__label')).toHaveText(
    'Инструкция другого производителя: то же вещество, форма и дозировка',
  );
  await expect(warned.locator('.document-instruction-fallback__warnings')).toContainText(
    'проверьте дозы',
  );
  await shoot(page, 'level2');

  // A product with an own text shows no fallback.
  await openCatalogProduct(page, 'Вермокс');
  await page.getByRole('radio', { name: 'Инструкция' }).check({ force: true });
  await expect(page.locator('.document-instruction-source')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.document-instruction-fallback')).toHaveCount(0);
});
