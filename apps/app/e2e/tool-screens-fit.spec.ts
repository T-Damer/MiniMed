import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// VIS2: tool screens fit a 375 px phone. The comparison picker once made its whole header 398 px
// wide (a long combination name had no break), cutting the «?» and the field edge.
test('the comparison picker and its suggestions fit the viewport', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchEditable(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-comparison`);
  const field = page.getByLabel('Добавить препарат');
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill('амоксициллин');
  await expect(page.getByRole('list', { name: 'Найденные препараты' })).toBeVisible({
    timeout: 90_000,
  });

  const right = await page.evaluate(() => {
    const edge = (selector: string): number =>
      document.querySelector(selector)?.getBoundingClientRect().right ?? 0;
    return {
      viewport: window.innerWidth,
      page: edge('.drug-comparison .page'),
      help: edge('.drug-comparison .page__help-button'),
      picker: edge('.drug-comparison__picker'),
      list: edge('.drug-comparison__candidates'),
    };
  });
  expect(right.page).toBeLessThanOrEqual(right.viewport);
  expect(right.help).toBeLessThanOrEqual(right.viewport);
  expect(right.picker).toBeLessThanOrEqual(right.viewport);
  expect(right.list).toBeLessThanOrEqual(right.viewport);
});
