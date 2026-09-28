import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

for (const width of [375, 1280]) {
  test(`section downloads stay in the menu and share progress at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let failDownload = width === 375;
    await page.route('**/content/modules/minimed-tools-neonatology-*.db', async (route) => {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({ status: 404 });
        return;
      }
      requests += 1;
      await gate;
      if (failDownload)
        await route.fulfill({ status: 403, body: 'Download unavailable in this test attempt' });
      else await route.continue();
    });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    // Package status is checked once the medical core has opened; that can take longer than an
    // assertion timeout under load, and it is not what this test measures.
    await page.waitForFunction(
      () => performance.getEntriesByName('minimed:search-ready').length > 0,
      undefined,
      { timeout: 90_000 },
    );
    const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });
    await picker.click();
    const menu = page.getByRole('dialog', { name: 'Разделы поиска' });
    await expect(menu.locator('[data-overlayscrollbars]')).toHaveCount(1);
    // Rows sit in an overlay-scrollbar viewport: Playwright's click scrolls the page to reach them
    // while the menu is still settling, which a person never does and which closes the menu.
    await menu
      .getByRole('button', { name: 'Подразделы: Опросники', exact: true })
      .dispatchEvent('click');
    const section = menu
      .locator('.search-section-menu__section')
      .filter({ has: page.getByRole('button', { name: 'Подразделы: Опросники', exact: true }) });
    await expect(section).toHaveClass(/search-section-menu__section--expanded/u);
    const expand = menu.getByRole('button', { name: 'Подразделы: Опросники', exact: true });
    // Move the pointer instead of hover(): hover() scrolls the page to the target, which at 375px
    // pushes the picker off screen and closes the menu by design.
    const expandBox = await expand.boundingBox();
    if (expandBox)
      await page.mouse.move(expandBox.x + expandBox.width / 2, expandBox.y + expandBox.height / 2);
    const scrollbarBox = await menu.locator('.os-scrollbar-vertical').boundingBox();
    expect(expandBox).not.toBeNull();
    expect(scrollbarBox).not.toBeNull();
    expect((expandBox?.x ?? 0) + (expandBox?.width ?? 0)).toBeLessThanOrEqual(scrollbarBox?.x ?? 0);

    const download = section.getByRole('button', { name: /^Загрузка: Неонатология\./u });
    await expect(download).toHaveAccessibleName(/Пакеты: 0\/1/u);
    expect((await download.boundingBox())?.height).toBeLessThanOrEqual(44);
    expect(
      (await menu.getByRole('link', { name: 'Загрузки', exact: true }).boundingBox())?.height,
    ).toBeLessThanOrEqual(32);
    await expect(menu.locator('.os-scrollbar-vertical')).not.toHaveClass(
      /os-scrollbar-auto-hide-hidden/u,
    );
    await download.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('expanded-download-menu.png') });
    try {
      await download.click();
      // The shared progress mark: a pie while running, a clock while the task waits in the queue.
      await expect(download.locator('.download-progress-mark')).toBeVisible();
      await expect(download).toBeDisabled();
      await expect(menu).toBeVisible();
      await expect.poll(() => requests).toBe(1);
      await page.keyboard.press('Escape');
      await picker.click();
      await menu
        .getByRole('button', { name: 'Подразделы: Опросники', exact: true })
        .dispatchEvent('click');
      await expect(download.locator('.download-progress-mark')).toBeVisible();
      await download.scrollIntoViewIfNeeded();
    } finally {
      release();
    }
    if (failDownload) {
      await expect(download).toHaveAccessibleName(/Ошибка/u);
      await expect(download).toHaveText('');
      expect((await download.boundingBox())?.width).toBeLessThanOrEqual(60);
      await expect(menu.locator('details')).toHaveCount(0);
      failDownload = false;
      await download.click();
    }
    await expect(download).toHaveCount(0);
    await expect(menu).toBeVisible();
    expect(requests).toBe(width === 375 ? 2 : 1);
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath('download-complete-menu.png') });
    await section.getByRole('button', { name: /^Неонатология \(3\)$/u }).click();
    await page.locator('.unified-catalog__tool').first().click();
    await expect(page.locator('.assessment-workspace')).toBeVisible();
  });
}
