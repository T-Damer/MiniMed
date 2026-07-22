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
    localStorage: {
      'minimed.local-model-preference.v1': JSON.stringify({
        automatic: false,
        selectedModelId: modelId,
        acceptedLicenseIds: [],
        autoLoad: true,
      }),
    },
  });

  const toast = page.getByTestId('local-model-toast');
  await expect(toast).toContainText('Локальный ИИ готов', { timeout: 12 * 60 * 1000 });
  await expect(toast).toContainText(modelName);
});
