import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/**
 * Settings → «Загрузки» → «Модули из файла». The bundle is a real 15-document SQLite module that
 * `medbase bundle-local-module` wrote (tools/ingest, built from tools/ingest/tests/fixtures/pilot-rf).
 *
 *   E2E_PORT=4191 bunx playwright test module-file-import --workers=1
 */
const BUNDLE = resolve(import.meta.dirname, 'fixtures/e2e-local.minimed-module.zip');
const TITLE = 'E2E модуль из файла';
const DOWNLOADS = `${E2E_ASSET_ORIGIN}/#/settings/downloads`;

test('a module file is rejected when it is not one, installed, kept after a reload and deleted', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(DOWNLOADS);
  const pick = page.getByRole('button', { name: 'Установить модуль из файла' });
  await expect(pick).toBeVisible();
  const input = page.locator('.module-file-import__input');

  await input.setInputFiles({
    name: 'notes.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('this is not an archive at all'),
  });
  await expect(page.getByText('Это не файл модуля MiniMed.')).toBeVisible();
  await expect(page.locator('.module-file-import__item')).toHaveCount(0);

  await input.setInputFiles(BUNDLE);
  await expect(page.getByText(`Установлен «${TITLE}».`)).toBeVisible();
  const row = page.locator('.module-file-import__item').filter({ hasText: TITLE });
  await expect(row).toBeVisible();

  // The same build again is refused, not reinstalled.
  await input.setInputFiles(BUNDLE);
  await expect(page.getByText('Этот модуль уже установлен.')).toBeVisible();

  // It stays in the modules list, marked as coming from a file, and survives a restart.
  await page.reload();
  await page.goto(DOWNLOADS);
  await expect(page.locator('.module-file-import__item').filter({ hasText: TITLE })).toBeVisible();
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/collection/reference`);
  const card = page.locator('.module-card').filter({ hasText: TITLE });
  await expect(card.getByText('Из файла', { exact: true })).toBeVisible();
  await expect(card.getByText('Установлено', { exact: true })).toBeVisible();

  await page.goto(DOWNLOADS);
  await page.getByRole('button', { name: `Удалить «${TITLE}»` }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('.module-file-import__item')).toHaveCount(0);
});
