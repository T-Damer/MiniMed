import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

async function openHomeSection(page: Page, name: string): Promise<void> {
  const row = page.locator('.search-sections__row', { hasText: name }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
}

for (const width of [390, 1280]) {
  test(`example arrows sit on the chips row and are fully visible at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const row = page.locator('.example-row');
    await row.scrollIntoViewIfNeeded();
    const chips = page.locator('.example-scroll-content__chip');
    // Scroll the chips so both arrows show.
    await chips.nth(1).hover();
    await chips.nth(2).scrollIntoViewIfNeeded();
    // The row scrolls smoothly; an arrow counted mid-scroll can vanish when the end is reached, so
    // wait until the scroll position stops changing before reading the arrows.
    const viewport = page.locator('.example-scroll__viewport [data-overlayscrollbars-viewport]');
    let lastLeft = -1;
    await expect
      .poll(async () => {
        const left = await viewport.evaluate((element) => element.scrollLeft).catch(() => 0);
        const settled = left === lastLeft;
        lastLeft = left;
        return settled;
      })
      .toBe(true);
    const next = page.locator('.horizontal-scroll-control.next');
    const previous = page.locator('.horizontal-scroll-control.previous');
    // Wide screens fit every chip, so there is nothing to scroll and no arrow to measure.
    if ((await next.or(previous).count()) === 0) {
      await row.screenshot({ path: testInfo.outputPath(`examples-${width}.png`) });
      return;
    }
    await expect(next.or(previous).first()).toBeVisible();

    const chip = await chips.first().boundingBox();
    if (!chip) throw new Error('No chip');
    const chipCentre = chip.y + chip.height / 2;
    for (const arrow of [next, previous]) {
      if ((await arrow.count()) === 0) continue;
      const box = await arrow.boundingBox();
      if (!box) throw new Error('No arrow box');
      expect(Math.abs(box.y + box.height / 2 - chipCentre)).toBeLessThanOrEqual(2);
      // Not clipped: every corner of the arrow hits the arrow (or its icon), not a clipping parent.
      const hits = await arrow.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [
          [rect.left + 1, rect.top + 1],
          [rect.right - 1, rect.top + 1],
          [rect.left + 1, rect.bottom - 1],
          [rect.right - 1, rect.bottom - 1],
        ].map(([x, y]) => element.contains(document.elementFromPoint(x ?? 0, y ?? 0)));
      });
      expect(hits).toEqual([true, true, true, true]);
    }
    await row.screenshot({ path: testInfo.outputPath(`examples-${width}.png`) });
  });
}

test('an open section is a page of its own: history entry, back arrow, mounted list, scroll kept', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    document.querySelector('.search-home')?.setAttribute('data-test-marker', 'mounted');
  });
  const row = page.locator('.search-sections__row', { hasText: 'Клинические рекомендации' });
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 100));
  const listScroll = await page.evaluate(() => window.scrollY);
  expect(listScroll).toBeGreaterThan(50);

  // Playwright may nudge the row into view first: take the scroll at the moment of the click.
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      () => ((window as { __listScroll?: number }).__listScroll = window.scrollY),
      {
        capture: true,
        once: true,
      },
    );
  });
  await row.click();
  const clickScroll = await page.evaluate(
    () => (window as { __listScroll?: number }).__listScroll ?? -1,
  );
  expect(clickScroll).toBeGreaterThan(50);
  await expect(page).toHaveURL(/#\/search\/section\/guidelines$/u);
  await expect(page.getByRole('button', { name: 'Назад к разделам' })).toBeVisible();
  await expect(page.locator('.search-section-page')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The browser's and Android's back return to the list at the same scroll, without a rebuild.
  await page.goBack();
  await expect(page).not.toHaveURL(/#\/search\/section/u);
  await expect(page.locator('.search-sections__row').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(clickScroll - 3);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(clickScroll + 3);
  await expect(page.locator('.search-home[data-test-marker="mounted"]')).toHaveCount(1);

  // The back arrow does the same and leaves no section address behind.
  await row.click();
  await page.getByRole('button', { name: 'Назад к разделам' }).click();
  await expect(page).not.toHaveURL(/#\/search\/section/u);
  await expect(page.locator('.search-sections__row').first()).toBeVisible();

  // A section address opens that section directly.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search/section/guidelines`);
  await expect(page.getByRole('button', { name: 'Назад к разделам' })).toBeVisible();
});

test('clinical analysis explains itself above the results and in the field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const field = page.getByTestId('search-input');
  await expect(page.getByRole('complementary', { name: 'О клиническом разборе' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Клинический разбор' }).click();
  const note = page.getByRole('complementary', { name: 'О клиническом разборе' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('источники, а не диагноз');
  await expect(field).toHaveAttribute('placeholder', /Опишите случай: жалобы/u);
  await page.getByRole('button', { name: 'Клинический разбор' }).click();
  await expect(note).toHaveCount(0);
});

test('«Скрыть» closes the useful-features block and a quiet link brings it back', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await expect(page.getByRole('region', { name: 'Полезные функции' })).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть полезные функции' }).click();
  await expect(page.getByRole('region', { name: 'Полезные функции' })).toHaveCount(0);
  // The choice is a stored preference, not component state.
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('minimed.app-preferences.v1') ?? '{}').usefulFeaturesHidden,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Показать полезные функции' }).click();
  await expect(page.getByRole('region', { name: 'Полезные функции' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Показать полезные функции' })).toHaveCount(0);
});

test('a stored «hidden» preference starts the home without the block', async ({ page }) => {
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({
        splitNavigation: true,
        usefulFeaturesHidden: true,
      }),
    },
  });
  await expect(page.getByRole('region', { name: 'Полезные функции' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Показать полезные функции' })).toBeVisible();
});
