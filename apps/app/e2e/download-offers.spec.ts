import { expect, test } from '@playwright/test';
import { INSTRUCTION_MODULE_ID, routeInstructionModule } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// DL1: the download offer of a missing instruction module is one compact button per module whose
// state comes from the shared download state. A download that started is still shown, with its
// state, after the screen is left and opened again — at once, not after the catalog is read.
// The module bytes are a local release copy (docs/data-ledger.json); skipped when it is absent.
const INTERACTIONS = `${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?d=албендазол&d=празиквантел`;

test('one compact offer per missing module that keeps showing its download after navigation', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeInstructionModule(page);
  // Hold the module's bytes so the download stays in flight while the screen is left and reopened.
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname.includes('instructions.antiparasitic') && url.pathname.endsWith('.zst'),
    async (route) => {
      await gate;
      await route.fallback();
    },
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await page.goto(INTERACTIONS);
  await expect(page.getByTestId('interaction-item')).toHaveCount(2, { timeout: 150_000 });

  // One offer for the module, however many places could ask for it.
  const offer = page.locator(`.module-offer[data-module-id="${INSTRUCTION_MODULE_ID}"]`);
  await expect(offer).toHaveCount(1, { timeout: 60_000 });
  const button = offer.locator('.module-offer__button');
  // «Скачать · 37 МБ»: short, on one line; the group it covers is a small line under it.
  await expect(button).toHaveText(/^Скачать · \d+([.,]\d)? (КБ|МБ|ГБ)$/u, { timeout: 60_000 });
  await expect(offer.locator('.module-offer__subtitle')).toContainText('Инструкции группы');
  const box = await button.boundingBox();
  expect(box?.height ?? 999).toBeLessThan(60);
  expect(box?.width ?? 999).toBeLessThan(375);

  await button.click();
  await expect(button).toBeDisabled();
  await expect(offer).not.toHaveAttribute('data-download-phase', 'idle');
  await expect(button).not.toContainText('Скачать ·');

  // Leave the screen and open it again: the offer reflects the download that is under way.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await page.goto(INTERACTIONS);
  await expect(page.getByTestId('interaction-item')).toHaveCount(2, { timeout: 60_000 });
  const reopened = page.locator(`.module-offer[data-module-id="${INSTRUCTION_MODULE_ID}"]`);
  await expect(reopened).toHaveCount(1, { timeout: 30_000 });
  await expect(reopened.locator('.module-offer__button')).toBeDisabled({ timeout: 10_000 });
  await expect(reopened).not.toHaveAttribute('data-download-phase', 'idle');
  await expect(reopened.locator('.module-offer__button')).not.toContainText('Скачать ·');

  // Even a reload does not drop it: the interrupted download is picked up again and shown as such.
  await page.reload();
  await expect(page.getByTestId('interaction-item')).toHaveCount(2, { timeout: 150_000 });
  const afterReload = page.locator(`.module-offer[data-module-id="${INSTRUCTION_MODULE_ID}"]`);
  await expect(afterReload.locator('.module-offer__button')).toBeDisabled({ timeout: 30_000 });
  await expect(afterReload.locator('.module-offer__button')).not.toContainText('Скачать ·');

  release();
  await expect(page.locator('.drug-interactions__quote').first()).toBeVisible({
    timeout: 180_000,
  });
  // Installed: the instruction offer is gone (the optional severity labels have their own offer).
  await expect(
    page.locator(`.module-offer[data-module-id="${INSTRUCTION_MODULE_ID}"]`),
  ).toHaveCount(0);
});
