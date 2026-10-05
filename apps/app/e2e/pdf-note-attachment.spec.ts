import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';
import { syntheticPdf } from './synthetic-pdf';

function navigationButton(page: Page, name: string) {
  return page.locator('.app-bottom-nav').getByRole('button', { name, exact: true });
}

test('a PDF attached to a note opens in the shared viewer with find, thumbnails and system open', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 800 });
  await mountBuiltApp(page, { persistentOrigin: true });
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0, { timeout: 90_000 });
  await navigationButton(page, 'Заметки').click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Обычная заметка', exact: true }).press('Enter');
  await page.getByLabel('Название заметки').fill('Заключение консультанта');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page).toHaveURL(/\/records\/new(?:\?|$)/u);

  await page.getByLabel('Добавить вложения').setInputFiles({
    name: 'consult.pdf',
    mimeType: 'application/pdf',
    buffer: syntheticPdf({ pages: 21 }),
  });
  await page.getByRole('button', { name: 'Открыть «consult.pdf»' }).click();

  const dialog = page.getByRole('dialog', { name: 'consult.pdf' });
  await expect(dialog.locator('.pdf-viewer__page')).toHaveCount(21);
  await expect(dialog.locator('.pdf-viewer__canvas').first()).toBeVisible();
  // The dialog scrolls inside its own panel, not the page behind it.
  await expect(dialog.locator('.pdf-viewer__main')).toHaveCSS('overflow-y', 'auto');

  // Find: "adults was reviewed" is on pages 7, 14 and 21.
  await dialog.getByRole('button', { name: 'Поиск в документе' }).click();
  await dialog.getByRole('searchbox', { name: 'Поиск в документе' }).fill('adults was reviewed');
  await expect(dialog.locator('.document-find__count')).toHaveText('1/3');
  await expect(dialog.getByRole('textbox', { name: 'Номер страницы' })).toHaveValue('7');
  await dialog.getByRole('button', { name: 'Следующее совпадение' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Номер страницы' })).toHaveValue('14');
  await dialog.getByRole('button', { name: 'Закрыть поиск' }).click();

  // Thumbnails rail next to the pages.
  await dialog.getByRole('button', { name: 'Миниатюры страниц' }).click();
  await expect(dialog.locator('.pdf-thumbnails__item')).toHaveCount(21);
  await dialog.getByRole('button', { name: 'Страница 3', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Номер страницы' })).toHaveValue('3');

  // «Открыть в системе» opens the browser's own PDF tab (the system share sheet on a phone).
  const popup = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Открыть в системе' }).click();
  // The headless browser has no PDF plug-in, so the new tab starts a download; the tab itself
  // opening (and no «не удалось» notice) is what the app controls.
  await popup;
  await expect(page.getByText('Не удалось открыть файл в системе.')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Закрыть просмотр' }).last().click();
  await expect(dialog).toHaveCount(0);
});
