import { expect, test } from '@playwright/test';
import {
  installMedicationModule,
  openFirstMedicationCard,
  routeMedicationModule,
} from './medication-module-fixture';
import { mountBuiltApp } from './mount-built-app';

for (const width of [375, 1280]) {
  test(`a medication card is saved to a new collection and remembered at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 844 });
    await routeMedicationModule(page);
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await installMedicationModule(page);
    const title = await openFirstMedicationCard(page);

    const bookmark = page.getByRole('button', { name: `Сохранить «${title}»` });
    await bookmark.click();
    const panel = page.getByRole('dialog', { name: `Сохранить: ${title}` });
    await expect(panel.getByText('Сохранить в')).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /Избранные/u })).not.toBeChecked();
    await panel.getByPlaceholder(/Новая коллекция/u).fill('Противопаразитарные');
    await panel.getByRole('button', { name: 'Создать коллекцию' }).click();
    await expect(panel.getByRole('checkbox', { name: /Противопаразитарные/u })).toBeChecked();
    await page.keyboard.press('Escape');

    // The saved card is stored by its stable document id, not its place in the catalog.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('minimed.collections.v2') ?? '{}'),
    );
    const collection = stored.collections.find(
      (entry: { name: string }) => entry.name === 'Противопаразитарные',
    );
    expect(collection.items).toEqual([
      expect.objectContaining({
        kind: 'document',
        id: expect.stringMatching(/^esklp\./u),
        // Stored as the source registers it; the card shows the same name case-normalised.
        title: expect.stringMatching(
          new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'iu'),
        ),
        documentKind: 'medication',
      }),
    ]);

    // After a reload the same card opens by its id, without the catalog's product context, so
    // the title may be the document's own short title; the saved state is what matters.
    await page.reload();
    const firstWord = title.split(/\s/u)[0] ?? title;
    const saved = page.getByRole('button', { name: new RegExp(`^Сохранено: «${firstWord}`, 'iu') });
    await expect(saved).toBeVisible({ timeout: 30_000 });
    await saved.click();
    const reopened = page.getByRole('dialog', {
      name: new RegExp(`^Сохранить: ${firstWord}`, 'iu'),
    });
    const remembered = reopened.locator('.tool-collection-menu__option').nth(1);
    await expect(remembered).toContainText('Противопаразитарные');
    await expect(remembered).toContainText('в прошлый раз');
  });
}
