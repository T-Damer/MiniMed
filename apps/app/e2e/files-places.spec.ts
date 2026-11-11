import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

/**
 * PERF6 (owner 2026-11-11): «Файлы» shows what files are («По виду», one row per kind with a count)
 * and where they are («Мой компьютер») above the folders; a kind opens every file of it from all
 * folders, and back returns to the root.
 */
test('files by kind and «Мой компьютер» above the folders', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();

  await page.getByLabel('Загрузить документы').setInputFiles({
    name: 'выписка.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Выписка для проверки разделов.'),
  });
  const documents = page.getByTestId('user-library-kind-documents');
  await expect(documents).toContainText('Документы');
  await expect(documents).toContainText('1');
  await expect(page.getByRole('heading', { name: 'Папки и файлы' })).toBeVisible();

  await documents.getByRole('button').click();
  await expect(page).toHaveURL(/#\/modules\/documents\/user\?kind=documents$/u);
  await expect(page.locator('.user-library-breadcrumbs')).toContainText('Документы');
  await expect(page.getByText('выписка', { exact: false }).first()).toBeVisible();
  // Kinds are shown only at the root, not inside a kind.
  await expect(page.getByTestId('user-library-kind-documents')).toHaveCount(0);

  await page.getByRole('button', { name: 'Назад к вашим файлам' }).click();
  await expect(page).toHaveURL(/#\/modules\/documents\/user$/u);
  await expect(page.getByTestId('user-library-kind-documents')).toBeVisible();

  await page.locator('.user-library-places__computer').getByRole('button').click();
  await expect(page).toHaveURL(/#\/modules\/documents\/user\?place=computer$/u);
  // Chromium has the folder picker: the doctor is asked to choose a folder once.
  await expect(page.getByTestId('computer-folder')).toContainText('Выбрать папку');
});
