import { expect, test } from '@playwright/test';

const ORIGIN = process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`Settings → Загрузки offers whole sections with their contents at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    });
    await page.goto(`${ORIGIN}/#/settings/downloads`, { waitUntil: 'domcontentloaded' });

    const list = page.getByTestId('section-downloads');
    const items = list.locator('.section-downloads__item');
    await expect(items.first()).toBeVisible({ timeout: 60_000 });
    expect(await items.count()).toBeGreaterThan(15);
    const start = list.getByRole('button', { name: /Выберите раздел/u });
    await expect(start).toBeDisabled();

    // «Психиатрия и наркология»: counts with Russian plural forms, drug groups and a size.
    const psychiatry = items.filter({ hasText: 'Психиатрия и наркология' });
    await expect(psychiatry.locator('.section-downloads__summary')).toContainText(
      /\d+ клинических рекомендаций · препараты: \d+ групп/u,
    );
    await expect(psychiatry.locator('.section-downloads__summary')).toContainText(/МБ|ГБ/u);

    // The contents are shown before anything is downloaded; forms are announced without a count.
    await psychiatry.getByRole('button', { name: /Состав раздела/u }).click();
    await expect(psychiatry).toContainText('Клинические рекомендации');
    await expect(psychiatry).toContainText('Нервная система');
    await expect(psychiatry).toContainText('Скоро: формы документов по специальности.');

    // Ticking the section sizes the download; switching a drug group off shrinks it.
    await psychiatry.locator('.section-downloads__select .section-downloads__check').check();
    const total = list.locator('.section-downloads__start');
    await expect(total).toContainText(/Скачать выбранное · [\d,]+ (МБ|ГБ)/u);
    const withDrugs = (await total.textContent()) ?? '';
    await psychiatry
      .locator('.section-downloads__group')
      .first()
      .locator('.section-downloads__check')
      .uncheck();
    await expect(total).not.toHaveText(withDrugs);
    await expect(psychiatry.locator('.section-downloads__summary').first()).toContainText(
      /препараты: \d+ групп/u,
    );
  });
}

test('the tour offers the same section list and its step needs no network to render', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/core.db', () => new Promise(() => {}));
  await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (let press = 0; press < 6; press += 1) await page.keyboard.press('ArrowRight');
  const card = page.locator('.onboarding-hint');
  await expect(card.getByRole('heading', { name: 'Скачать по специальности' })).toBeVisible();
  await expect(card.locator('.section-downloads__item').first()).toBeVisible({ timeout: 60_000 });
});
