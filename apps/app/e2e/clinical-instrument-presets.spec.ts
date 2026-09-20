import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('imports a Russian form locally, preserves answers through help and prints attribution', async ({
  page,
  context,
}) => {
  // Inspect the real print document without opening an OS print dialog in headless Chromium.
  await context.addInitScript(() => { window.print = () => {}; });
  await mountBuiltApp(page, { persistentOrigin: true });
  await page.evaluate(() => { window.location.hash = '#/assessments/mine'; });
  await expect(page.getByRole('heading', { name: 'Мои опросники', exact: true })).toBeVisible();
  const remoteSourceRequests: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host === 'psyjournals.ru' || host.endsWith('who.int') || host.endsWith('phenxtoolkit.org')) {
      remoteSourceRequests.push(host);
    }
  });

  await page.getByRole('button', { name: 'Добавить шкалу из источника', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Найти шкалу в источниках' }).fill('PHQ9');
  const choice = page.locator('[data-preset-id="phq-9-ru-zolotareva-2023"]');
  await expect(choice).toBeVisible();
  await choice.getByRole('button', { name: /^Описание и источник:/u }).click();
  await expect(page.getByRole('dialog')).toContainText('10.17759/cpse.2023120406');
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Оригинальная публикация и версия' }))
    .toHaveAttribute('href', 'https://psyjournals.ru/journals/cpse/archive/2023_n4/Zolotareva');
  await page.getByRole('dialog').getByRole('button', { name: 'Добавить локальную копию' }).click();
  await expect(page).toHaveURL(/#\/assessments\/mine\/[^/]+\/edit$/u);
  await page.getByRole('button', { name: 'Пройти', exact: true }).click();
  await expect(page.locator('.assessment-question')).toHaveCount(9);
  await expect(page.locator('.assessment-page-header .page__description')).toHaveCount(0);
  await expect(page.locator('.assessment-methodology-trigger')).toHaveCount(0);

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Распечатать бланк теста', exact: true }).click();
  const printed = await popupPromise;
  await expect(printed.locator('body')).toContainText('Источник формы:');
  await expect(printed.locator('body')).toContainText('10.17759/cpse.2023120406');
  await expect(printed.locator('body')).toContainText('двух недель');
  await printed.close();

  for (let index = 0; index < 9; index += 1) {
    await page.locator('.assessment-question').nth(index)
      .locator('.assessment-response-options__option').nth(1).click();
  }
  await expect(page.locator('.assessment-question input:checked')).toHaveCount(9);
  await page.getByRole('button', { name: 'Методика и ограничения', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('0–27');
  await expect(page.getByRole('dialog')).toContainText('CC-BY-NC-4.0');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.assessment-question input:checked')).toHaveCount(9);
  await expect(page.getByTestId('assessment-submit')).toBeEnabled();
  await page.getByTestId('assessment-submit').click();
  await expect(page.locator('.assessment-score-list')).toBeVisible();
  expect(remoteSourceRequests).toEqual([]);
});
