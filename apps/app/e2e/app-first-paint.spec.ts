import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const SPLASH = 'rgb(243, 236, 217)';

// This file covers a launch whose onboarding is already done: the splash fades into search. The
// first launch, where the splash icon flies into the onboarding intro, is in onboarding.spec.ts.
for (const width of [375, 1280]) {
  test(`start-up keeps the splash colour and reveals the first view once at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      const state = window as unknown as { __revealSeen?: number };
      state.__revealSeen = 0;
      new MutationObserver(() => {
        if (document.querySelector('.boot-surface--leaving')) state.__revealSeen = 1;
      }).observe(document, { subtree: true, attributes: true, childList: true });
    });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/notes`);
    await expect(page.getByRole('heading', { name: 'Заметки', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // Before the app renders (empty #root) the page shows the splash colour, not the grey desk.
    const colours = await page.evaluate(() => {
      const root = document.getElementById('root') as HTMLElement;
      const rendered = getComputedStyle(document.documentElement).backgroundColor;
      const parked = document.createDocumentFragment();
      while (root.firstChild) parked.append(root.firstChild);
      const html = getComputedStyle(document.documentElement).backgroundColor;
      const body = getComputedStyle(document.body).backgroundColor;
      root.append(parked);
      return { rendered, html, body };
    });
    // Once rendered, the desk owns the canvas again (overscroll keeps the desk colour).
    expect(colours).toEqual({ rendered: 'rgb(119, 114, 102)', html: SPLASH, body: SPLASH });

    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __revealSeen?: number }).__revealSeen),
      )
      .toBe(1);
    await expect(page.locator('#boot-surface')).toHaveCount(0);

    // Switching tabs later never replays the start-up reveal.
    await page.evaluate(() => {
      (window as unknown as { __revealSeen?: number }).__revealSeen = 0;
    });
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __revealSeen?: number }).__revealSeen),
    ).toBe(0);
  });

  test(`route desks hold one viewport of tint whatever the content height at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/notes`);
    const desk = page.locator('.patient-notes-view').first();
    await expect(desk).toBeVisible({ timeout: 30_000 });

    const tint = () =>
      desk.evaluate((element) => {
        const style = getComputedStyle(element);
        return { size: style.backgroundSize.split(',')[1]?.trim(), color: style.backgroundColor };
      });
    const before = await tint();
    expect(before.size).toBe(`100% ${844}px`);
    await desk.evaluate((element) => {
      (element as HTMLElement).style.minHeight = '400rem';
    });
    expect(await tint()).toEqual(before);
  });
}
