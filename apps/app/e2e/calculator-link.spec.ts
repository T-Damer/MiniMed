import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN } from './mount-built-app';

/**
 * CALCLINK (owner 2026-11-08): a calculator sent as a link opens that one calculator, filled in,
 * without its section's download, and a profile the device remembers («Дневники») does not take
 * the link over.
 */
const LINK = `${E2E_ASSET_ORIGIN}/index.html?share=tool#/calculators/minimed.calculator.ciwa-ar?tremor=4&sweats=4&anxiety=4&agitation=4`;

for (const remembered of [false, true]) {
  test(`a shared CIWA-Ar link opens filled in${remembered ? ' over a remembered «Дневники»' : ''}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    if (remembered) {
      await page.addInitScript(() => {
        window.localStorage.setItem('minimed.app-profile.v1', 'diaries');
      });
    }
    const packRequests: string[] = [];
    page.on('request', (request) => {
      if (/minimed-tools-neurology/u.test(request.url())) packRequests.push(request.url());
    });

    await page.goto(LINK);

    await expect(page.getByRole('heading', { name: /CIWA-Ar/u }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Скачайте его один раз', { exact: false })).toHaveCount(0);
    // The shared view is the calculator alone: no bottom bar, no «Дневники».
    await expect(page.locator('.bottom-nav, nav[aria-label="Основная навигация"]')).toHaveCount(0);
    await expect(page.getByText('Пациенты', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Рассчитать и сохранить', exact: true }).click();
    await expect(page.getByRole('figure', { name: '16 баллов — Тяжёлый ААС' })).toBeVisible();
    await expect(page.getByText(/показание к госпитализации/u).first()).toBeVisible();
    expect(packRequests).toEqual([]);

    // The device keeps the profile it had: the link did not replace it.
    const stored = await page.evaluate(() => window.localStorage.getItem('minimed.app-profile.v1'));
    expect(stored).toBe(remembered ? 'diaries' : null);
  });
}
