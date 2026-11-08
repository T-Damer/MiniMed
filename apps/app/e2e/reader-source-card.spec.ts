import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

/**
 * UI-BATCH3 (owner 2026-11-08), a term's card in the reader:
 * - the source's own small open button stands beside its name, not as a header «Открыть» or a row
 *   of buttons;
 * - a definition folds only when that hides three lines or more, so «Показать полностью» never
 *   opens just the line it covered.
 * `UI_SHOTS=<dir>` saves phone and tablet screenshots in both themes.
 */
const SHOTS = process.env['UI_SHOTS'];

async function openTermCard(page: Page, viewport: { width: number; height: number }) {
  await routeClinicalModule(page);
  await page.setViewportSize(viewport);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchEditable(page);
  await installClinicalModule(page);
  await expect(page.locator('.document-overlay-section').first()).toBeVisible();
  const link = page.locator('.document-inline-link', { hasText: 'Парадоксальная эмболия' }).first();
  await link.scrollIntoViewIfNeeded();
  await link.click();
  const card = page.locator('.document-inline-preview__card');
  await expect(card).toBeVisible();
  return card;
}

for (const [width, height] of [
  [390, 844],
  [1024, 768],
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`a term card puts its open button beside the source name, ${String(width)}px ${scheme}`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await page.emulateMedia({ colorScheme: scheme });
      const card = await openTermCard(page, { width, height });

      const title = card.locator('.document-inline-preview__title');
      const open = card.getByRole('button', { name: /^Открыть: /u });
      await expect(open).toHaveCount(1);
      const titleBox = await title.boundingBox();
      const openBox = await open.boundingBox();
      if (!titleBox || !openBox) throw new Error('the card heading has no box');
      // One row: the button's top is level with the title's first line, and it is small.
      expect(Math.abs(openBox.y - titleBox.y)).toBeLessThan(12);
      expect(openBox.width).toBeLessThanOrEqual(40);
      await expect(open).not.toHaveText(/Открыть/u);

      // Folded only with at least three lines out of sight.
      const definition = card.locator('.document-inline-preview__definition').first();
      const more = card.getByRole('button', { name: 'Показать полностью' });
      const hidden = await definition.evaluate((element) => {
        const style = getComputedStyle(element);
        const line = Number.parseFloat(style.lineHeight);
        return Math.round((element.scrollHeight - element.clientHeight) / line);
      });
      if ((await more.count()) > 0) expect(hidden).toBeGreaterThanOrEqual(3);
      else expect(hidden).toBe(0);

      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({
          path: `${SHOTS}/reader-term-card-${String(width)}-${scheme}.png`,
          animations: 'disabled',
        });
      }
    });
  }
}
