import { expect, test } from '@playwright/test';

import {
  addReading,
  DIARY_PAGE,
  ENTRY_ROWS,
  localInput,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

test.use({ viewport: { width: 390, height: 844 } });

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
    await expect(page.getByRole('button', { name: 'Записать', exact: true })).toBeVisible();
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
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(3);
    await page.close();

    const again = await context.newPage();
    await again.goto(link);
    await expect(again.locator(ENTRY_ROWS)).toHaveCount(3);
    await expect(again.locator('.diary-notice')).toContainText('Ваши записи на месте (3 записи)');
    await again.goto(DIARY_PAGE);
    await expect(again.locator(ENTRY_ROWS)).toHaveCount(3);
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
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(1);

    // The older link must not roll the header back.
    await page.goto(await testInvitationLink(first));
    await expect(page.locator('.diary-notice')).toContainText('старее');
    await expect(page.locator('.diary-header__note')).toHaveText('Теперь измеряйте только утром');
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(1);

    // Still exactly one diary on the device.
    await page.getByRole('button', { name: /Мои дневники/u }).click();
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
    await page.getByLabel('Препарат').selectOption('p1');
    await page.getByLabel('Дата и время').fill(localInput(1, 8));
    await page.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(page.locator(ENTRY_ROWS)).toContainText('Эналаприл');

    await page.goto(await testInvitationLink(after));
    await expect(page.locator('.diary-notice')).toContainText('Врач обновил дневник');
    await expect(page.locator(ENTRY_ROWS)).toContainText('Эналаприл');
    const plan = page.getByRole('region', { name: 'Назначение врача' });
    await expect(plan).toContainText('Лозартан');
    await expect(plan).not.toContainText('Эналаприл');
    const options = await page.getByLabel('Препарат').locator('option').allTextContents();
    expect(options.join('|')).toContain('Лозартан');
    expect(options.join('|')).not.toContain('Эналаприл');

    // The page still opens after a reload: the stored diary is valid against the merged header.
    await page.reload();
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(1);
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
    await expect(items.nth(1)).toContainText('1 запись');
    await expect(items.nth(1)).toContainText('Не передано врачу: 1');

    await items.nth(1).locator('.diary-list__open').click();
    await expect(page.locator(ENTRY_ROWS)).toHaveCount(1);
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
    await expect(next.locator(ENTRY_ROWS)).toHaveCount(1);
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
