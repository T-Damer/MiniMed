import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const enabled = process.env.LOCAL_MODEL_SMOKE === '1';
const modelId = process.env.LOCAL_MODEL_ID;
const modelName = process.env.LOCAL_MODEL_NAME;

test.skip(!enabled, 'Large local-model smoke tests run only in the scheduled/manual workflow.');
test.setTimeout(15 * 60 * 1000);

test('downloads, loads and benchmarks the selected compact CPU model', async ({ page }) => {
  if (!modelId || !modelName) throw new Error('LOCAL_MODEL_ID and LOCAL_MODEL_NAME are required.');

  await mountBuiltApp(page, {
    origin: process.env.LOCAL_MODEL_SMOKE_ORIGIN,
    localStorage: {
      'minimed.local-model-preference.v1': JSON.stringify({
        automatic: false,
        selectedModelId: modelId,
        acceptedLicenseIds: [],
        autoLoad: true,
      }),
    },
  });

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /^Настройки/u })
    .click();
  await page.getByRole('button', { name: 'Проверить устройство' }).click();

  const readyState = page
    .locator('.model-current-state')
    .filter({ hasText: 'Используется' })
    .filter({ hasText: modelName });
  const errorButton = page.locator('.model-error-button');
  const outcome = await Promise.race([
    readyState.waitFor({ timeout: 14 * 60 * 1000 }).then(() => 'ready' as const),
    errorButton.waitFor({ timeout: 14 * 60 * 1000 }).then(() => 'error' as const),
  ]);
  if (outcome === 'error') {
    const details = page.locator('.model-error-details');
    if (!(await details.isVisible())) await errorButton.click();
    throw new Error(await details.innerText());
  }
  await expect(readyState).toContainText('Используется');
});
