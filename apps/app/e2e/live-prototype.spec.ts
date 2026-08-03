import { expect, test } from '@playwright/test';

const LIVE_URL = process.env.MINIMED_LIVE_URL ?? 'https://t-damer.github.io/MiniMed/app/';

test.describe('published MiniMed prototype', () => {
  test.setTimeout(90_000);

  test('exposes questionnaires and calculators on GitHub Pages', async ({ page }) => {
    await page.goto(LIVE_URL, { waitUntil: 'networkidle', timeout: 60_000 });

    const assessments = page.getByRole('button', { name: 'Открыть тесты и опросники' });
    await expect(assessments).toBeVisible({ timeout: 30_000 });
    await assessments.click();
    await expect(page.getByRole('heading', { name: 'Тесты и опросники' })).toBeVisible();
    await expect(page.getByText('Психология и психодиагностика').first()).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть тесты' }).click();

    const calculators = page.getByRole('button', { name: 'Открыть медицинские калькуляторы' });
    await expect(calculators).toBeVisible();
    await calculators.click();
    await expect(page.getByRole('heading', { name: 'Медицинские калькуляторы' })).toBeVisible();

    await page.getByTestId('calculator-open-body-surface-area-mosteller').click();
    await page.getByLabel('Рост, см').fill('170');
    await page.getByLabel('Масса, кг').fill('70');
    await page.getByTestId('calculator-submit').click();

    await expect(page.getByTestId('calculator-result')).toContainText('1,82 м²');
  });
});
