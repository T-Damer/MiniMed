import { expect, test } from '@playwright/test';

function navigationButton(page: import('@playwright/test').Page, name: string) {
  return page
    .getByRole('navigation', { name: 'Разделы приложения' })
    .getByRole('button', { name: new RegExp(`^${name}`, 'u') });
}

test('dev server smoke: search, knowledge base, settings', async ({ page, request }) => {
  let running = false;
  try {
    const health = await request.get('http://127.0.0.1:5173/', { timeout: 1_000 });
    running = health.ok();
  } catch {
    running = false;
  }
  test.skip(!running, 'dev server is not running on 127.0.0.1:5173');

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Что нужно найти?')).toBeVisible({ timeout: 15_000 });

  const searchInput = page.getByTestId('search-input');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('пневмония');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 5_000 });

  await navigationButton(page, 'База знаний').click();
  await expect(page.getByRole('heading', { name: 'База знаний' })).toBeVisible();
  await page.getByRole('tab', { name: 'Скачать наборы' }).click();
  await expect(page.getByText('Ядро MiniMed')).toBeVisible();

  await page.getByRole('tab', { name: 'На устройстве' }).click();
  await page.getByRole('button', { name: /Карта связей/u }).click();
  await expect(page.getByRole('heading', { name: 'Области и документы' })).toBeVisible();
  await expect(page.getByText('clinical-pharmacology')).toHaveCount(0);

  await navigationButton(page, 'Настройки').click();
  await expect(page.getByRole('heading', { name: 'Локальная модель' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подобрать автоматически' })).toBeVisible();
});
