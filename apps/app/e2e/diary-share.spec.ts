import { expect, test } from '@playwright/test';

import { decodeDiaryResultsText } from '../src/features/diary/diary-codec';
import {
  addReading,
  backToHome,
  DIARY_PAGE,
  ENTRY_ROWS,
  expectRecordCount,
  localInput,
  openDiaryList,
  openRecords,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

const SEND = 'Отправить врачу';

test.describe('patient diary: returning results to the doctor', () => {
  test('the diary says honestly what was and was not handed over', async ({ page }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await addReading(page, { systolic: 150, diastolic: 95, at: localInput(2, 8) });
    await addReading(page, { systolic: 140, diastolic: 90, at: localInput(1, 8) });

    const send = page.getByRole('button', { name: SEND, exact: true });
    await expect(send).toContainText('Не отправлено: 2 записи');
    await openRecords(page);
    await expect(page.locator('.diary-record__badge')).toHaveCount(2);
    await backToHome(page);

    await send.click();
    await expect(page.locator('.diary-send__status')).toContainText(
      'Врачу пока ничего не отправлено',
    );
    await page.getByRole('button', { name: 'Показать врачу на экране', exact: true }).click();
    await expect(page.locator('.diary-share__code')).toBeVisible();
    // Showing the codes is not proof that the doctor scanned them: nothing is marked yet.
    await page.getByRole('button', { name: 'Ещё нет' }).click();
    await backToHome(page);
    await expect(send).toContainText('Не отправлено: 2 записи');

    await send.click();
    await page.getByRole('button', { name: 'Показать врачу на экране', exact: true }).click();
    await page.getByRole('button', { name: 'Да, врач получил' }).click();
    await expect(page.locator('.diary-done')).toContainText('Всё отправлено');
    await backToHome(page);
    await expect(send).toContainText('Всё отправлено');
    await openRecords(page);
    await expect(page.locator('.diary-record__badge')).toHaveCount(0);
    await backToHome(page);

    // Later entries and corrections are flagged as not yet handed over.
    await addReading(page, { systolic: 132, diastolic: 84, at: localInput(0, 8) });
    await expect(send).toContainText('Не отправлено: 1 запись');
    await openRecords(page);
    await page
      .locator(ENTRY_ROWS)
      .nth(1)
      .getByRole('button', { name: /^Изменить/u })
      .click();
    await page.getByLabel(/^Верхнее/u).fill('145');
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect(
      page.locator('.diary-record__badge', { hasText: 'Изменена после отправки' }),
    ).toHaveCount(1);
    await expect(
      page.locator('.diary-record__badge', { hasText: 'Не отправлена врачу' }),
    ).toHaveCount(1);
    await backToHome(page);
    await expect(send).toContainText('Не отправлено: 2 записи');
    await send.click();
    await expect(page.locator('.diary-send__status')).toContainText('новых или изменённых: 2');
    await backToHome(page);

    // The list shows the same count so the patient notices from the first screen.
    await openDiaryList(page);
    await expect(page.locator('.diary-list__item')).toContainText('Не отправлено: 2 записи');
  });

  test('a file for the doctor carries every entry, and doubles as a backup', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined });
    });
    await page.goto(await testInvitationLink(testInvitation()));
    await addReading(page, { systolic: 150, diastolic: 95, pulse: 80, at: localInput(2, 8) });
    await addReading(page, { systolic: 138, diastolic: 88, at: localInput(1, 8) });
    await addReading(page, { systolic: 128, diastolic: 82, at: localInput(0, 8) });

    await page.getByRole('button', { name: SEND, exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Отправить файлом', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^дневник-.+\.txt$/u);
    const path = await file.path();
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    const results = await decodeDiaryResultsText(text);
    expect(results.entries).toHaveLength(3);
    expect(results.invitation.title).toContain('давления');
    await expect(page.locator('.diary-send__status')).toContainText(
      'Врачу пока ничего не отправлено',
    );
    await expect(page.locator('.diary-send__message')).toContainText('Файл сохранён в загрузках');
    await page.getByRole('button', { name: 'Да, врач получил' }).click();
    await expect(page.locator('.diary-done')).toContainText('Всё отправлено');
  });

  test('the native share sheet is used where the browser has one', async ({ page }) => {
    await page.addInitScript(() => {
      Object.assign(navigator, {
        canShare: () => true,
        share: async (data: { files: File[]; title: string }) => {
          (window as unknown as { __shared?: unknown }).__shared = {
            title: data.title,
            name: data.files[0]?.name,
            type: data.files[0]?.type,
          };
        },
      });
    });
    await page.goto(await testInvitationLink(testInvitation()));
    await addReading(page, { systolic: 150, diastolic: 95, at: localInput(0, 8) });
    await page.getByRole('button', { name: SEND, exact: true }).click();
    await page.getByRole('button', { name: 'Отправить файлом', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown }).__shared))
      .toMatchObject({ type: 'text/plain' });
    await expect(page.getByRole('button', { name: 'Да, врач получил' })).toBeVisible();
  });

  test('with nothing written yet there is nothing to send, and the way to write is one tap', async ({
    page,
  }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await page.getByRole('button', { name: SEND, exact: true }).click();
    await expect(page.getByText('Отправлять пока нечего')).toBeVisible();
    await page.getByRole('button', { name: 'Записать показания', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Новая запись' })).toBeVisible();
  });

  // The system clipboard is shared by all browsers on the machine: run these one after another.
  test.describe('through the clipboard', () => {
    test.describe.configure({ mode: 'serial' });

    test('records come back from a copy on a new phone, twice over without duplicates', async ({
      browser,
      context,
      page,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const invitation = testInvitation({ doctor: 'Иванова А. А.' });
      await page.goto(await testInvitationLink(invitation));
      await addReading(page, { systolic: 150, diastolic: 95, at: localInput(2, 8) });
      await addReading(page, { systolic: 138, diastolic: 88, at: localInput(1, 8) });
      await page.getByRole('button', { name: SEND, exact: true }).click();
      await page.getByRole('button', { name: 'Скопировать текстом', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain('MMD1.');
      const copied = await page.evaluate(() => navigator.clipboard.readText());

      // A fresh browser: the patient has lost everything.
      const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const phone = await fresh.newPage();
      await phone.goto(DIARY_PAGE);
      await expect(phone.locator('main')).toContainText('пока нет дневников');
      await phone.getByText('Восстановить записи из файла или текста').click();
      await phone.getByLabel('Или вставьте текст').fill(`Вот мой дневник:\n${copied}\nСпасибо!`);
      await phone.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(phone.locator('.diary-restore')).toContainText('Добавлено: 2 записи');
      await expect(phone.locator('.diary-list__item')).toHaveCount(1);
      await expect(phone.locator('.diary-list__item')).toContainText('Не отправлено: 2 записи');

      await phone.getByLabel('Или вставьте текст').fill(copied);
      await phone.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(phone.locator('.diary-restore')).toContainText('Новых записей нет');
      await phone.locator('.diary-list__open').click();
      await expectRecordCount(phone, 2);
      await fresh.close();
    });

    test('restoring adds to a diary that already has entries and never overwrites them', async ({
      context,
      page,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const invitation = testInvitation();
      await page.goto(await testInvitationLink(invitation));
      await addReading(page, { systolic: 150, diastolic: 95, at: localInput(3, 8) });
      await page.getByRole('button', { name: SEND, exact: true }).click();
      await page.getByRole('button', { name: 'Скопировать текстом', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain('MMD1.');
      const oldCopy = await page.evaluate(() => navigator.clipboard.readText());
      await backToHome(page);

      await addReading(page, { systolic: 120, diastolic: 80, at: localInput(0, 8) });
      await page.getByRole('button', { name: /^Ещё/u }).click();
      await page.getByText('Восстановить записи из файла или текста').click();
      await page.getByLabel('Или вставьте текст').fill(oldCopy);
      await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(page.locator('.diary-restore')).toContainText('Новых записей нет');
      await backToHome(page);
      await expectRecordCount(page, 2);
    });

    test('a diary copy saved in Safari restores the diary and its entries in the home-screen app', async ({
      browser,
      context,
      page,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const invitation = testInvitation({ doctor: 'Иванова А. А.' });
      await page.goto(await testInvitationLink(invitation));
      await addReading(page, { systolic: 150, diastolic: 95, at: localInput(2, 8) });
      await addReading(page, { systolic: 138, diastolic: 88, at: localInput(1, 8) });
      // What «Add to Home Screen» saves: the address with the invitation.
      const iconAddress = page.url();
      expect(iconAddress).toContain('#i=');
      await page.getByRole('button', { name: SEND, exact: true }).click();
      await page.getByRole('button', { name: 'Скопировать текстом', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain('MMD1.');
      const copied = await page.evaluate(() => navigator.clipboard.readText());

      // The icon: separate storage, started at the saved address (fragment kept).
      const icon = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await icon.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { value: true });
      });
      const app = await icon.newPage();
      await app.goto(iconAddress);
      await expect(app.getByRole('heading', { level: 1 })).toContainText('давления');
      await expect(app.locator('.diary-notice')).toContainText(
        'Если вы уже делали записи в Safari',
      );
      await expectRecordCount(app, 0);
      // A second launch from the icon says nothing new about the same link.
      await app.reload();
      await expect(app.getByRole('heading', { level: 1 })).toContainText('давления');
      await expect(app.locator('.diary-notice')).toHaveCount(0);

      await app.getByRole('button', { name: /^Ещё/u }).click();
      await app.getByText('Восстановить записи из файла или текста').click();
      await app.getByLabel('Или вставьте текст').fill(copied);
      await app.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(app.locator('.diary-restore')).toContainText('Добавлено: 2 записи');
      await backToHome(app);
      await expectRecordCount(app, 2);
      await icon.close();

      // The other way round: the icon is empty and never saw the link at all.
      const bare = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const empty = await bare.newPage();
      await empty.goto(DIARY_PAGE);
      await empty.getByText('Восстановить записи из файла или текста').click();
      await empty.getByLabel('Или вставьте текст').fill(copied);
      await empty.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(empty.locator('.diary-restore')).toContainText('Добавлено: 2 записи');
      await expect(empty.locator('.diary-list__item')).toContainText(
        'Дневник артериального давления',
      );
      await bare.close();
    });
  });

  test('text that is not a diary copy, or only part of one, is refused with a reason', async ({
    page,
  }) => {
    await page.goto(DIARY_PAGE);
    await page.getByText('Восстановить записи из файла или текста').click();
    await page.getByLabel('Или вставьте текст').fill('привет');
    await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
    await expect(page.locator('.diary-restore')).toContainText('нет данных дневника');

    await page.goto(await testInvitationLink(testInvitation()));
    for (let index = 0; index < 1; index += 1) {
      await addReading(page, { systolic: 130, diastolic: 80, at: localInput(0, 8) });
    }
    await openDiaryList(page);
    await page.getByText('Восстановить записи из файла или текста').click();
    await page.getByLabel('Или вставьте текст').fill('MMD1.AAAAAAAA.1.2.abcdef');
    await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
    await expect(page.locator('.diary-restore')).toContainText('Данные неполные');
  });
});

test.describe('patient diary: a browser that cannot keep data', () => {
  test('blocked storage is explained instead of silently losing entries', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
    });
    await page.goto(await testInvitationLink(testInvitation()));
    await expect(page.locator('.diary-error')).toContainText('приватное окно');
  });
});
