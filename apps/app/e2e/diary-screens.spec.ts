import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  addReading,
  DIARY_PAGE,
  IPHONE_MESSENGER,
  IPHONE_SAFARI,
  localInput,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

// Review screenshots of the patient diary at phone width. Only written when asked for:
//   DIARY_SCREENSHOTS=1 bunx playwright test diary-screens
const OUTPUT = resolve(import.meta.dirname, '../../../output/diary2-screens');
test.skip(!process.env['DIARY_SCREENSHOTS'], 'set DIARY_SCREENSHOTS=1 to write review screenshots');

for (const scheme of ['light', 'dark'] as const) {
  test(`patient diary screens, ${scheme}`, async ({ page }) => {
    mkdirSync(OUTPUT, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    const shot = (name: string) =>
      page.screenshot({ path: `${OUTPUT}/${name}-${scheme}.png`, fullPage: true });

    const pressure = testInvitation({
      doctor: 'Иванова А. А.',
      note: 'Утром и вечером, сидя, после 5 минут отдыха',
    });
    await page.goto(await testInvitationLink(pressure));
    await shot('1-first-open');
    await addReading(page, { systolic: 150, diastolic: 95, pulse: 80, at: localInput(2, 8, 10) });
    await addReading(page, { systolic: 138, diastolic: 88, at: localInput(0, 7, 55) });
    await shot('2-entries');

    await page.getByRole('button', { name: 'Передать врачу', exact: true }).click();
    await shot('3-send');
    await page.getByRole('button', { name: 'Показать коды на экране' }).click();
    await expect(page.locator('.diary-share__code')).toBeVisible();
    await shot('4-send-codes');

    await page.goto(await testInvitationLink(testInvitation({ template: 'glucose' })));
    await page.goto(DIARY_PAGE);
    await expect(page.locator('.diary-list__item')).toHaveCount(2);
    await shot('5-list');
  });

  test(`patient diary on an iPhone, ${scheme}`, async ({ browser }) => {
    mkdirSync(OUTPUT, { recursive: true });
    const link = await testInvitationLink(testInvitation({ doctor: 'Иванова А. А.' }));
    for (const [name, userAgent] of [
      ['6-iphone-install', IPHONE_SAFARI],
      ['7-messenger-warning', IPHONE_MESSENGER],
    ] as const) {
      const context = await browser.newContext({
        userAgent,
        colorScheme: scheme,
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await page.goto(link);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.screenshot({ path: `${OUTPUT}/${name}-${scheme}.png` });
      await context.close();
    }
  });

  test(`patient diary restore card, ${scheme}`, async ({ page }) => {
    mkdirSync(OUTPUT, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(DIARY_PAGE);
    await page.getByText('Восстановить записи из файла или текста').click();
    await expect(page.getByLabel('Или вставьте текст')).toBeVisible();
    await page.screenshot({ path: `${OUTPUT}/8-empty-restore-${scheme}.png`, fullPage: true });
  });
}
