import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

for (const width of [375, 1280]) {
  test(`«Мои файлы» offers «База знаний» only without its own tab, pinned folders marked, at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();

    const knowledge = page.getByRole('button', { name: 'Открыть папку «База знаний»' });
    await expect(knowledge).toBeVisible();
    // System entries carry a pin; a folder the user creates does not.
    const pinned = (name: string) =>
      page
        .getByRole('button', { name: `Открыть папку «${name}»` })
        .locator('.user-library-folder-card__pin');
    await expect(pinned('База знаний')).toBeVisible();
    await expect(pinned('Пациенты')).toBeVisible();
    await page.getByRole('button', { name: 'Действия со страницей' }).click();
    await page.getByRole('menuitem', { name: 'Создать папку', exact: true }).click();
    await page.getByLabel('Название новой папки').fill('Разборы');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Открыть папку «Разборы»' })).toBeVisible();
    await expect(pinned('Разборы')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`my-files-${width}.png`) });

    await knowledge.click();
    await expect(page).toHaveURL(/#\/modules\/documents$/u);
    await expect(page.getByRole('heading', { name: 'База знаний', level: 1 })).toBeVisible();
  });

  test(`with separate tabs the knowledge base keeps its tab and no folder at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForSearchEditable(page);
    await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
    await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть папку «Пациенты»' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть папку «База знаний»' })).toHaveCount(0);
  });
}
