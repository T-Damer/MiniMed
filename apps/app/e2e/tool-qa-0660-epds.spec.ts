import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// QA 0.6.60 finding 11: EPDS showed its verdict twice with different words, called 21 of 30 the
// «lower» guideline and kept the item-10 (self-harm) answer in the small print.
test('EPDS: one verdict that fits the score, and the item-10 answer as an alert', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  const download = page.getByRole('button', { name: 'Скачать раздел — Акушерство' });
  if (await download.isVisible()) {
    await download.click();
    await expect(page.getByText(/«Акушерство» скачан/u).first()).toBeVisible({ timeout: 120_000 });
  }
  await page.evaluate(() => {
    window.location.hash = '#/assessments/postnatal-mood-epds';
  });
  const questions = page.locator('.assessment-questionnaire .assessment-question');
  await expect(questions).toHaveCount(10, { timeout: 60_000 });
  // The first answer of every question: 0 for items 1, 2 and 4, 3 for the other seven = 21 of 30,
  // and 3 for item 10 («Да, достаточно часто»).
  for (let index = 0; index < 10; index += 1) {
    await questions
      .nth(index)
      .locator('input')
      .first()
      .evaluate((input: HTMLInputElement) => input.click());
  }
  await page.getByTestId('assessment-submit').click();

  const summary = page.locator('.assessment-result-summary').first();
  await expect(summary).toContainText('Результат достигает скринингового ориентира или выше');
  await expect(summary).not.toContainText('нижний');
  // The verdict is written once, not again with different words.
  await expect(page.locator('.assessment-result-evaluation')).toHaveCount(0);
  await expect(
    summary.getByText('Результат достигает скринингового ориентира или выше'),
  ).toHaveCount(1);
  // The safety answer is its own prominent alert, first in the card.
  const alert = summary.getByRole('alert');
  await expect(alert).toContainText('Пункт 10');
  await expect(alert).toContainText('немедленной оценки безопасности');
  expect(
    await summary.evaluate((card) =>
      card.firstElementChild?.classList.contains('assessment-result-alert'),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
