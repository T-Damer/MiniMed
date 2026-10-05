import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

test('an item without actions opens no context menu and shows no «⋯» button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();

  // «База знаний» is a system entry folder: it has no actions at all.
  const entry = page.getByRole('button', { name: 'Открыть папку «База знаний»' });
  const entryMenu = page.locator('.user-library-folder-menu').filter({ has: entry });
  await expect(entryMenu.getByRole('button', { name: 'Действия с папкой' })).toHaveCount(0);
  await entry.click({ button: 'right' });
  // Never an empty block: the entry has no menu of its own, so the page's own menu answers.
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // A folder the user creates still has its menu, from right click and from «⋯».
  await page.getByRole('button', { name: 'Действия со страницей' }).click();
  await page.getByRole('menuitem', { name: 'Создать папку', exact: true }).click();
  await page.getByLabel('Название новой папки').fill('Разборы');
  await page.keyboard.press('Enter');
  const own = page.getByRole('button', { name: 'Открыть папку «Разборы»' });
  await expect(own).toBeVisible();
  const ownMenu = page.locator('.user-library-folder-menu').filter({ has: own });
  await expect(ownMenu.getByRole('button', { name: 'Действия с папкой' })).toHaveCount(1);
  await own.click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeVisible();
});
