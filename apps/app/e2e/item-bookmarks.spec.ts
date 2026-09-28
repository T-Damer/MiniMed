import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

for (const width of [375, 1280]) {
  test(`a medication card is saved to a new collection and remembered at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
    await page
      .locator('.medication-product-card')
      .filter({ hasText: 'Ибупрофен 100 мг/5 мл' })
      .first()
      .click({ timeout: 30_000 });

    const bookmark = page.getByRole('button', { name: 'Сохранить «Ибупрофен 100 мг/5 мл»' });
    await bookmark.click();
    const panel = page.getByRole('dialog', { name: 'Сохранить: Ибупрофен 100 мг/5 мл' });
    await expect(panel.getByText('Сохранить в')).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /Избранные/u })).not.toBeChecked();
    await panel.getByPlaceholder(/Новая коллекция/u).fill('Жаропонижающие');
    await panel.getByRole('button', { name: 'Создать коллекцию' }).click();
    await expect(panel.getByRole('checkbox', { name: /Жаропонижающие/u })).toBeChecked();
    await page.keyboard.press('Escape');

    // The saved card is stored by its stable document id, not its place in the catalog.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('minimed.collections.v2') ?? '{}'),
    );
    const collection = stored.collections.find(
      (entry: { name: string }) => entry.name === 'Жаропонижающие',
    );
    expect(collection.items).toEqual([
      expect.objectContaining({
        kind: 'document',
        id: expect.stringMatching(/^drug\./u),
        title: 'Ибупрофен 100 мг/5 мл',
        documentKind: 'medication',
      }),
    ]);

    // After a reload the same card opens by its id, without the catalog's product context, so
    // the title may be the document's own short title; the saved state is what matters.
    await page.reload();
    const saved = page.getByRole('button', { name: /^Сохранено: «Ибупрофен/u });
    await expect(saved).toBeVisible({ timeout: 30_000 });
    await saved.click();
    const reopened = page.getByRole('dialog', { name: /^Сохранить: Ибупрофен/u });
    const remembered = reopened.locator('.tool-collection-menu__option').nth(1);
    await expect(remembered).toContainText('Жаропонижающие');
    await expect(remembered).toContainText('в прошлый раз');
  });
}
