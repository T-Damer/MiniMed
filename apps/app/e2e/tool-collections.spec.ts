import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';
import { openHomeSection } from './select-search-section';

for (const width of [375, 1280]) {
  test(`favourite a tool and open it from a collection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
    await openHomeSection(page, 'Калькуляторы');

    const card = page.locator('.unified-catalog__tool-shell').first();
    await expect(card).toBeVisible();
    const title = (await card.locator('.catalog-card__title').textContent())?.trim() ?? '';
    const href = await card.locator('.unified-catalog__tool').getAttribute('href');
    expect(title).not.toBe('');

    // Star from the catalog card: the tool appears as a chip in the tool row.
    await card.getByRole('button', { name: `Добавить «${title}» в избранное` }).click();
    await expect(
      card.getByRole('button', { name: `Убрать «${title}» из избранного` }),
    ).toHaveAttribute('aria-pressed', 'true');
    const quickAccess = page.locator('.search-quick-access');
    await expect(quickAccess.getByRole('button', { name: title })).toBeVisible();

    // Put the same tool into a new collection from the card.
    await card.getByRole('button', { name: `Коллекции для «${title}»` }).click();
    const collectionMenu = page.getByRole('dialog', { name: `Коллекции: ${title}` });
    await collectionMenu.getByPlaceholder(/Новая коллекция/u).fill('Приём кардиолога');
    await collectionMenu.getByRole('button', { name: 'Создать коллекцию' }).click();
    await expect(collectionMenu.getByRole('checkbox', { name: /Приём кардиолога/u })).toBeChecked();
    await page.keyboard.press('Escape');

    // The tool row folds away with the rest of the empty-field content while typing.
    await page.getByTestId('search-input').fill('пнев');
    await expect(page.locator('.search-welcome')).toHaveClass(/search-welcome--hidden/u);
    await page.getByTestId('search-input').fill('');
    await expect(quickAccess).toBeVisible();

    // Open the tool from the collection in the «Все инструменты» sheet.
    await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Все инструменты' });
    await expect(panel.getByRole('heading', { name: 'Избранное' })).toBeVisible();
    await panel.locator('.tool-collection-row__toggle', { hasText: 'Приём кардиолога' }).click();
    await panel
      .locator('.tool-collection-row__tools .quick-tool-row__open', { hasText: title })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${(href ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'),
    );
    await page.screenshot({ path: test.info().outputPath('tool-from-collection.png') });
  });
}
