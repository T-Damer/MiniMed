import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

function navigationButton(page: Page, name: string) {
  return page.locator('.app-bottom-nav').getByRole('button', { name, exact: true });
}

test('keeps patient notes local, nested, and findable from search', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await navigationButton(page, 'Заметки').click();
  await expect(page.getByRole('heading', { name: 'Заметки' })).toBeVisible();
  await expect(page.getByText(/Пока нет карточек/u)).toBeVisible();

  await page.getByRole('button', { name: 'Новая карточка' }).click();
  await page.getByLabel('Название карточки').fill('Иванов И., 3 года, 20 кг');
  await page.getByLabel('Контекст пациента').fill('аллергия на пенициллин');
  await page.getByRole('button', { name: 'Создать' }).click();

  const card = page.locator('.patient-card').filter({ hasText: 'Иванов И.' });
  await expect(card).toBeVisible();
  await card.locator('summary').click();

  await card
    .getByLabel('Новая заметка для Иванов И., 3 года, 20 кг')
    .fill('Назначен цефтриаксон, вторая линия при пневмонии');
  await card.getByRole('button', { name: 'Добавить запись' }).click();
  await expect(card.getByText(/Назначен цефтриаксон/u)).toBeVisible();

  // A follow-up nests under the visit it belongs to.
  await card.getByRole('button', { name: 'Уточнить' }).click();
  await card.getByLabel('Вложенная заметка').fill('Через 48 часов температура снизилась');
  await card.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(card.locator('.patient-note-branch.nested')).toContainText('Через 48 часов');

  // The note survives a reload, because it lives on this device only.
  await page.reload();
  await navigationButton(page, 'Заметки').click();
  const reloadedCard = page.locator('.patient-card').filter({ hasText: 'Иванов И.' });
  await reloadedCard.locator('summary').click();
  await expect(reloadedCard.getByText(/Назначен цефтриаксон/u)).toBeVisible();

  // Searching finds it, labelled as personal and outside the official results container.
  await navigationButton(page, 'Поиск').click();
  await page.getByTestId('search-input').fill('цефтриаксон пневмония');

  const personal = page.locator('.personal-note-matches');
  await expect(personal).toBeVisible();
  await expect(personal.getByText('Личные записи')).toBeVisible();
  await expect(personal.getByText(/Не официальный источник/u)).toBeVisible();
  await expect(personal).toContainText('Иванов И., 3 года, 20 кг');
  await expect(page.getByTestId('search-results')).not.toContainText('Иванов И.');

  await personal.getByRole('button', { name: 'Открыть заметки' }).click();
  await expect(page.getByRole('heading', { name: 'Заметки' })).toBeVisible();
});
