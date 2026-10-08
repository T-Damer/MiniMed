import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';
import { openSettingsPage } from './settings-nav';

for (const width of [375, 1280]) {
  test(`the draft dictionary follows the experimental setting at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    const allTools = page.getByRole('button', { name: 'Все инструменты', exact: true });
    const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
    const dictionary = sheet.locator('.quick-tool-row__open', { hasText: 'Словарь терминов' });

    // Experimental modules are on by default: the entry opens the draft reference.
    await allTools.click();
    await expect(dictionary).toBeEnabled({ timeout: 60_000 });
    await dictionary.click();
    const dialog = page.getByRole('dialog', { name: 'Словарь терминов' });
    // Not installed: the download is offered right in the dialog, without explanations.
    await expect(
      dialog.locator('[data-module-id="minimed.definition.reference.ru"]'),
    ).toContainText('Словарь терминов, симптомов и синдромов');
    await expect(dialog).not.toContainText('Черновая редакция, не проверено');
    await page.screenshot({ path: test.info().outputPath('experimental-reference.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Turning experimental modules off hides every entry point without a reload.
    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: /^Настройки/u })
      .click();
    await openSettingsPage(page, 'Изображения');
    const experimental = page.getByRole('switch', { name: 'Предварительные материалы' });
    await expect(experimental).toHaveAttribute('aria-checked', 'true');
    await experimental.click();
    await expect(experimental).toHaveAttribute('aria-checked', 'false');
    await page
      .locator('.app-bottom-nav')
      .getByRole('button', { name: 'Поиск', exact: true })
      .click();
    await allTools.click();
    // «Справочное» keeps the vaccination calendar, which is not experimental; the dictionary goes.
    await expect(sheet.getByRole('heading', { name: 'Приём' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Справочное' })).toBeVisible();
    await expect(sheet.getByText('Календарь прививок', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Словарь терминов', { exact: true })).toHaveCount(0);
  });
}
