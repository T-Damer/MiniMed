import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { setClinicalAnalysis } from './select-search-section';

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
    // The tool row above has arrows of its own since a first run pins tools: scope to the examples.
    const next = row.locator('.horizontal-scroll-control.next');
    const previous = row.locator('.horizontal-scroll-control.previous');
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

test('clinical analysis shows one line above the results, explains itself behind «?» and in the field', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const field = page.getByTestId('search-input');
  await expect(page.getByRole('complementary', { name: 'О клиническом разборе' })).toHaveCount(0);
  // The analysis waits for the medical core; until then a tap only shows a notice.
  await setClinicalAnalysis(page, true);
  const note = page.getByRole('complementary', { name: 'О клиническом разборе' });
  await expect(note).toBeVisible();
  // The explanation is not body copy: it opens from the «?» button.
  await expect(note).not.toContainText('исходные документы');
  await note.getByRole('button', { name: 'О клиническом разборе' }).click();
  await expect(page.getByText('исходные документы')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(field).toHaveAttribute('placeholder', /Опишите случай: жалобы/u);
  await page.getByRole('button', { name: 'Клинический разбор' }).click();
  await expect(note).toHaveCount(0);
});

test('the carousel closes with an icon, says where to undo it, and Settings brings it back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const carousel = page.getByRole('region', { name: 'Полезные функции' });
  await expect(carousel).toBeVisible();
  // An icon beside the arrows and dots, not a text button.
  const hide = page.getByRole('button', { name: 'Скрыть полезные функции' });
  await expect(hide).toHaveText('');
  await expect(hide.locator('svg')).toBeVisible();
  await hide.click();
  await expect(carousel).toHaveCount(0);
  await expect(page.getByText('Вернуть можно в настройках')).toBeVisible();
  // The choice is a stored preference, not component state.
  const hiddenPreference = (): Promise<boolean | undefined> =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('minimed.app-preferences.v1') ?? '{}').usefulFeaturesHidden,
    );
  expect(await hiddenPreference()).toBe(true);
  // No way back at the bottom of the home any more: Settings is the one place.
  await expect(page.getByRole('button', { name: 'Показать полезные функции' })).toHaveCount(0);
  // The notice's action opens the settings page that holds the switch.
  await page.locator('.app-notification__action', { hasText: 'Настройки' }).click();
  await expect(page).toHaveURL(/#\/settings\/appearance$/u);
  const toggle = page.getByRole('switch', { name: 'Полезные функции на главной' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await hiddenPreference()).toBe(false);
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Полезные функции' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Показать полезные функции' })).toHaveCount(0);
});
