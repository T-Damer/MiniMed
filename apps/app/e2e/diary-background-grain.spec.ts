import { expect, type Page, test } from '@playwright/test';

import { testInvitation, testInvitationLink } from './diary-fixtures';
import { mountBuiltApp } from './mount-built-app';

// The page grounds carry a fine grain (BG1, theme.css `--theme-grain`): the desk, the route pages
// and the patient diary's paper. Cards and controls stay flat, so the press shade still marks them
// (press-feedback.ts skips a control that has a background image of its own), and people who ask
// for more contrast get the plain grounds.

/** True when the element's background layers include the grain tile. */
function hasGrain(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundImage.includes('fractalNoise'));
}

/** Visible controls whose own background carries the grain (should be none). */
function grainyControls(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], summary, [role="button"]')]
      .filter((element) => getComputedStyle(element).backgroundImage.includes('fractalNoise'))
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test(`grain on the grounds, not on controls, ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });

    await mountBuiltApp(page);
    expect(await hasGrain(page, 'body')).toBe(true);
    expect(await hasGrain(page, '.search-home')).toBe(true);
    expect(await grainyControls(page)).toEqual([]);

    await page.goto(await testInvitationLink(testInvitation({ doctor: 'Иванова А. А.' })));
    await expect(page.locator('.diary-notice')).toBeVisible();
    expect(await hasGrain(page, '.diary-page')).toBe(true);
    expect(await grainyControls(page)).toEqual([]);

    // A held press on a flat diary row still gets the shade.
    const records = page.getByRole('button', { name: /^Мои записи/u });
    const box = await records.boundingBox();
    if (!box) throw new Error('«Мои записи» has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(records).toHaveAttribute('data-pressed', /^(shade|ledge)$/u);
    await page.mouse.up();

    // More contrast: plain grounds.
    await page.emulateMedia({ colorScheme: scheme, contrast: 'more' });
    expect(await hasGrain(page, '.diary-page')).toBe(false);
  });
}
