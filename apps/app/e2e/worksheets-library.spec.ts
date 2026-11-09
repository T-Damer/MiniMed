import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// CBT1: the doctor's library of CBT diaries and homework. From the diaries app's «Библиотека» the
// doctor opens a built-in sheet, reads its explanations, switches to the extended version, saves
// their own version into the library and edits it; the copy is listed under «Мои версии».

test.use({ viewport: { width: 390, height: 844 } });

/** Evidence for a review: `E2E_SHOTS=<dir>` saves the pages as PNG. */
async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_SHOTS'];
  if (directory) await page.waitForTimeout(700);
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

test('a built-in CBT sheet is read, copied into the library and edited', async ({ page }) => {
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/assessments/mine`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('assessment-worksheets-entry').click();
  await expect(page).toHaveURL(/#\/notes\/worksheets$/u);
  await expect(page.getByRole('heading', { name: 'Дневники и задания' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Экспозиция' })).toBeVisible();
  await shot(page, 'worksheets-catalog');

  await page
    .getByRole('button', { name: /Запись мыслей/u })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/notes\/worksheets\/cbt-thought-record$/u);
  await expect(page.getByText(/Черновик текстов/u)).toBeVisible();
  const patient = page.getByRole('article', { name: 'Как увидит пациент' });
  await expect(patient.getByText('Автоматическая мысль', { exact: true })).toBeVisible();
  await expect(patient.getByText('Доводы против', { exact: true })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Расширенная версия' }).click();
  await expect(patient.getByText('Доводы против', { exact: true })).toBeVisible();
  await shot(page, 'worksheet-page');

  // «Своя версия» may be folded into «⋯» on a phone.
  const copy = page.getByRole('button', { name: 'Своя версия' });
  if (await copy.isVisible()) await copy.click();
  else {
    await page.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('menuitem', { name: 'Своя версия' }).click();
  }
  await expect(page).toHaveURL(/#\/notes\/worksheets\/[^/]+\/edit$/u);
  const title = page.getByLabel('Название', { exact: true });
  await title.fill('Запись мыслей для пациента');
  await expect(page.getByTestId('worksheet-save-state')).toHaveText('Все изменения сохранены');
  await shot(page, 'worksheet-editor');

  await page.getByRole('button', { name: 'Назад' }).first().click();
  await page.getByRole('button', { name: 'Назад' }).first().click();
  await expect(page).toHaveURL(/#\/notes\/worksheets$/u);
  await expect(
    page.getByRole('region', { name: 'Мои версии' }).getByText('Запись мыслей для пациента'),
  ).toBeVisible();
});
