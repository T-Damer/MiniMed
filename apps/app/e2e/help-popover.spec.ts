import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/**
 * UI-BATCH3 (owner 2026-11-08), on CIWA-Ar's «?»:
 * - the sources sit at the end of the help, folded under «Источники», as named rows (no raw links);
 *   a КР the app has opens in the reader;
 * - a help taller than the room under its button scrolls inside itself, not the page behind;
 * - the «?» stays pressed, ringed in the accent the panel's border repeats, while the panel is open.
 * `UI_SHOTS=<dir>` also saves phone and tablet screenshots in both themes.
 */
const CALCULATOR = `${E2E_ASSET_ORIGIN}/#/calculators/minimed.calculator.ciwa-ar`;
const SHOTS = process.env['UI_SHOTS'];

async function openHelp(page: Page): Promise<void> {
  await page.goto(CALCULATOR);
  await expect(page.getByRole('heading', { name: /CIWA-Ar/u }).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Информация', exact: true }).first().click();
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`CIWA-Ar help on a tablet: folded named sources, inner scroll, owned button (${scheme})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.emulateMedia({ colorScheme: scheme });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await openHelp(page);

    const panel = page.locator('.page__help-panel.sheet-popover__floating');
    await expect(panel).toBeVisible();
    const trigger = page.locator('.page__help-button.menu-owner--open');
    await expect(trigger).toBeVisible();

    const sources = panel.getByRole('button', { name: /Источники/u });
    await expect(sources).toHaveAttribute('aria-expanded', 'false');
    await shot(page, `ciwa-help-1024-${scheme}`);
    await sources.click();
    await expect(sources).toHaveAttribute('aria-expanded', 'true');

    const rows = panel.locator('.help-sources__row');
    await expect(rows).toHaveCount(3);
    // Named sources: the КР by its own title, a journal article with the site's name, no address.
    await expect(rows.nth(0)).toContainText('Синдром отмены алкоголя');
    await expect(rows.nth(0)).toContainText('Минздрав России · 2024');
    await expect(rows.nth(0)).toHaveAttribute('data-testid', 'help-source-document');
    await expect(rows.nth(1)).toContainText('PubMed');
    await expect(panel.locator('.help-sources__list')).not.toContainText('https://');
    await expect(panel.locator('.help-sources__list')).not.toContainText(
      'Клинические рекомендации «',
    );

    // Taller than the room under the button: the panel scrolls itself, the page stays put.
    const geometry = await panel.evaluate((element) => ({
      bottom: element.getBoundingClientRect().bottom,
      overflowY: getComputedStyle(element).overflowY,
      scrolls: element.scrollHeight > element.clientHeight + 1,
    }));
    expect(geometry.bottom).toBeLessThanOrEqual(700);
    expect(geometry.overflowY).toBe('auto');
    if (geometry.scrolls) {
      const box = await panel.boundingBox();
      if (!box) throw new Error('the help panel has no box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // The page has settled (its entrance, the opened sources) before it is compared.
      await expect
        .poll(async () => {
          const first = await page.evaluate(() => window.scrollY);
          await page.waitForTimeout(250);
          return (await page.evaluate(() => window.scrollY)) - first;
        })
        .toBe(0);
      const pageBefore = await page.evaluate(() => window.scrollY);
      // Far more wheel than the panel holds: it scrolls to its end, and the rest does not reach
      // the page behind it.
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(600);
      expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(pageBefore);
    }
    await shot(page, `ciwa-help-sources-1024-${scheme}`);

    // The КР opens in the app's reader, not on the site.
    await rows.nth(0).click();
    await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
  });

  test(`CIWA-Ar help on a phone: the sheet lists the same folded sources (${scheme})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await openHelp(page);
    const sheet = page.getByRole('dialog', { name: 'Информация' });
    await expect(sheet).toBeVisible();
    const sources = sheet.getByRole('button', { name: /Источники/u });
    await expect(sources).toHaveAttribute('aria-expanded', 'false');
    await shot(page, `ciwa-help-390-${scheme}`);
    await sources.click();
    await expect(sheet.locator('.help-sources__row')).toHaveCount(3);
    await sheet.locator('.help-sources__row').nth(2).scrollIntoViewIfNeeded();
    await shot(page, `ciwa-help-sources-390-${scheme}`);
  });
}
