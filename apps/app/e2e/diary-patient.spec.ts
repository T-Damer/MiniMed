import { expect, test } from '@playwright/test';

import {
  addReading,
  backToHome,
  DIARY_PAGE,
  ENTRY_ROWS,
  expectRecordCount,
  IPHONE_SAFARI,
  localInput,
  openDiaryList,
  openRecords,
  setEntryTime,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

const WRITE = 'Записать показания';

test.describe('patient diary: finding the same diary again', () => {
  test('a link opened once is stored even without entries, and the bare page lands on it', async ({
    page,
  }) => {
    const invitation = testInvitation({ doctor: 'Иванова А. А.' });
    await page.goto(await testInvitationLink(invitation));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('давления');
    await expect(page.locator('.diary-notice')).toContainText('Дневник добавлен');

    // Home-screen icon / bookmark: no link in the address, nothing entered yet.
    await page.goto(DIARY_PAGE);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('давления');
    await expect(page.getByRole('button', { name: WRITE, exact: true })).toBeVisible();
  });

  test('entries over several days survive closing the tab and reopening the same link', async ({
    context,
    page,
  }) => {
    const link = await testInvitationLink(testInvitation());
    await page.goto(link);
    await addReading(page, { systolic: 150, diastolic: 95, pulse: 80, at: localInput(2, 8, 10) });
    await addReading(page, { systolic: 142, diastolic: 90, at: localInput(1, 8, 5) });
    await addReading(page, { systolic: 135, diastolic: 85, at: localInput(0, 7, 55) });
    await expectRecordCount(page, 3);
    await page.close();

    const again = await context.newPage();
    await again.goto(link);
    await expectRecordCount(again, 3);
    await expect(again.locator('.diary-notice')).toContainText('Ваши записи на месте (3 записи)');
    await again.goto(DIARY_PAGE);
    await expectRecordCount(again, 3);
  });

  test('a newer link for the same diary updates the header and keeps every entry', async ({
    page,
  }) => {
    const id = 'sameid123456';
    const first = testInvitation({
      id,
      issuedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      doctor: 'Иванова А. А.',
    });
    const second = testInvitation({
      id,
      issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
      doctor: 'Иванова А. А.',
      note: 'Теперь измеряйте только утром',
    });
    await page.goto(await testInvitationLink(first));
    await addReading(page, { systolic: 128, diastolic: 82, at: localInput(1, 9) });

    await page.goto(await testInvitationLink(second));
    await expect(page.locator('.diary-header__note')).toHaveText('Теперь измеряйте только утром');
    await expect(page.locator('.diary-notice')).toContainText('Ваши записи сохранены');
    await expectRecordCount(page, 1);

    // The older link must not roll the header back.
    await page.goto(await testInvitationLink(first));
    await expect(page.locator('.diary-notice')).toContainText('старее');
    await expect(page.locator('.diary-header__note')).toHaveText('Теперь измеряйте только утром');
    await expectRecordCount(page, 1);

    // Still exactly one diary on the device.
    await openDiaryList(page);
    await expect(page.locator('.diary-list__item')).toHaveCount(1);
  });

  test('a plan the doctor changed keeps old entries readable and stops offering dropped items', async ({
    page,
  }) => {
    const id = 'planid1234567';
    const before = testInvitation({
      id,
      template: 'medication',
      issuedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      plan: [
        { id: 'p1', name: 'Эналаприл', dose: '5 мг' },
        { id: 'p2', name: 'Амлодипин', dose: '5 мг' },
      ],
    });
    const after = testInvitation({
      id,
      template: 'medication',
      issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
      plan: [
        { id: 'p2', name: 'Амлодипин', dose: '5 мг' },
        { id: 'p3', name: 'Лозартан', dose: '50 мг' },
      ],
    });
    await page.goto(await testInvitationLink(before));
    await page.getByRole('button', { name: WRITE, exact: true }).click();
    await page.getByRole('button', { name: /Эналаприл/u }).click();
    await setEntryTime(page, localInput(1, 8));
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await openRecords(page);
    await expect(page.locator(ENTRY_ROWS)).toContainText('Эналаприл');
    await backToHome(page);

    await page.goto(await testInvitationLink(after));
    await expect(page.locator('.diary-notice')).toContainText('Врач обновил дневник');
    const plan = page.getByRole('region', { name: 'Назначение врача' });
    await expect(plan).toContainText('Лозартан');
    await expect(plan).not.toContainText('Эналаприл');
    await openRecords(page);
    await expect(page.locator(ENTRY_ROWS)).toContainText('Эналаприл');
    await backToHome(page);
    await page.getByRole('button', { name: WRITE, exact: true }).click();
    await expect(page.getByRole('button', { name: /Лозартан/u })).toBeVisible();
    await expect(page.getByRole('button', { name: /Эналаприл/u })).toHaveCount(0);

    // The page still opens after a reload: the stored diary is valid against the merged header.
    await page.reload();
    await expectRecordCount(page, 1);
  });

  test('a link for a different diary is listed next to the first, last used first', async ({
    page,
  }) => {
    const pressure = testInvitation({ doctor: 'Иванова А. А.' });
    const glucose = testInvitation({ template: 'glucose' });
    await page.goto(await testInvitationLink(pressure));
    await addReading(page, { systolic: 130, diastolic: 80 });
    await page.goto(await testInvitationLink(glucose));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('глюкозы');

    await page.goto(DIARY_PAGE);
    const items = page.locator('.diary-list__item');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('глюкозы');
    await expect(items.first()).toContainText('Продолжить');
    await expect(items.nth(1)).toContainText('давления');
    await expect(items.nth(1)).toContainText('Мои записи (1)');
    await expect(items.nth(1)).toContainText('Не отправлено: 1 запись');
    await expect(items.first()).toContainText('Записей пока нет');

    await items.nth(1).locator('.diary-list__open').click();
    await expectRecordCount(page, 1);
  });

  test('each diary card has the three actions and opens that very step', async ({ page }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await addReading(page, { systolic: 130, diastolic: 80, at: localInput(0, 8) });
    await page.goto(await testInvitationLink(testInvitation({ template: 'glucose' })));
    await page.goto(DIARY_PAGE);
    const pressure = page.locator('.diary-list__item', { hasText: 'давления' });

    await pressure.getByRole('button', { name: /^Мои записи/u }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Мои записи' })).toBeVisible();
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(1);
    await page.goto(DIARY_PAGE);

    await pressure.getByRole('button', { name: /^Отправить врачу/u }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Отправить врачу' })).toBeVisible();
    await page.goto(DIARY_PAGE);

    await pressure.getByRole('button', { name: /^Записать показания/u }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Новая запись' })).toBeVisible();
    await expect(page.getByLabel(/^Верхнее/u)).toBeVisible();
  });

  test('closing the browser and starting it again keeps the diary', async ({ browser, page }) => {
    const link = await testInvitationLink(testInvitation());
    await page.goto(link);
    await addReading(page, { systolic: 121, diastolic: 79, at: localInput(0, 7) });
    const state = await page.context().storageState();
    await page.context().close();

    const restarted = await browser.newContext({
      storageState: state,
      viewport: { width: 390, height: 844 },
    });
    const next = await restarted.newPage();
    await next.goto(DIARY_PAGE);
    await expectRecordCount(next, 1);
    await restarted.close();
  });

  test('a broken link says what to do and still reaches the stored diaries', async ({ page }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await page.goto(`${DIARY_PAGE}#i=zbroken`);
    await expect(page.locator('.diary-error')).toBeVisible();
    await page.getByRole('button', { name: 'Мои дневники' }).click();
    await expect(page.locator('.diary-list__item')).toHaveCount(1);
  });
});

test.describe('patient diary: the home and its three actions', () => {
  test('doctor, instruction and the three actions are on the first screen, no scrolling', async ({
    page,
  }) => {
    await page.goto(
      await testInvitationLink(
        testInvitation({
          doctor: 'Иванова А. А.',
          note: 'Утром и вечером, сидя, после 5 минут отдыха',
        }),
      ),
    );
    await expect(page.getByRole('heading', { level: 1 })).toContainText('давления');
    await expect(page.getByText('Врач: Иванова А. А.')).toBeVisible();
    await expect(page.locator('.diary-header__note')).toContainText('Утром и вечером');
    const viewport = page.viewportSize()?.height ?? 0;
    for (const name of [WRITE, /^Мои записи \(0\)$/u, 'Отправить врачу']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box, String(name)).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0), String(name)).toBeLessThanOrEqual(viewport);
      expect(box?.height ?? 0, String(name)).toBeGreaterThanOrEqual(80);
    }
    // The install tip, restore and print are not above the actions: they come after.
    const write = await page.getByRole('button', { name: WRITE, exact: true }).boundingBox();
    const tips = page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' });
    if ((await tips.count()) > 0) {
      expect((await tips.boundingBox())?.y ?? 0).toBeGreaterThan(write?.y ?? 0);
    }
  });

  test('on an iPhone the install tip comes after the actions and the actions stay on the first screen', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_SAFARI,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(
      await testInvitationLink(
        testInvitation({ doctor: 'Иванова А. А.', note: 'Утром и вечером, сидя' }),
      ),
    );
    const tip = page.getByRole('region', { name: 'Добавить дневник на экран «Домой»' });
    await expect(tip).toBeVisible();
    const send = await page
      .getByRole('button', { name: 'Отправить врачу', exact: true })
      .boundingBox();
    expect((send?.y ?? 0) + (send?.height ?? 0)).toBeLessThanOrEqual(844);
    expect((await tip.boundingBox())?.y ?? 0).toBeGreaterThan((send?.y ?? 0) + (send?.height ?? 0));
    await context.close();
  });

  test('every action says where things stand, in words', async ({ page }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    const write = page.getByRole('button', { name: WRITE, exact: true });
    await expect(write).toContainText('Сегодня записей ещё нет');
    await expect(page.getByRole('button', { name: /^Отправить врачу/u })).toContainText(
      'Записей пока нет',
    );
    await addReading(page, { systolic: 150, diastolic: 95, at: localInput(2, 8, 10) });
    await addReading(page, { systolic: 138, diastolic: 88, at: localInput(0, 7, 55) });
    await expect(write).toContainText('Сегодня: 1 запись, последняя в 07:55');
    await expect(page.getByRole('button', { name: /^Мои записи/u })).toContainText(
      'Последняя: сегодня в 07:55',
    );
    await expect(page.getByRole('button', { name: /^Отправить врачу/u })).toContainText(
      'Не отправлено: 2 записи',
    );
  });

  test('open, fill, save, read, send: the whole flow with the confirmation on the way', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined });
    });
    await page.goto(await testInvitationLink(testInvitation({ doctor: 'Иванова А. А.' })));

    // Open the form: a page of its own, large fields, a number keyboard, units.
    await page.getByRole('button', { name: WRITE, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Новая запись' })).toBeVisible();
    const upper = page.getByLabel(/^Верхнее/u);
    await expect(upper).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByText('мм рт. ст.').first()).toBeVisible();
    await expect(page.getByText('от 50 до 300')).toBeVisible();
    expect((await upper.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(52);

    // Fill and save: back on the home, with the saved entry shown.
    await upper.fill('138');
    await page.getByLabel(/^Нижнее/u).fill('88');
    await page.getByRole('button', { name: 'левая', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const saved = page.locator('.diary-saved');
    await expect(saved).toContainText('Запись сохранена');
    await expect(saved).toContainText('138/88 мм рт. ст.');
    await expect(saved).toContainText('Рука: левая');
    await expect(page.getByRole('button', { name: WRITE, exact: true })).toBeVisible();
    await expectRecordCount(page, 1);

    // Read it back.
    await openRecords(page);
    const row = page.locator(ENTRY_ROWS);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('138/88 мм рт. ст.');
    await expect(row).toContainText('Не отправлена врачу');
    await expect(page.locator('.diary-day__name--today')).toHaveText('Сегодня');
    await backToHome(page);

    // Send: what goes, how, and the doctor's receipt.
    await page.getByRole('button', { name: 'Отправить врачу', exact: true }).click();
    await expect(page.locator('.diary-send__status')).toContainText('Все записи: 1 запись');
    await expect(page.getByRole('heading', { name: /Что будет отправлено/u })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Выберите, как отправить/u })).toBeVisible();
    await page.getByText('Показать записи, которые уйдут врачу').click();
    await expect(page.locator('.diary-fold__item')).toContainText('138/88 мм рт. ст.');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Отправить файлом', exact: true }).click();
    await download;
    await expect(page.getByText('Врач получил все записи?')).toBeVisible();
    await page.getByRole('button', { name: 'Да, врач получил' }).click();
    await expect(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
    await page.getByRole('button', { name: 'Вернуться к дневнику' }).click();
    await expect(page.getByRole('button', { name: /^Отправить врачу/u })).toContainText(
      'Всё отправлено',
    );

    // Reopen the page: everything is where it was.
    await page.reload();
    await expectRecordCount(page, 1);
    await expect(page.getByRole('button', { name: /^Отправить врачу/u })).toContainText(
      'Всё отправлено',
    );
  });

  test('a mistake is explained next to the field in plain words, and nothing is saved', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await page.getByRole('button', { name: WRITE, exact: true }).click();

    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.diary-form__error')).toContainText('Запись пока не сохранена');
    await expect(page.getByText('Заполните это поле.')).toHaveCount(2);
    await expect(page.getByLabel(/^Верхнее/u)).toBeFocused();
    await expect(page.getByLabel(/^Верхнее/u)).toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel(/^Верхнее/u).fill('1200');
    await page.getByLabel(/^Нижнее/u).fill('восемьдесят');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText(/Допустимо от 50 до 300 мм рт\. ст\./u)).toBeVisible();
    await expect(page.getByText(/лишней цифры/u)).toBeVisible();
    await expect(page.getByText('Введите число цифрами, например 120.')).toBeVisible();

    await page.getByLabel(/^Верхнее/u).fill('120');
    await page.getByLabel(/^Нижнее/u).fill('130');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText(/«Нижнее» должно быть меньше, чем «Верхнее»/u)).toBeVisible();

    // A comma is fine; once fixed the entry is saved.
    await page.getByLabel(/^Нижнее/u).fill('80');
    await page.getByLabel(/^Верхнее/u).fill('120');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.diary-saved')).toContainText('120/80');
    await expectRecordCount(page, 1);
  });

  test('leaving a half-filled form asks first, an empty one just leaves', async ({ page }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await page.getByRole('button', { name: WRITE, exact: true }).click();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByRole('button', { name: WRITE, exact: true })).toBeVisible();

    await page.getByRole('button', { name: WRITE, exact: true }).click();
    await page.getByLabel(/^Верхнее/u).fill('140');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByText('Выйти без сохранения?')).toBeVisible();
    await page.getByRole('button', { name: 'Остаться', exact: true }).click();
    await expect(page.getByLabel(/^Верхнее/u)).toHaveValue('140');
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expectRecordCount(page, 0);
  });

  test('an entry is corrected and deleted from «Мои записи», each deletion asked once', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await addReading(page, { systolic: 150, diastolic: 95, at: localInput(1, 8) });
    await addReading(page, { systolic: 138, diastolic: 88, at: localInput(0, 7, 55) });
    await openRecords(page);
    // Newest first, today marked, yesterday below.
    await expect(page.locator(ENTRY_ROWS).first()).toContainText('138/88');
    await expect(page.locator('.diary-day__name').first()).toHaveText('Сегодня');
    await expect(page.locator('.diary-day__name').nth(1)).toHaveText('Вчера');

    await page
      .locator(ENTRY_ROWS)
      .first()
      .getByRole('button', { name: /^Изменить/u })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Изменить запись' })).toBeVisible();
    await expect(page.getByLabel(/^Верхнее/u)).toHaveValue('138');
    await page.getByLabel(/^Верхнее/u).fill('132');
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    // Back in the list the patient came from, with the change confirmed.
    await expect(page.getByRole('heading', { level: 1, name: 'Мои записи' })).toBeVisible();
    await expect(page.locator('.diary-saved')).toContainText('Запись изменена');
    await expect(page.locator(ENTRY_ROWS).first()).toContainText('132/88');

    const oldest = page.locator(ENTRY_ROWS).nth(1);
    await oldest.getByRole('button', { name: /^Удалить/u }).click();
    await expect(oldest).toContainText('Удалить эту запись насовсем?');
    await oldest.getByRole('button', { name: 'Нет, оставить' }).click();
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(2);
    await oldest.getByRole('button', { name: /^Удалить/u }).click();
    await oldest.getByRole('button', { name: 'Да, удалить' }).click();
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(1);
    await backToHome(page);
    await expectRecordCount(page, 1);
  });

  test('the browser Back button returns from a step to the home, not out of the diary', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await expect(page.getByRole('button', { name: WRITE, exact: true })).toBeVisible();
    await page.getByRole('button', { name: WRITE, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Новая запись' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button', { name: WRITE, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Отправить врачу', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Отправить врачу' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button', { name: WRITE, exact: true })).toBeVisible();
    // The on-screen «На главную» takes the same road.
    await page.getByRole('button', { name: /^Ещё/u }).click();
    await backToHome(page);
    expect(page.url()).toContain('/diary/');
  });

  test('«Ещё» holds the rare things, and the install tip is dismissed once', async ({ page }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await expect(page.getByRole('button', { name: /^Распечатать/u })).toHaveCount(0);
    await page.getByRole('button', { name: /^Ещё/u }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ещё' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Распечатать/u })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Файл для другой программы/u })).toBeDisabled();
    await expect(page.getByText('Восстановить записи из файла или текста')).toBeVisible();
    await expect(page.getByText('Добавить дневник по ссылке врача')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Как пользоваться дневником' })).toContainText(
      'Записать показания',
    );
    await expect(page.getByRole('button', { name: 'Мои дневники', exact: true })).toBeVisible();
  });

  test('a long form keeps «Сохранить» on the screen while the patient scrolls', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(testInvitation({ template: 'child' })));
    await page.getByRole('button', { name: WRITE, exact: true }).click();
    const save = page.getByRole('button', { name: 'Сохранить', exact: true });
    const height = page.viewportSize()?.height ?? 0;
    const inside = async (): Promise<void> => {
      const box = await save.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
      expect(box?.y ?? 0).toBeGreaterThanOrEqual(0);
    };
    await inside();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(
      height * 1.5,
    );
    await page.evaluate(() => window.scrollTo(0, 700));
    await inside();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await inside();
    // The three kinds of controls a child's diary has all work: a flag, a counter, chips.
    await page.getByLabel('Был стул').check();
    await page.getByRole('button', { name: 'Больше: Стул за день, раз' }).click();
    await page.getByRole('button', { name: 'колики', exact: true }).click();
    await page.getByLabel(/^Вес/u).fill('4200');
    await expect(page.getByLabel(/^Вес/u)).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByLabel(/^Сон/u)).toHaveAttribute('inputmode', 'decimal');
    await save.click();
    await expect(page.locator('.diary-saved')).toContainText('Вес: 4');
    await expect(page.locator('.diary-saved')).toContainText('Был стул: да');
    await expect(page.locator('.diary-saved')).toContainText('Жалобы сейчас: колики');
  });
});
