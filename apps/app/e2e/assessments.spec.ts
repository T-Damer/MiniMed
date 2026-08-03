import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('completes a psychology questionnaire and writes the result to a patient note', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await expect(page.locator('.assessment-launch-button')).toHaveCount(0);
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Тесты', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/assessments$/u);
  await expect(page.getByRole('heading', { name: 'Тесты и опросники' })).toBeVisible();
  await expect(page.getByText('Психология и психодиагностика').first()).toBeVisible();

  await page.getByTestId('assessment-open-braverman-behavioral-profile').click();
  await expect(
    page.getByRole('heading', { name: 'Тест Бравермана — поведенческий профиль' }),
  ).toBeVisible();
  await page.getByPlaceholder('Имя, номер карты или псевдоним').fill('Тестовый пациент');

  const middleAnswers = page.locator('.assessment-question input[value="3"]');
  await expect(middleAnswers).toHaveCount(24);
  for (const answer of await middleAnswers.all()) {
    await answer.check();
  }

  await expect(page.getByText('Заполнено 24 из 24')).toBeVisible();
  await expect(page.getByTestId('assessment-submit')).toBeEnabled();
  await page.getByTestId('assessment-submit').click();

  await expect(page.getByText('Результат сохранён локально')).toBeVisible();
  await expect(page.locator('.assessment-score-list')).toBeVisible();
  await page.getByTestId('assessment-save-note').click();
  await page.getByRole('button', { name: 'Записать результат' }).click();

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();

  const card = page.locator('.patient-card').filter({ hasText: 'Тестовый пациент' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.patient-note-record')).toContainText('Тест Бравермана');

  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText('Тест Бравермана');
});
