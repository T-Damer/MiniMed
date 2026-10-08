import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('lets page descriptions use the full page header width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mountBuiltApp(page);
  await page.locator('.app-bottom-nav').getByRole('button', { name: 'Тесты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Тесты и опросники' })).toBeVisible();

  const widths = await page.locator('.page__description').evaluate((element) => {
    const header = element.parentElement;
    if (!header) throw new Error('page description header missing');
    return {
      description: element.getBoundingClientRect().width,
      header: header.getBoundingClientRect().width,
    };
  });

  expect(widths.description).toBeGreaterThanOrEqual(widths.header - 1);
});

test('opens personal questionnaires from the first catalog card', async ({ page }) => {
  await mountBuiltApp(page);
  await page.locator('.app-bottom-nav').getByRole('button', { name: 'Тесты', exact: true }).click();

  const cards = page.locator('.assessment-specialty-grid > .assessment-specialty-card');
  await expect(cards.first()).toContainText('Мои опросники');
  await cards.first().click();
  await expect(page).toHaveURL(/#\/assessments\/mine$/u);
  const heading = page.getByRole('heading', { name: 'Мои опросники' });
  const search = page.getByRole('searchbox', { name: 'Найти опросник' });
  await expect(heading).toBeVisible();
  await expect(search).toBeVisible();
  expect(await search.evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(
    await heading.evaluate((element) => element.getBoundingClientRect().top),
  );
  // Import is a secondary header action (an icon button); creating stays the primary action.
  await expect(page.getByRole('button', { name: 'Импортировать опросник' })).toHaveClass(
    /ui-button--icon/u,
  );
  await expect(page.getByText('2 вопроса', { exact: true })).toBeVisible();
  const create = page
    .locator('.assessment-user-questionnaires__search-chrome')
    .getByRole('button', { name: 'Создать опросник' });
  await expect(create).toHaveClass(/ui-button--primary/u);
  await create.click();
  await expect(page).toHaveURL(/#\/assessments\/mine\/[^/]+\/edit$/u);
});

test('completes a psychology questionnaire and writes the result to a patient note', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await expect(page.locator('.assessment-launch-button')).toHaveCount(0);
  await page.locator('.app-bottom-nav').getByRole('button', { name: 'Тесты', exact: true }).click();
  await expect(page).toHaveURL(/#\/assessments$/u);
  await expect(page.getByRole('heading', { name: 'Тесты и опросники' })).toBeVisible();
  await expect(page.getByText('Психология и психодиагностика').first()).toBeVisible();

  await page.getByTestId('assessment-specialty-psychology').click();
  await expect(page).toHaveURL(/#\/assessments\/psychology$/u);
  await page
    .getByRole('button', { name: 'Открыть раздел «Самооценка и личностный профиль»' })
    .click();
  // Questionnaire packs are explicit downloads; install this one, then wait for its schema.
  const download = page.getByRole('button', { name: 'Скачать «Профиль Бравермана»' });
  const openBraverman = page.getByTestId('assessment-open-braverman-behavioral-profile');
  // Wait for the rendered card before deciding: a persistent origin may already have the pack.
  await expect(download.or(openBraverman).first()).toBeVisible();
  if (await download.isVisible()) await download.click();
  await expect(openBraverman).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByTestId('assessment-open-braverman-behavioral-profile').click();
  await expect(page).toHaveURL(/#\/assessments\/psychology\/braverman-behavioral-profile$/u);
  await expect(
    page.getByRole('heading', { name: 'Тест Бравермана — поведенческий профиль' }),
  ).toBeVisible();

  const middleAnswers = page.locator('.assessment-question input[value="3"]');
  await expect(middleAnswers).toHaveCount(24);
  await middleAnswers.first().evaluate((input: HTMLInputElement) => input.click());
  await expect(page.getByTestId('assessment-next')).toBeVisible();
  expect(
    await page
      .getByTestId('assessment-next')
      .evaluate((button) => button.style.getPropertyValue('--assessment-progress')),
  ).toBe('4.17%');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('button', { name: 'Вернуться наверх' })).toBeVisible();
  const ringCenterOffset = await page.getByTestId('assessment-next').evaluate((button) => {
    const ring = button.querySelector<SVGSVGElement>('.assessment-next-button__ring');
    if (!ring) throw new Error('assessment next-button ring missing');
    const buttonBox = button.getBoundingClientRect();
    const ringBox = ring.getBoundingClientRect();
    return Math.abs(buttonBox.top + buttonBox.height / 2 - (ringBox.top + ringBox.height / 2));
  });
  expect(ringCenterOffset).toBeLessThanOrEqual(1);
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();
  await expect(page.getByTestId('assessment-next')).toHaveCount(0);
  await page.locator('.app-bottom-nav').getByRole('button', { name: 'Тесты', exact: true }).click();
  await expect(page).toHaveURL(/#\/assessments\/psychology\/braverman-behavioral-profile$/u);
  await expect(page.getByTestId('assessment-next')).toBeVisible();
  for (let index = 0; index < 24; index += 1) {
    await middleAnswers.nth(index).evaluate((input: HTMLInputElement) => input.click());
  }

  await expect(page.getByText('Заполнено 24 из 24')).toBeVisible();
  await expect(page.getByTestId('assessment-submit')).toBeEnabled();
  await page.getByTestId('assessment-submit').click();

  await expect(page.locator('.assessment-score-list')).toBeVisible();
  await page.getByTestId('assessment-save-note').click();
  await page.locator('.assessment-note-panel__input').fill('Тестовый пациент');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Результат записан в карточку пациента.')).toBeVisible();

  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Заметки', exact: true })
    .click();

  const card = page.locator('.patient-card').filter({ hasText: 'Тестовый пациент' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.patient-note-record')).toContainText('Тест Бравермана');

  await page.reload();
  await expect(page.locator('.patient-note-record')).toContainText('Тест Бравермана', {
    timeout: 25_000,
  });
});
