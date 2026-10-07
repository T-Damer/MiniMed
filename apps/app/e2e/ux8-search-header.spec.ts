import { E2E_ASSET_ORIGIN, mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, test } from '@playwright/test';

/** UX8: the search header, the core status line and the compact source-card download button. */

async function waitForSearchReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 90_000 },
  );
}

async function announceUpdate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const worker = { scriptURL: `${window.location.origin}/sw.js?v=9.9.9`, postMessage: () => {} };
    window.dispatchEvent(new CustomEvent('minimed:app-update-ready', { detail: { worker } }));
  });
}

for (const width of [360, 390, 1280]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the search header keeps every button inside the row and the update hint above «Настройки» at ${width}px, ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme });
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      await waitForSearchReady(page);
      await announceUpdate(page);
      await expect(page.getByTestId('app-update-nav-hint')).toBeVisible();
      const hint = await page.getByTestId('app-update-nav-hint').boundingBox();
      expect(hint).not.toBeNull();
      expect((hint?.x ?? 0) + (hint?.width ?? 0)).toBeLessThanOrEqual(width);

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
      // Only the history button and «?» are left in the row; the update hint is not in it.
      await expect(page.locator('.search-mode-tools > *')).toHaveCount(2);
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
  // Once the user is past the greeting the download is real, and the status follows it.
  const intro = page.getByRole('dialog', { name: 'Добро пожаловать в MiniMed' });
  const next = intro.getByRole('button', { name: 'Далее', exact: true });
  await next.click();
  await next.click();
  await expect.poll(() => downloads).toBe(1);
  await expect(page.locator('.search-home .search-core-status')).toContainText('Загружаем базу');
  await expect(page.locator('.search-core-status__spinner')).toHaveCount(0);
});

for (const width of [360, 390, 1280]) {
  test(`the source card puts a compact download button in its header at ${width}px`, async ({
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
    const chip = group.locator('.search-download-chip');
    await expect(chip).toBeVisible({ timeout: 60_000 });
    // The sentence stays in the accessible name; only the size is printed.
    await expect(chip).toHaveAccessibleName(/^Скачать полный текст · .+ · [\d.,\s]+(КБ|МБ|ГБ)$/u);
    await expect(chip).toHaveText(/^[\d.,\s]+(КБ|МБ|ГБ)$/u);
    const [header, box] = await Promise.all([
      group.locator('.result-group-header').boundingBox(),
      chip.boundingBox(),
    ]);
    if (!header || !box) throw new Error('The card header or the button has no box.');
    expect(box.height).toBeLessThanOrEqual(40);
    expect(box.width).toBeLessThanOrEqual(140);
    // Inside the header block, not a row of its own below it.
    expect(box.y).toBeGreaterThanOrEqual(header.y);
    expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height);
    expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width);
    // The kind badge on the same line gives it room.
    const kind = await group.locator('.result-group-header__kind').boundingBox();
    if (!kind) throw new Error('The kind badge has no box.');
    expect(kind.x + kind.width).toBeLessThanOrEqual(box.x);
    await group.screenshot({ path: testInfo.outputPath(`source-card-${width}.png`) });
  });
}
