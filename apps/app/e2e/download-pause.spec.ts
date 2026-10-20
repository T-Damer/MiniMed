import { expect, test } from '@playwright/test';
import { INSTRUCTION_MODULE_ID, routeInstructionModule } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// DL2: the module download queue can be paused and resumed. Pause holds the transfer (no request
// goes out while paused), survives a reload, and «Продолжить» finishes the install. The module
// bytes are a local release copy (docs/data-ledger.json); skipped when it is absent.
const INTERACTIONS = `${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?d=албендазол&d=празиквантел`;
const DOWNLOADS = `${E2E_ASSET_ORIGIN}/#/settings/downloads`;

test('pause holds a module download, survives a reload, and resume completes it', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeInstructionModule(page);
  // Hold the module's bytes so the transfer stays in flight; count every request for them.
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let moduleRequests = 0;
  await page.route(
    (url) => url.pathname.includes('instructions.antiparasitic') && url.pathname.endsWith('.zst'),
    async (route) => {
      moduleRequests += 1;
      await gate;
      await route.fallback().catch(() => undefined); // the request may have been aborted by then
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
  const offer = page.locator(`.module-offer[data-module-id="${INSTRUCTION_MODULE_ID}"]`);
  await expect(offer.locator('.module-offer__button')).toHaveText(/^Скачать · /u, {
    timeout: 60_000,
  });
  await offer.locator('.module-offer__button').click();
  await expect.poll(() => moduleRequests, { timeout: 60_000 }).toBe(1);

  // Settings → Загрузки: pause.
  await page.goto(DOWNLOADS);
  const downloads = page.getByTestId('downloads-page');
  const toggle = downloads.getByTestId('downloads-pause-toggle');
  await expect(toggle).toHaveAccessibleName('Приостановить загрузки');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Продолжить загрузки');
  await expect(downloads.locator('.download-task[data-download-state="paused"]')).toHaveCount(1);
  await expect(downloads.locator('.downloads-overview__title')).toHaveText('Загрузки на паузе');
  // Regression (owner 2026-10-19, again 10-20): no pause/play control floats above «Настройки».
  await expect(page.getByTestId('content-download-nav-toggle')).toHaveCount(0);
  await expect(page.locator('.app-bottom-nav button:not(.app-nav-button)')).toHaveCount(0);

  // A reload keeps it paused and sends no request for the module's bytes.
  await page.reload();
  await expect(downloads).toBeVisible({ timeout: 60_000 });
  const reloadedToggle = page.getByTestId('downloads-pause-toggle');
  await expect(reloadedToggle).toHaveAccessibleName('Продолжить загрузки', { timeout: 60_000 });
  await expect(
    page.getByTestId('downloads-page').locator('.download-task[data-download-state="paused"]'),
  ).toHaveCount(1, { timeout: 60_000 });
  await page.waitForTimeout(1_500);
  expect(moduleRequests).toBe(1);

  // The offer on the module's own screen says so as well.
  await page.goto(INTERACTIONS);
  await expect(page.getByTestId('interaction-item')).toHaveCount(2, { timeout: 150_000 });
  const heldOffer = page.locator(`.module-offer[data-module-id="${INSTRUCTION_MODULE_ID}"]`);
  await expect(heldOffer).toHaveAttribute('data-download-phase', 'paused', { timeout: 30_000 });
  await expect(heldOffer.locator('.module-offer__button')).toHaveText('На паузе');
  expect(moduleRequests).toBe(1);

  // «Скачать сейчас» runs this one download even though the queue is paused.
  await heldOffer.getByTestId('module-offer-now').click();
  await expect.poll(() => moduleRequests, { timeout: 30_000 }).toBe(2);
  release();
  await expect(page.locator('.drug-interactions__quote').first()).toBeVisible({
    timeout: 180_000,
  });
  await expect(
    page.locator(`.module-offer[data-module-id="${INSTRUCTION_MODULE_ID}"]`),
  ).toHaveCount(0);
  // Nothing is held any more: the switch is gone with the last unfinished download.
  await page.goto(DOWNLOADS);
  await expect(page.getByTestId('downloads-page')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('downloads-pause-toggle')).toHaveCount(0);
});
