import { E2E_ASSET_ORIGIN, mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, test } from '@playwright/test';

/**
 * Layout checks for iPad mini (744 × 1133 portrait, 1133 × 744 landscape) and iPhone widths. They
 * run in Chromium by default; `PLAYWRIGHT_WEBKIT=1 bunx playwright test --project=webkit-ios` runs
 * them in WebKit, the engine of Safari and of the iOS app's web view.
 */
const ORIGIN = process.env['MINIMED_LIVE_URL'] ?? E2E_ASSET_ORIGIN;

const SIZES = [
  { name: 'iPad mini portrait', width: 744, height: 1133 },
  { name: 'iPad mini landscape', width: 1133, height: 744 },
  { name: 'iPhone', width: 393, height: 852 },
] as const;

const ROUTES = ['#/search', '#/modules/documents', '#/calculators', '#/notes', '#/settings'];

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('no route scrolls sideways', async ({ page }) => {
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      for (const route of ROUTES) {
        await page.evaluate((hash) => {
          window.location.hash = hash;
        }, route);
        await page.waitForTimeout(400);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      }
    });
  });
}

test.describe('a portrait tablet is not a phone strip', () => {
  test.use({ viewport: { width: 744, height: 1133 } });

  test('the search page uses the width instead of a 65ch column', async ({ page }) => {
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const box = await page.locator('.search-home').boundingBox();
    // 744 pt minus the 2 rem desk margin; the old column was ~578 pt wide with 83 pt gutters.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(744 - 40);
  });
});

test.describe('first-run veil', () => {
  test.use({ viewport: { width: 744, height: 1133 } });

  test('the blur mask has no negative colour stop (WebKit paints nothing for one)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', 'the broken mask is a WebKit behaviour');
    await page.goto(`${ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
    const veil = page.locator('.onboarding__veil--full');
    await expect(veil).toBeAttached({ timeout: 30_000 });
    const mask = await veil.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.maskImage || style.webkitMaskImage;
    });
    expect(mask).toContain('radial-gradient');
    // The first stop is clamped: `max(0%, var(--onboarding-clear))`, never a bare negative offset.
    expect(mask).toMatch(/rgba\(0, 0, 0, 0\) max\(0%, /u);
  });
});
