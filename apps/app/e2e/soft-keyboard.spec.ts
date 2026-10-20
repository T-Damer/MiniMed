import { expect, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

// A phone: touch input, so a focused field means a keyboard is coming.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

test('the bottom navigation steps aside while the keyboard is up and returns after', async ({
  page,
}, testInfo) => {
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const nav = page.locator('.app-bottom-nav');
  const html = page.locator('html');
  await expect(nav).toBeVisible();
  await expect(html).not.toHaveClass(/app-keyboard-open/u);

  const field = page.locator('textarea.query-sheet__input').first();
  await field.focus();
  // At once, before the viewport has moved: the bar must never ride up above the keyboard.
  await expect(html).toHaveClass(/app-keyboard-open/u);
  await expect(nav).toBeHidden();

  // The keyboard arrives: the viewport shrinks. The bar stays away and the field stays in view.
  await page.setViewportSize({ width: 375, height: 480 });
  await expect(html).toHaveClass(/app-keyboard-open/u);
  await expect(nav).toBeHidden();
  const box = await field.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(480);
  await page.screenshot({ path: testInfo.outputPath('keyboard-open-375.png') });

  // The keyboard leaves: blur, then the viewport grows back.
  await field.blur();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(html).not.toHaveClass(/app-keyboard-open/u);
  await expect(nav).toBeVisible();
});

test('a field under the keyboard is scrolled into view', async ({ page }) => {
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  // A text field far down the page, as in a long form.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'keyboard-probe';
    input.type = 'text';
    input.style.cssText =
      'position:absolute;left:20px;top:1500px;width:300px;height:44px;z-index:9999';
    document.body.append(input);
    document.body.style.minHeight = '2200px';
    window.scrollTo({ top: 900, behavior: 'instant' });
  });
  const probe = page.locator('#keyboard-probe');
  await probe.focus({ timeout: 5_000 });
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
  await page.setViewportSize({ width: 375, height: 480 });
  await expect
    .poll(async () => {
      const box = await probe.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(480 - 16);
  const top = (await probe.boundingBox())?.y ?? -1;
  expect(top).toBeGreaterThanOrEqual(0);
});
