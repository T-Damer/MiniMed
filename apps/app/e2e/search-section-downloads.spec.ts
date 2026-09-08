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
    const picker = page.getByRole('button', { name: 'Раздел поиска', exact: true });
    await picker.click();
    const menu = page.getByRole('dialog', { name: 'Разделы поиска' });
    await expect(menu.locator('[data-overlayscrollbars]')).toHaveCount(1);
    await menu.getByRole('button', { name: 'Подразделы: Опросники', exact: true }).click();
    const section = menu
      .locator('.search-section-menu__section')
      .filter({ has: page.getByRole('button', { name: 'Подразделы: Опросники', exact: true }) });
    await expect(section).toHaveClass(/search-section-menu__section--expanded/u);
    const expand = menu.getByRole('button', { name: 'Подразделы: Опросники', exact: true });
    await expand.hover();
    const expandBox = await expand.boundingBox();
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
      await expect(download.locator('.search-section-download__pie')).toBeVisible();
      await expect(download).toBeDisabled();
      await expect(menu).toBeVisible();
      await expect.poll(() => requests).toBe(1);
      await page.keyboard.press('Escape');
      await picker.click();
      await menu.getByRole('button', { name: 'Подразделы: Опросники', exact: true }).click();
      await expect(download.locator('.search-section-download__pie')).toBeVisible();
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
