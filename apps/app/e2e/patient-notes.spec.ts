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

async function setReminderDate(page: Page, value = futureDateInput()): Promise<void> {
  await page
    .locator('.native-datetime-field__wrapper input[type="date"]')
    .evaluate((input, date) => {
      const field = input as HTMLInputElement;
      field.value = date;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

async function openOrdinaryNoteDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Обычная заметка', exact: true }).press('Enter');
}

test('keeps patient note records local, editable in nested routes, and findable from search', async ({
  page,
}) => {
  const initialCardTitle = 'Иванов И., 3 года, 20 кг';
  const cardTitle = 'Иванов И., 4 года, 20 кг';
  await mountBuiltApp(page, { persistentOrigin: true });

  await navigationButton(page, 'Заметки').click();
  await expect(page.getByRole('heading', { name: 'Заметки' })).toBeVisible();
  await expect(page.locator('.patient-card').filter({ hasText: 'Привет, коллега!' })).toBeVisible();

  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Карточка пациента', exact: true }),
  ).toBeVisible();
  await page.getByRole('menuitem', { name: 'Шаблон', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Новый шаблон', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await navigationButton(page, 'Заметки').click();
  await openOrdinaryNoteDialog(page);
  await page.getByLabel('Название карточки').fill(initialCardTitle);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  const card = page.locator('.patient-card').filter({ hasText: 'Иванов И.' });
  await expect(card).toBeVisible();
  await card.click();

  await expect(page).toHaveURL(/#\/notes\/.+/u);
  await expect(page.locator('.notes-route-heading .page__header')).toHaveCount(0);
  await page
    .getByRole('button', { name: `Изменить название карточки «${initialCardTitle}»` })
    .click();
  const cardTitleEditor = page.getByRole('textbox', { name: 'Название карточки' });
  await cardTitleEditor.fill(cardTitle);
  await cardTitleEditor.press('Enter');
  await expect(
    page.getByRole('button', { name: `Изменить название карточки «${cardTitle}»` }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Изменить название карточки', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await expect(page).toHaveURL(/\/records\/new$/u);
  await page
    .getByLabel(`Новая заметка для ${cardTitle}`)
    .fill('Назначен цефтриаксон, вторая линия при пневмонии');
  const tags = page.getByLabel('Теги записи');
  await tags.fill('контроль аллергия, антибиотик;');
  await expect(page.locator('.patient-note-form__category')).toHaveCount(3);
  await page.getByRole('button', { name: 'Удалить тег «аллергия»' }).click();
  await expect(page.locator('.patient-note-form__category')).toHaveCount(2);
  const longTag = 'оченьдлинныйтег'.repeat(24);
  await tags.fill(`${longTag};`);
  const longTagChip = page.locator('.patient-note-form__category').filter({ hasText: longTag });
  await expect(
    longTagChip.locator('.patient-note-form__category-label-text--marquee'),
  ).toBeVisible();
  await longTagChip.getByRole('button').click();
  await expect(page.locator('.patient-note-form__category')).toHaveCount(2);
  await page.getByLabel('Добавить вложения').setInputFiles({
    name: 'очень-длинное-название-осмотра.png',
    mimeType: 'image/png',
    buffer: Buffer.from('image'),
  });
  await expect(page.locator('.note-image-previews img')).toBeVisible();
  await page.getByLabel('Назад к записям').click();
  const record = page.locator('.patient-note-record');
  await expect(record).toContainText('Назначен цефтриаксон');
  await record
    .getByRole('button')
    .first()
    .click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.notes-route-heading .page__header')).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить название записи', exact: true }).click();
  const recordTitle = page.getByRole('textbox', { name: 'Название записи' });
  await recordTitle.fill('Контрольный осмотр');
  await recordTitle.press('Enter');
  await page.getByRole('button', { name: 'Изменить название записи «Контрольный осмотр»' }).click();
  await recordTitle.fill('Первичный осмотр');
  await recordTitle.press('Enter');
  await expect(page.getByLabel('Текст записи')).toContainText(/Назначен цефтриаксон/u);
  await expect(page.locator('.patient-note-form__category')).toHaveCount(2);
  await expect(page.locator('.record-images-editor .note-image-previews img')).toBeVisible();
  await page.getByLabel('Назад к записям').click();
  await navigationButton(page, 'Поиск').click();
  await navigationButton(page, 'Заметки').click();
  await expect(page).toHaveURL(/#\/notes\/.+/u);
  await expect(page.locator('.patient-note-record')).toContainText('Назначен цефтриаксон');
  await expect(page.locator('.patient-note-record')).toContainText('Первичный осмотр');

  // The note survives a reload, because it lives on this device only.
  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText(/Назначен цефтриаксон/u);

  // Searching finds it, labelled as personal and outside the official results container.
  await navigationButton(page, 'Поиск').click();
  await page.getByTestId('search-input').fill('цефтриаксон пневмония');

  const personal = page.locator('.personal-note-matches');
  await expect(personal).toBeVisible();
  await expect(
    personal.getByRole('button', { name: 'Развернуть раздел «Ваши данные»' }),
  ).toBeVisible();
  await expect(personal.getByText(/Не официальный источник/u)).toHaveCount(0);
  await expect(personal).toContainText(cardTitle);
  await expect(page.getByTestId('search-results')).not.toContainText('Иванов И.', {
    timeout: 60_000,
  });

  await personal.getByRole('button', { name: 'Развернуть раздел «Ваши данные»' }).click();
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

  await openOrdinaryNoteDialog(page);
  await page.getByLabel('Название карточки').fill('Сидорова А.');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  const card = page.locator('.patient-card').filter({ hasText: 'Сидорова А.' });
  await card.click();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await page.getByLabel('Новая заметка для Сидорова А.').fill('Повторный осмотр');
  await setReminderDate(page);
  await expect(page.getByText('Системное уведомление', { exact: true })).toHaveCount(0);
  await page.getByLabel('Назад к записям').click();

  const link = page.locator('.note-reminder-link');
  await expect(link).toBeVisible();
  await expect(link).not.toHaveClass(/due/u);
});

test('requires a valid reminder timestamp before installation', async ({ page }) => {
  await mountBuiltApp(page, { persistentOrigin: true });
  await navigationButton(page, 'Заметки').click();
  await openOrdinaryNoteDialog(page);
  await page.getByLabel('Название карточки').fill('Орлова М.');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.locator('.patient-card').filter({ hasText: 'Орлова М.' }).click();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await page.getByLabel('Новая заметка для Орлова М.').fill('Контроль состояния');
  await page.getByLabel('Назад к записям').click();
  await page.locator('.patient-note-record').getByRole('button').first().click();
  await page.getByRole('button', { name: 'Напоминание' }).click();

  const install = page.getByRole('button', { name: 'Установить' });
  await expect(install).toBeDisabled();
  await setReminderDate(page);
  await expect(install).toBeEnabled();
  await install.click();
  await page.getByLabel('Назад к записям').click();
  await expect(page.locator('.note-reminder-link')).toBeVisible();
});

test('autosaves a new record when leaving the editor', async ({ page }) => {
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

  await navigationButton(page, 'Поиск').click();
  await expect(page).toHaveURL(/#\/search$/u);
  await navigationButton(page, 'Заметки').click();
  await page.getByLabel('Назад к записям').click();
  await expect(page.locator('.patient-note-record')).toContainText('Несохранённый текст');
});
