import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, test } from '@playwright/test';
import { openSettingsPage } from './settings-nav';

test.use({ viewport: { width: 390, height: 844 } });

const DARK_BACKGROUND = 'rgb(33, 27, 23)';

async function rootScheme(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
}

async function pageBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
}

async function openAppearance(page: Page): Promise<void> {
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /^Настройки/u })
    .click();
  await openSettingsPage(page, 'Внешний вид');
}

test.describe('theme switch', () => {
  test('a chosen theme beats the device scheme, persists and applies without a reload', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mountBuiltApp(page);
    await openAppearance(page);
    expect(await rootScheme(page)).toBe('light');

    await page.locator('.segmented-control__option', { hasText: 'Тёмная' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => rootScheme(page)).toBe('dark');
    await expect.poll(() => pageBackground(page)).toBe(DARK_BACKGROUND);

    // The choice survives a reload and is applied before the app renders.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('.app-bottom-nav').waitFor();
    expect(await rootScheme(page)).toBe('dark');

    // «Светлая» holds even when the device is dark; «Системная» hands control back.
    await page.emulateMedia({ colorScheme: 'dark' });
    await openAppearance(page);
    await page.locator('.segmented-control__option', { hasText: 'Светлая' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => rootScheme(page)).toBe('light');

    await page.locator('.segmented-control__option', { hasText: 'Системная' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/u);
    await expect.poll(() => rootScheme(page)).toBe('dark');
    await expect(page.getByRole('radio', { name: 'Системная' })).toBeChecked();
  });

  test('the settings list names the chosen theme', async ({ page }) => {
    await mountBuiltApp(page, { localStorage: { 'minimed.theme.v1': 'dark' } });
    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: /^Настройки/u })
      .click();
    await expect(page.getByTestId('settings-status-appearance')).toHaveText('Тёмная');
  });

  test('the active tab keeps a dark glyph on a light bubble in the dark theme of the built app', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mountBuiltApp(page);
    const colours = await page.evaluate(() => {
      const glyph = document.querySelector('.app-bottom-nav .app-nav-button--active');
      const bubble = document.querySelector('.app-bottom-nav__bubble');
      if (!glyph || !bubble) return undefined;
      return {
        glyph: getComputedStyle(glyph).color,
        bubble: getComputedStyle(bubble).backgroundImage,
      };
    });
    // Near-black green glyph; the bubble is the cream gradient, not the dark surface.
    expect(colours?.glyph).toBe('rgb(27, 42, 33)');
    expect(colours?.bubble).toContain('rgb(232, 224, 204)');
  });
});
