import { expect, test } from '@playwright/test';
import {
  CLINICAL_DOCUMENT_ROUTE,
  CLINICAL_POINTER_ID,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// DL1: a downloaded specialty can be removed from Settings → Загрузки: an icon button on its row,
// a confirmation that says what is freed, and the section is back to «not downloaded». The module
// bytes are a local release copy (docs/data-ledger.json); skipped when it is absent.
test('an installed section is removed from Settings → Загрузки after a confirmation', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeClinicalModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, waitForCore: true });
  await installClinicalModule(page);

  await page.goto(`${E2E_ASSET_ORIGIN}/#/settings/downloads`);
  const items = page.locator('.section-downloads__item');
  await expect(items.first()).toBeVisible({ timeout: 60_000 });
  const removeButtons = page.locator('[data-testid^="section-remove-"]');
  // Only the section that holds the installed recommendation offers a removal.
  await expect(removeButtons).toHaveCount(1, { timeout: 30_000 });
  const section = items.filter({ has: removeButtons });
  await expect(section.locator('.section-downloads__remove')).toHaveAccessibleName(
    /^Удалить «.+» с устройства$/u,
  );

  // Cancel keeps everything.
  await removeButtons.click();
  const dialog = page.getByRole('alertdialog', { name: 'Удалить раздел с устройства?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Освободится около \d/u);
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(removeButtons).toHaveCount(1);

  // Confirm: the recommendation is gone from the device and the section can be downloaded again.
  await removeButtons.click();
  await dialog.getByRole('button', { name: 'Удалить' }).click();
  await expect(removeButtons).toHaveCount(0, { timeout: 60_000 });

  const pointer = `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(CLINICAL_POINTER_ID).toString('base64url')}`;
  // The search core reconnects in the background; a reload proves what is stored on the device.
  await page.reload();
  await page.goto(pointer);
  await expect(page.locator('.document-module-pointer__action')).toBeVisible({ timeout: 60_000 });
  await page.goto(CLINICAL_DOCUMENT_ROUTE);
  await expect(page.locator('.document-module-pointer__action')).toBeVisible({ timeout: 60_000 });
});
