import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

function navigationButton(page: Page, name: string) {
  return page.locator('.app-bottom-nav').getByRole('button', { name, exact: true });
}

function futureDateInput(days = 2): string {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

test('keeps patient note records local, editable in nested routes, and findable from search', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await navigationButton(page, 'Заметки').click();
  await expect(page.getByRole('heading', { name: 'Заметки' })).toBeVisible();
  await expect(page.locator('.patient-card').filter({ hasText: 'Привет, коллега!' })).toBeVisible();

  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await page.getByLabel('Название карточки').fill('Иванов И., 3 года, 20 кг');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  const card = page.locator('.patient-card').filter({ hasText: 'Иванов И.' });
  await expect(card).toBeVisible();
  await card.click();

  await expect(page).toHaveURL(/#\/notes\/.+/u);
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await expect(page).toHaveURL(/\/records\/new$/u);
  await page
    .getByLabel('Новая заметка для Иванов И., 3 года, 20 кг')
    .fill('Назначен цефтриаксон, вторая линия при пневмонии');
  const imageTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['image'], 'очень-длинное-название-осмотра.png', { type: 'image/png' }),
    );
    return transfer;
  });
  await page.locator('.note-image-picker').dispatchEvent('drop', {
    dataTransfer: imageTransfer,
  });
  await imageTransfer.dispose();
  await expect(page.locator('.note-image-previews img')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const record = page.locator('.patient-note-record');
  await expect(record).toContainText('Назначен цефтриаксон');
  await record.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Редактировать запись' })).toBeVisible();
  await expect(page.getByLabel('Текст записи')).toHaveValue(/Назначен цефтриаксон/u);
  await expect(page.locator('.record-images-editor .note-image-previews img')).toBeVisible();
  await page.getByLabel('Назад к записям').click();
  await navigationButton(page, 'Поиск').click();
  await navigationButton(page, 'Заметки').click();
  await expect(page.getByRole('heading', { name: 'Заметки' })).toBeVisible();
  await card.click();

  // The note survives a reload, because it lives on this device only.
  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText(/Назначен цефтриаксон/u);

  // Searching finds it, labelled as personal and outside the official results container.
  await navigationButton(page, 'Поиск').click();
  await page.getByRole('radio', { name: /Всё без диагностики/u }).click();
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

test('reminders surface in the tab bar and close with a recorded condition', async ({ page }) => {
  const past = new Date(Date.now() - 3_600_000).toISOString();
  const seeded = {
    cards: [
      {
        id: 'card-r1',
        title: 'Петров П., 5 лет',
        summary: '',
        createdAt: past,
        updatedAt: past,
      },
      {
        id: 'card-r2',
        title: 'Без напоминаний',
        summary: '',
        createdAt: past,
        updatedAt: past,
      },
    ],
    notes: [
      {
        id: 'note-r1',
        cardId: 'card-r1',
        parentNoteId: null,
        text: 'Контроль сатурации через час',
        createdAt: past,
        updatedAt: past,
        reminder: { dueAt: past, allDay: false, completedAt: null, completionNote: '' },
      },
    ],
  };
  await mountBuiltApp(page, {
    persistentOrigin: true,
    localStorage: { 'minimed.patient-notes.v1': JSON.stringify(seeded) },
  });

  // The due follow-up is loud before the section is even opened.
  const notesButton = page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /Заметки, напоминаний: 1/u });
  await expect(notesButton).toBeVisible();
  await expect(page.locator('.app-nav-badge--reminder')).toHaveText('1');

  await notesButton.click();
  const cards = page.locator('.patient-card');
  await expect(cards.first()).toContainText('Петров П.');
  await expect(cards.first()).toHaveClass(/has-due-reminder/u);

  await cards.first().click();
  const link = page.locator('.note-reminder-link');
  await expect(link).toHaveClass(/due/u);
  await link.click();

  await page.getByLabel('Чем закрыто напоминание').fill('сатурация 97, жалоб нет');
  await page.getByRole('button', { name: 'Выполнено' }).click();

  await expect(page.locator('.app-nav-badge--reminder')).toHaveCount(0);
  await expect(page.locator('.note-reminder-link')).toContainText('выполнено');
  await expect(
    page.locator('.app-bottom-nav').getByRole('button', { name: 'Заметки', exact: true }),
  ).toBeVisible();
});

test('a reminder can be attached while writing a note', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });
  await page.context().grantPermissions(['notifications'], {
    origin: new URL(page.url()).origin,
  });
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();

  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await page.getByLabel('Название карточки').fill('Сидорова А.');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  const card = page.locator('.patient-card').filter({ hasText: 'Сидорова А.' });
  await card.click();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await page.getByLabel('Новая заметка для Сидорова А.').fill('Повторный осмотр');
  await page.getByLabel('Дата напоминания').fill(futureDateInput());
  await expect(page.getByText('Системное уведомление', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить запись' }).click();

  const link = page.locator('.note-reminder-link');
  await expect(link).toBeVisible();
  await expect(link).not.toHaveClass(/due/u);
});

test('requires a valid reminder timestamp before installation', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });
  await navigationButton(page, 'Заметки').click();
  await page.getByRole('button', { name: 'Создать карточку' }).click();
  await page.getByLabel('Название карточки').fill('Орлова М.');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.locator('.patient-card').filter({ hasText: 'Орлова М.' }).click();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await page.getByLabel('Новая заметка для Орлова М.').fill('Контроль состояния');
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await page.locator('.patient-note-record').getByRole('button').first().click();

  const install = page.getByRole('button', { name: 'Установить' });
  await expect(install).toBeDisabled();
  await page.getByLabel('Дата напоминания').fill(futureDateInput());
  await expect(install).toBeEnabled();
  await install.click();
  await expect(page.locator('.note-reminder-link')).toBeVisible();
});

test('warns before leaving a record with unsaved changes', async ({ page }) => {
  const createdAt = new Date().toISOString();
  await mountBuiltApp(page, {
    persistentOrigin: true,
    localStorage: {
      'minimed.patient-notes.v1': JSON.stringify({
        cards: [
          { id: 'guard-card', title: 'Черновик', summary: '', createdAt, updatedAt: createdAt },
        ],
        notes: [],
      }),
    },
  });

  await navigationButton(page, 'Заметки').click();
  await page.locator('.patient-card').filter({ hasText: 'Черновик' }).click();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await page.getByLabel('Новая заметка для Черновик').fill('Несохранённый текст');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Несохранённые изменения');
    await dialog.dismiss();
  });
  await navigationButton(page, 'Поиск').click();
  await expect(page).toHaveURL(/\/records\/new$/u);

  page.once('dialog', (dialog) => dialog.accept());
  await navigationButton(page, 'Поиск').click();
  await expect(page).toHaveURL(/#\/search$/u);
});
