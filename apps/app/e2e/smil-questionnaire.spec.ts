import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

// MMPI1: the 566-item СМИЛ is filled page by page, its draft resumes on the page where the answers
// stopped (with the «Не знаю» count), and the finished test shows the T-score table and profile.
const QUESTIONS = '.assessment-questionnaire .assessment-question';
const REMOTE_CATALOG =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json';

/** The catalog of this checkout, which lists the module even before it is pushed. */
async function serveCheckoutCatalog(page: Page): Promise<void> {
  const body = readFileSync(
    resolve(import.meta.dirname, '../src/features/modules/catalog.preview.json'),
    'utf8',
  );
  await page.route(REMOTE_CATALOG, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body,
    }),
  );
}

/** Answers every unanswered question on the page with the option labelled `option`. */
async function answerPage(page: Page, option: 'Верно' | 'Неверно' | 'Не знаю'): Promise<void> {
  await page.evaluate((label) => {
    for (const question of document.querySelectorAll<HTMLElement>(
      '.assessment-questionnaire .assessment-question',
    )) {
      if (question.querySelector('input:checked')) continue;
      const choice = Array.from(
        question.querySelectorAll<HTMLElement>('.assessment-response-options__option'),
      ).find(
        (candidate) =>
          candidate.querySelector('.assessment-response-options__text')?.textContent?.trim() ===
          label,
      );
      choice?.querySelector('input')?.click();
    }
  }, option);
}

async function chooseAnswer(page: Page, number: number, label: string): Promise<void> {
  const question = page.locator(QUESTIONS).filter({
    has: page.locator('.assessment-question__number', { hasText: new RegExp(`^${number}$`) }),
  });
  await question
    .locator('.assessment-response-options__option')
    .filter({
      has: page.locator('.assessment-response-options__text', {
        hasText: new RegExp(`^${label}$`, 'u'),
      }),
    })
    .click();
}

test('СМИЛ: pages, resume with the «Не знаю» count, profile', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await serveCheckoutCatalog(page);
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/assessments/smil-men';
  });
  const install = page.getByRole('button', { name: /Скачать только этот тест/u });
  await expect(install.or(page.locator(QUESTIONS).first())).toBeVisible({ timeout: 60_000 });
  if (await install.isVisible()) await install.click();
  await expect(page.locator(QUESTIONS)).toHaveCount(20, { timeout: 120_000 });
  await expect(page.locator('.assessment-pager__label').first()).toContainText('Вопросы 1–20');
  await expect(page.locator('.assessment-variant-switch')).toBeVisible();

  // A few answers by hand, «Не знаю» counted as it is given.
  await chooseAnswer(page, 1, 'Верно');
  await chooseAnswer(page, 2, 'Неверно');
  await chooseAnswer(page, 14, 'Не знаю');
  await expect(page.getByTestId('assessment-tally-unknown')).toHaveText('Не знаю: 1');
  await answerPage(page, 'Верно');
  await page.getByRole('button', { name: 'Следующие вопросы' }).first().click();
  await expect(page.locator('.assessment-pager__label').first()).toContainText('Вопросы 21–40');
  await chooseAnswer(page, 21, 'Неверно');

  // The draft is saved as it is filled: a reload reopens it on the page of the first gap.
  await page.reload();
  await expect(page.locator('.assessment-pager__label').first()).toContainText('Вопросы 21–40', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('assessment-tally-unknown')).toHaveText('Не знаю: 1');
  await expect(page.locator('.assessment-progress__label')).toContainText('Заполнено 21 из 566');
  await expect(
    page.locator(QUESTIONS).first().locator('.assessment-response-options__option--selected'),
  ).toHaveText(/Неверно/u);

  // The rest of the booklet: «Неверно» everywhere else, then the result.
  for (let guard = 0; guard < 40; guard += 1) {
    await answerPage(page, 'Неверно');
    const next = page.getByRole('button', { name: 'Следующие вопросы' }).first();
    if (await next.isDisabled()) break;
    await next.click();
  }
  await expect(page.locator('.assessment-progress__label')).toContainText('Заполнено 566 из 566');
  await page.getByTestId('assessment-submit').click();

  const table = page.locator('.assessment-result-table__table');
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.locator('.assessment-result-table__row')).toHaveCount(13);
  await expect(page.locator('.schema-chart--profile')).toBeVisible();
  await expect(page.locator('.assessment-result-summary')).toContainText('Профиль СМИЛ');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
