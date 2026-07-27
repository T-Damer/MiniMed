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
  await page.waitForTimeout(500);
  test.skip(
    (await page.getByText('Что вы хотите найти?').count()) === 0,
    'Port 5173 belongs to another local process.',
  );
  await expect(page.getByText('Что вы хотите найти?')).toBeVisible();

  await page.getByRole('radio', { name: /В клин\. рекомендациях/u }).click();
  const searchInput = page.getByTestId('search-input');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('пневмония');
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 5_000 });

  await navigationButton(page, 'База знаний').click();
  await expect(page.getByRole('heading', { name: 'База знаний и модель' })).toBeVisible();
  await page.getByRole('button', { name: /^Документы/u }).click();
  await page.getByRole('button', { name: /Всегда доступно/u }).click();
  await expect(page.getByText('Ядро MiniMed')).toBeVisible();

  await page.getByRole('button', { name: '← Обзор' }).click();
  await page.getByRole('button', { name: /^Локальная модель/u }).click();
  await expect(page.getByRole('heading', { name: 'Модель', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить устройство' })).toBeVisible();
});
