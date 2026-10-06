import { expect, test } from '@playwright/test';

import { decodeDiaryResultsText } from '../src/features/diary/diary-codec';
import {
  addReading,
  DIARY_PAGE,
  ENTRY_ROWS,
  localInput,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

const SEND = 'Передать врачу';

test.describe('patient diary: returning results to the doctor', () => {
  test('the diary says honestly what was and was not handed over', async ({ page }) => {
    await page.goto(await testInvitationLink(testInvitation()));
    await addReading(page, { systolic: 150, diastolic: 95, at: localInput(2, 8) });
    await addReading(page, { systolic: 140, diastolic: 90, at: localInput(1, 8) });

    const status = page.locator('.diary-send__status');
    await expect(status).toContainText('Врачу ещё ничего не передано. Записей: 2.');
    await expect(page.locator('.diary-entries__badge')).toHaveCount(2);

    await page.getByRole('button', { name: SEND, exact: true }).click();
    await page.getByRole('button', { name: 'Показать коды на экране' }).click();
    await expect(page.locator('.diary-share__code')).toBeVisible();
    // Showing the codes is not proof that the doctor scanned them: nothing is marked yet.
    await page.getByRole('button', { name: 'Ещё нет' }).click();
    await page.getByRole('button', { name: 'Назад к дневнику' }).click();
    await expect(status).toContainText('Врачу ещё ничего не передано');

    await page.getByRole('button', { name: SEND, exact: true }).click();
    await page.getByRole('button', { name: 'Показать коды на экране' }).click();
    await page.getByRole('button', { name: 'Врач получил' }).click();
    await page.getByRole('button', { name: 'Назад к дневнику' }).click();
    await expect(status).toContainText('Всё передано врачу');
    await expect(page.locator('.diary-entries__badge')).toHaveCount(0);

    // Later entries and corrections are flagged as not yet handed over.
    await addReading(page, { systolic: 132, diastolic: 84, at: localInput(0, 8) });
    await expect(status).toContainText('Передано врачу');
    await expect(status).toContainText('2 из 3');
    await expect(status).toContainText('новых: 1');
    await page.locator(ENTRY_ROWS).last().getByRole('button', { name: 'Изменить запись' }).click();
    await page.getByLabel(/^Верхнее/u).fill('145');
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect(status).toContainText('изменённых после передачи: 1');
    await expect(
      page.locator('.diary-entries__badge', { hasText: 'Изменена после передачи' }),
    ).toHaveCount(1);

    // The list shows the same count so the patient notices from the first screen.
    await page.getByRole('button', { name: /Мои дневники/u }).click();
    await expect(page.locator('.diary-list__item')).toContainText('Не передано врачу: 2');
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
    await page.getByRole('button', { name: 'Отправить файлом' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^дневник-.+\.txt$/u);
    const path = await file.path();
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    const results = await decodeDiaryResultsText(text);
    expect(results.entries).toHaveLength(3);
    expect(results.invitation.title).toContain('давления');
    await expect(page.locator('.diary-share__status')).toContainText(
      'Врачу ещё ничего не передано',
    );
    await page.getByRole('button', { name: 'Врач получил' }).click();
    await expect(page.locator('.diary-share__status')).toContainText('Всё передано врачу');
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
    await page.getByRole('button', { name: 'Отправить файлом' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown }).__shared))
      .toMatchObject({ type: 'text/plain' });
    await expect(page.getByRole('button', { name: 'Врач получил' })).toBeVisible();
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
      await page.getByRole('button', { name: 'Скопировать текстом' }).click();
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
      await expect(phone.locator('.diary-list__item')).toContainText('Не передано врачу: 2');

      await phone.getByLabel('Или вставьте текст').fill(copied);
      await phone.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(phone.locator('.diary-restore')).toContainText('Новых записей нет');
      await phone.locator('.diary-list__open').click();
      await expect(phone.locator(ENTRY_ROWS)).toHaveCount(2);
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
      await page.getByRole('button', { name: 'Скопировать текстом' }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain('MMD1.');
      const oldCopy = await page.evaluate(() => navigator.clipboard.readText());
      await page.getByRole('button', { name: 'Назад к дневнику' }).click();

      await addReading(page, { systolic: 120, diastolic: 80, at: localInput(0, 8) });
      await page.getByText('Печать, файлы и копия').click();
      await page.getByText('Восстановить записи из файла или текста').click();
      await page.getByLabel('Или вставьте текст').fill(oldCopy);
      await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(page.locator('.diary-restore')).toContainText('Новых записей нет');
      await expect(page.locator(ENTRY_ROWS)).toHaveCount(2);
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
      await page.getByRole('button', { name: 'Скопировать текстом' }).click();
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
      await expect(app.locator(ENTRY_ROWS)).toHaveCount(0);
      // A second launch from the icon says nothing new about the same link.
      await app.reload();
      await expect(app.getByRole('heading', { level: 1 })).toContainText('давления');
      await expect(app.locator('.diary-notice')).toHaveCount(0);

      await app.getByText('Печать, файлы и копия').click();
      await app.getByText('Восстановить записи из файла или текста').click();
      await app.getByLabel('Или вставьте текст').fill(copied);
      await app.getByRole('button', { name: 'Восстановить', exact: true }).click();
      await expect(app.locator('.diary-restore')).toContainText('Добавлено: 2 записи');
      await expect(app.locator(ENTRY_ROWS)).toHaveCount(2);
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
    await page.getByRole('button', { name: /Мои дневники/u }).click();
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
