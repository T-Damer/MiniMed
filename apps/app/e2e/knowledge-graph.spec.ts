import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

for (const width of [375, 1280]) {
  test(`the graph opens on a bounded neighbourhood and expands on request at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page);
    await page.evaluate(() => {
      window.location.hash = '#/modules/documents/core-library';
    });
    await expect(page.locator('.document-library-card').first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Карта связей', exact: true }).click();

    const card = page.locator('.knowledge-graph-card');
    await expect(page.locator('.knowledge-graph-canvas')).toBeVisible();
    await expect(card).toHaveAttribute('data-node-count', '300');
    const summary = card.locator('.knowledge-graph-card__summary-text');
    await expect(summary).toHaveText(/^Показано 300 из \d+ документ(?:а|ов)?$/u);
    const total = Number(/из (\d+)/u.exec(await summary.innerText())?.[1]);
    expect(total).toBeGreaterThan(300);
    await expect(card).toHaveAttribute('data-layout-state', /^(running|settled)$/u);

    await card.getByRole('button', { name: 'Показать все', exact: true }).click();
    await expect(card).toHaveAttribute('data-node-count', String(total));
    await expect(card.locator('.knowledge-graph-card__summary')).toHaveCount(0);
    await expect(card).toHaveAttribute('data-layout-state', 'settled');
    await page.screenshot({ path: test.info().outputPath('knowledge-graph.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('.knowledge-graph-canvas')).toHaveCount(0);
  });
}

test('the graph entry points follow the experimental setting', async ({ page }) => {
  await mountBuiltApp(page, {
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({
        splitNavigation: true,
        experimentalModulesEnabled: false,
      }),
    },
  });
  await page.evaluate(() => {
    window.location.hash = '#/modules/documents/core-library';
  });
  await expect(page.locator('.document-library-card').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Карта связей', exact: true })).toHaveCount(0);
});
