import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

// The doctors' diaries app lists the built-in scales a diary can carry (PHQ-9, GAD-7, the
// psychological profiles, ...). Each opens at once and offline: no «Скачать» offer, no module
// download, and the profile does not even try the search core or the content packs.

test.use({ viewport: { width: 390, height: 844 } });

/** Blocks every request for content (core, packs, modules, release assets) and records it. */
async function blockContent(page: Page): Promise<string[]> {
  const attempts: string[] = [];
  const block = (url: URL): boolean => {
    const path = url.pathname;
    const isContent =
      url.origin === E2E_ASSET_ORIGIN
        ? /\/content\//u.test(path)
        : /github|githubusercontent|gitverse/u.test(url.hostname);
    if (isContent) attempts.push(url.href);
    return isContent;
  };
  await page.route('**/*', (route) => {
    if (block(new URL(route.request().url()))) return route.abort();
    return route.continue();
  });
  return attempts;
}

/** Evidence for a review: `E2E_SHOTS=<dir>` saves the pages as PNG. */
async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_SHOTS'];
  // Let the page's own fade-in finish before the picture.
  if (directory) await page.waitForTimeout(700);
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

async function openDiariesQuestionnaires(page: Page): Promise<string[]> {
  const attempts = await blockContent(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/assessments/mine`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByText('Готовые опросники')).toBeVisible();
  return attempts;
}

test('a built-in scale of the diaries profile is run to its result without a download', async ({
  page,
}) => {
  const attempts = await openDiariesQuestionnaires(page);
  await page.getByRole('button', { name: /Открыть «.*PHQ-9/u }).click();
  await expect(page).toHaveURL(/#\/assessments\/psychiatry\/phq-9$/u);
  await expect(page.getByText('Заполнено 0 из 10')).toBeVisible();
  await expect(page.getByText(/Скачать|ещё не установлен/u)).toHaveCount(0);
  await shot(page, 'phq-9-info');

  // The first option of each of the ten questions.
  const answers = page.locator('.assessment-question input[value="1"]');
  await expect(answers).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    await answers.nth(index).evaluate((input: HTMLInputElement) => input.click());
  }
  await expect(page.getByText('Заполнено 10 из 10')).toBeVisible();
  await page.getByTestId('assessment-submit').click();
  await expect(page).toHaveURL(/#\/assessments\/psychiatry\/phq-9\/results\/[^/]+$/u);
  await expect(page.getByRole('heading', { name: 'Лёгкие симптомы депрессии' })).toBeVisible();
  await expect(page.getByRole('figure', { name: '9 — Лёгкие' })).toBeVisible();
  await expect(page.getByText(/Скачать|ещё не установлен/u)).toHaveCount(0);
  await shot(page, 'phq-9-result');
  expect(attempts).toEqual([]);
});

test('a psychological profile of the diaries profile opens and runs offline', async ({ page }) => {
  const attempts = await openDiariesQuestionnaires(page);
  await page.getByRole('button', { name: 'Открыть «Тест на темперамент»' }).click();
  await expect(page).toHaveURL(/#\/assessments\/psychology\/temperament-profile$/u);
  await expect(page.getByText(/Заполнено 0 из \d+/u)).toBeVisible();
  await expect(page.getByText(/Скачать|ещё не установлен/u)).toHaveCount(0);
  await shot(page, 'temperament-info');

  const answers = page.locator('.assessment-question input[value="3"]');
  const count = await answers.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await answers.nth(index).evaluate((input: HTMLInputElement) => input.click());
  }
  await page.getByTestId('assessment-submit').click();
  await expect(page).toHaveURL(/#\/assessments\/psychology\/temperament-profile\/results\/[^/]+$/u);
  await expect(page.locator('.assessment-score-list')).toBeVisible();
  await shot(page, 'temperament-result');
  expect(attempts).toEqual([]);
});

test('every built-in scale page opens with the content blocked', async ({ page }) => {
  const attempts = await openDiariesQuestionnaires(page);
  const opens = page.locator('.assessment-user-questionnaire__open');
  const total = await opens.count();
  expect(total).toBeGreaterThanOrEqual(12);
  for (let index = 0; index < total; index += 1) {
    await opens.nth(index).click();
    await expect(page.getByTestId('assessment-submit')).toBeVisible();
    await expect(page.getByText(/Скачать|ещё не установлен/u)).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText('Готовые опросники')).toBeVisible();
  }
  expect(attempts).toEqual([]);
});
