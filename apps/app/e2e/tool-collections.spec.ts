import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';
import { openHomeSection } from './select-search-section';

for (const width of [375, 1280]) {
  test(`favourite a tool and open it from a collection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
    await openHomeSection(page, 'Калькуляторы');

    // The «create your own» card comes first in the list and is no tool to star.
    const card = page
      .locator('.unified-catalog__tool-shell')
      .filter({ hasNot: page.locator('.unified-catalog__tool--create') })
      .first();
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

    // Tool collections are put away for now: no folder button on the card.
    await expect(card.getByRole('button', { name: `Коллекции для «${title}»` })).toHaveCount(0);

    // An open section starts at its own list, so there are no capabilities to fold away; the tool
    // row stays while typing.
    await expect(page.locator('.search-heading')).toHaveCount(0);
    await page.getByTestId('search-input').fill('пнев');
    await expect(quickAccess).toBeVisible();
    await page.getByTestId('search-input').fill('');
    await expect(quickAccess).toBeVisible();

    // Open the tool from the favourites in the «Все инструменты» sheet.
    await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Все инструменты' });
    await expect(panel.getByRole('heading', { name: 'Избранное' })).toBeVisible();
    await panel
      .getByRole('region', { name: 'Избранное' })
      .locator('.quick-tool-row__open', { hasText: title })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${(href ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'),
    );
    await page.screenshot({ path: test.info().outputPath('tool-from-collection.png') });
  });
}

// Collections are hidden for now (`TOOL_COLLECTIONS_VISIBLE`); their saved data is kept.
test('favourites saved by an older version survive the update; collections stay hidden', async ({
  page,
}) => {
  const legacy = {
    version: 1,
    favorites: ['minimed.app.patients'],
    collections: [
      {
        id: 'collection-legacy',
        name: 'Приём кардиолога',
        toolIds: ['minimed.app.calculators', 'tool.removed'],
        createdAt: '2026-09-26T07:00:00.000Z',
      },
    ],
  };
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: { 'minimed.tool-collections.v1': JSON.stringify(legacy) },
  });
  const row = page.locator('.search-quick-access');
  await expect(row.getByRole('button', { name: 'Пациенты', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet.locator('.tool-collection-row')).toHaveCount(0);
  // The old entry stays in place, so an older build can still read it.
  expect(await page.evaluate(() => localStorage.getItem('minimed.tool-collections.v1'))).toBe(
    JSON.stringify(legacy),
  );
});
