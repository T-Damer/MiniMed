import { expect, test } from '@playwright/test';

const LIVE_URL = process.env.MINIMED_LIVE_URL;

test.describe('published MiniMed prototype', () => {
  test.skip(!LIVE_URL, 'Live Pages smoke test requires MINIMED_LIVE_URL.');
  test.setTimeout(90_000);

  test('exposes questionnaires and calculators on GitHub Pages', async ({ page }) => {
    await page.goto(LIVE_URL as string, { waitUntil: 'networkidle', timeout: 60_000 });

    const nav = page.locator('.app-bottom-nav');
    await expect(nav.getByRole('button', { name: 'Тесты', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await nav.getByRole('button', { name: 'Тесты', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Тесты и опросники' })).toBeVisible();
    await expect(page.getByText('Психология и психодиагностика').first()).toBeVisible();

    await nav.getByRole('button', { name: 'Калькуляторы', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Калькуляторы' })).toBeVisible();

    await page.getByRole('button', { name: 'Открыть раздел «Антропометрия»' }).click();
    const anthropometryDownload = page.getByRole('button', {
      name: 'Скачать раздел «Антропометрия»',
    });
    if (await anthropometryDownload.count()) {
      await anthropometryDownload.click();
    }
    await page.getByTestId('calculator-open-body-surface-area-mosteller').click();
    await page.getByLabel('Рост, см').fill('170');
    await page.getByLabel('Масса, кг').fill('70');
    await page.getByTestId('calculator-submit').click();

    await expect(page.getByTestId('calculator-result')).toContainText('1,82 м²');
  });
});
