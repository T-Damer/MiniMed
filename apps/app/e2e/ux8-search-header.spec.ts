import {
  E2E_ASSET_ORIGIN,
  mountBuiltApp,
  waitForSearchReady,
} from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, test } from '@playwright/test';

/** UX8: the search header, the core status line and the compact source-card download button. */

async function announceUpdate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const worker = { scriptURL: `${window.location.origin}/sw.js?v=9.9.9`, postMessage: () => {} };
    window.dispatchEvent(new CustomEvent('minimed:app-update-ready', { detail: { worker } }));
  });
}

for (const width of [360, 390, 1280]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the search header keeps every button inside the row at ${width}px, ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme });
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      await waitForSearchReady(page);
      // A waiting update is a dot on «Настройки»: nothing floats beside or above the bar.
      await announceUpdate(page);
      await expect(page.locator('.app-nav-badge--app-update')).toBeVisible();

      const geometry = await page.evaluate(() => {
        const row = document.querySelector('.search-mode-tools');
        if (!row) throw new Error('The header row is missing.');
        const rowBox = row.getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          row: { left: rowBox.left, right: rowBox.right },
          items: [...row.children].map((child) => {
            const box = child.getBoundingClientRect();
            return { name: child.className, left: box.left, right: box.right };
          }),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      expect(geometry.overflow).toBe(false);
      const help = geometry.items.find((item) => item.name.includes('search-mode-help'));
      expect(help).toBeDefined();
      for (const item of geometry.items) {
        expect(item.left, item.name).toBeGreaterThanOrEqual(0);
        expect(item.right, item.name).toBeLessThanOrEqual(geometry.viewport);
        expect(item.right, item.name).toBeLessThanOrEqual(geometry.row.right + 0.5);
      }
      // Only the history button and «?» are in the row, beside the band's bar and the middle slot
      // («MiniMed» at rest, the field's pill once scrolled).
      await expect(
        page.locator('.search-mode-tools > :not(.search-mode-tools__bar, .search-home__slot)'),
      ).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Случайная запись' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Карта связей' })).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`header-${width}-${colorScheme}.png`),
        clip: { x: 0, y: 0, width, height: 260 },
      });
    });
  }
}

test('the random record and the relation map are rows of the «?» menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchReady(page);
  await page.getByRole('button', { name: 'Справка', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Справка' });
  await expect(menu.getByRole('button', { name: 'Что умеет MiniMed' })).toBeVisible();
  const graph = menu.getByRole('button', { name: /^Карта связей/u });
  await expect(menu.getByRole('button', { name: /^Случайная запись/u })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(graph).toBeEnabled();
  await graph.click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Карта связей' })).toBeVisible();
  await expect(page.locator('.knowledge-graph-canvas')).toBeVisible();
});

test('the first run shows no status line while the download waits for the greeting', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let downloads = 0;
  await page.route('**/core.db', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    downloads += 1;
    return new Promise(() => {});
  });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Привет', { exact: true })).toBeVisible({ timeout: 30_000 });
  // Past the delay after which an ordinary open would show its note.
  await page.waitForTimeout(2_500);
  expect(downloads).toBe(0);
  await expect(page.locator('.search-home .search-core-status')).toHaveCount(0);
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0);
  // Since UX9 (0.6.54) the field takes a query while the core is on its way: its usual prompt stays.
  await expect(page.getByTestId('search-input')).toHaveAttribute(
    'placeholder',
    'Болезнь, код МКБ, препарат, фраза',
  );
  // Past the greeting nothing downloads until the user chooses (DL1); once they pick the base, the
  // download is real and the status follows it.
  const intro = page.getByRole('dialog', { name: 'Добро пожаловать в MiniMed' });
  const next = intro.getByRole('button', { name: 'Далее', exact: true });
  await next.click();
  await next.click();
  await expect(intro.getByText('Что скачать сейчас?')).toBeVisible();
  expect(downloads).toBe(0);
  await intro.getByTestId('core-choice-core').click();
  await expect.poll(() => downloads).toBe(1);
  await expect(page.locator('.search-home .search-core-status')).toContainText('Загружаем базу');
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0);
});

for (const width of [360, 390, 1280]) {
  test(`the source card puts a download icon in its tag row, the title at full width, at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForSearchReady(page);
    await page.getByTestId('search-input').fill('острая ишемия конечностей');
    await page.getByTestId('search-submit').click();
    const group = page
      .locator('.result-group')
      .filter({ has: page.locator('.result-group__action') })
      .first();
    const button = group.locator('.search-download-icon');
    await expect(button).toBeVisible({ timeout: 60_000 });
    // The sentence with the size is the accessible name; nothing is printed (owner 2026-10-31).
    await expect(button).toHaveAccessibleName(/^Скачать полный текст · .+ · [\d.,\s]+(КБ|МБ|ГБ)$/u);
    await expect(button).toHaveText('');
    const [head, kind, title, box, card] = await Promise.all([
      group.locator('.result-group__head').boundingBox(),
      group.locator('.result-group-header__kind').boundingBox(),
      group.locator('.result-group-header__title').boundingBox(),
      button.boundingBox(),
      group.boundingBox(),
    ]);
    if (!head || !kind || !title || !box || !card) {
      throw new Error('The card, its header parts or the button has no box.');
    }
    expect(box.height).toBeLessThanOrEqual(40);
    expect(box.width).toBeLessThanOrEqual(40);
    // In the tag's row, at the header's right edge.
    expect(box.y).toBeGreaterThanOrEqual(head.y);
    expect(box.y).toBeLessThan(kind.y + kind.height);
    expect(box.x).toBeGreaterThan(kind.x + kind.width);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    // The title starts below the button and may run under its column: the card's full width.
    expect(title.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect(title.x + title.width).toBeGreaterThan(box.x);
    // One finding per card: no fragments toggle on that line (owner 2026-10-20).
    await expect(group.locator('.ui-disclosure__header')).toHaveCount(0);
    await group.screenshot({ path: testInfo.outputPath(`source-card-${width}.png`) });
  });
}
