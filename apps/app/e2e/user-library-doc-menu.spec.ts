import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { syntheticEpub } from './synthetic-epub';
import { syntheticPdf } from './synthetic-pdf';

const DISCOVER_NAME = 'Действия с документом';
const SCREENSHOT_DIR = process.env['DOC_MENU_SCREENSHOTS_DIR'];

async function openLibraryWithDocuments(page: Page): Promise<void> {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
  for (const name of ['synthetic-book.epub', 'second-book.epub', 'third-book.epub']) {
    await page.locator('.user-library-page__file-input').setInputFiles({
      name,
      mimeType: 'application/epub+zip',
      buffer: await syntheticEpub(),
    });
    await expect(
      page.locator('.user-library-card').filter({ hasText: name.slice(0, -5) }),
    ).toBeVisible();
  }
}

async function menuLabels(page: Page): Promise<readonly string[]> {
  const items = page.getByRole('menuitem');
  await expect(items.first()).toBeVisible();
  return items.allTextContents();
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

const isFocused = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => element === document.activeElement);

/** Cards are not tab stops themselves; their «⋯» button is. Tab through the page until it has focus. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let step = 0; step < 80 && !(await isFocused(target)); step += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

const opacityOf = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));

test.describe('desktop pointer', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hovering a document shows «⋯» that opens the right-click menu', async ({
    page,
  }, testInfo) => {
    await openLibraryWithDocuments(page);
    const card = page.locator('.user-library-card').filter({ hasText: 'synthetic-book' });
    const wrapper = page.locator('.user-library-card-menu').filter({ has: card });
    const button = wrapper.getByRole('button', { name: DISCOVER_NAME });

    // Hidden and inert until the stable item is hovered.
    await expect(button).toHaveCount(1);
    expect(await opacityOf(button)).toBe(0);
    await page.mouse.move(2, 2);
    await card.hover();
    await expect.poll(() => opacityOf(button)).toBe(1);

    // Placed at the item's corner, not shifting the layout.
    const wrapperBox = await wrapper.boundingBox();
    const buttonBox = await button.boundingBox();
    if (!wrapperBox || !buttonBox) throw new Error('missing boxes');
    expect(Math.abs(buttonBox.y - (wrapperBox.y - 4))).toBeLessThan(1.5);
    expect(
      Math.abs(buttonBox.x + buttonBox.width - (wrapperBox.x + wrapperBox.width + 4)),
    ).toBeLessThan(1.5);
    const stable = await wrapper.boundingBox();
    expect(stable).toEqual(wrapperBox);

    // The corner part that sticks out of the item keeps it hovered: no flicker loop.
    await page.mouse.move(buttonBox.x + buttonBox.width - 1, buttonBox.y + 1);
    await page.waitForTimeout(300);
    await expect.poll(() => opacityOf(button)).toBe(1);

    if (SCREENSHOT_DIR) {
      mkdirSync(resolve(SCREENSHOT_DIR), { recursive: true });
      await page.screenshot({
        path: resolve(SCREENSHOT_DIR, `${testInfo.project.name}-hover.png`),
        clip: {
          x: Math.max(0, wrapperBox.x - 40),
          y: Math.max(0, wrapperBox.y - 40),
          width: wrapperBox.width + 100,
          height: wrapperBox.height + 100,
        },
      });
    }

    // Right-click reference menu.
    await card.click({ button: 'right' });
    const rightClickItems = await menuLabels(page);
    expect(rightClickItems.length).toBeGreaterThan(3);
    await closeMenu(page);

    await card.hover();
    await button.click();
    const buttonItems = await menuLabels(page);
    expect(buttonItems).toEqual(rightClickItems);
    // Anchored to the button.
    const menuBox = await page.getByRole('menu').first().boundingBox();
    if (!menuBox) throw new Error('missing menu');
    expect(Math.abs(menuBox.x - (buttonBox.x + buttonBox.width / 2))).toBeLessThan(40);
    expect(menuBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 2);
    expect(menuBox.y).toBeLessThan(buttonBox.y + buttonBox.height + 40);
  });

  test('keyboard focus reveals «⋯» and Enter opens the menu', async ({ page }) => {
    await openLibraryWithDocuments(page);
    const card = page.locator('.user-library-card').filter({ hasText: 'second-book' });
    const wrapper = page.locator('.user-library-card-menu').filter({ has: card });
    const button = wrapper.getByRole('button', { name: DISCOVER_NAME });
    await page.mouse.move(2, 2);
    await expect(button).not.toHaveAttribute('tabindex', '-1');
    await tabTo(page, button);
    await expect(button).toBeFocused();
    await expect.poll(() => opacityOf(button)).toBe(1);
    await page.keyboard.press('Enter');
    expect((await menuLabels(page)).length).toBeGreaterThan(3);
  });

  test('cards keep their node and «⋯» focus while added files are still being read', async ({
    page,
  }) => {
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    // Hold the PDF reader so «scan» stays at «Читаем файл…» until «⋯» has focus; its progress and
    // the final «ready» patch then land while the keyboard user is on the menu button.
    let releaseReader = (): void => undefined;
    const readerHeld = new Promise<void>((resolve) => {
      releaseReader = resolve;
    });
    await page.route('**/pdf.worker*', async (route) => {
      await readerHeld;
      await route.continue();
    });
    await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
    const input = page.locator('.user-library-page__file-input');
    await input.waitFor({ state: 'attached' });
    const epub = await syntheticEpub();
    await input.setInputFiles([
      { name: 'fresh-one.epub', mimeType: 'application/epub+zip', buffer: epub },
      { name: 'fresh-two.epub', mimeType: 'application/epub+zip', buffer: epub },
      { name: 'scan.pdf', mimeType: 'application/pdf', buffer: syntheticPdf({ pages: 3 }) },
    ]);
    await expect(page.locator('.user-library-card')).toHaveCount(3);
    const reading = page.locator('.user-library-card').filter({ hasText: 'scan' });
    await expect(reading.locator('.user-library-card__progress-bar')).toHaveCount(1);

    const card = page.locator('.user-library-card').filter({ hasText: 'fresh-two' });
    const wrapper = page.locator('.user-library-card-menu').filter({ has: card });
    const button = wrapper.getByRole('button', { name: DISCOVER_NAME });
    await card.evaluate((element) => {
      (window as unknown as { e2eFreshCard?: Element }).e2eFreshCard = element;
    });
    await page.mouse.move(2, 2);
    await tabTo(page, button);

    releaseReader();
    await expect(page.locator('.user-library-card__progress-bar')).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    // Reading, thumbnails and progress patch the same documents: no card is replaced.
    expect(
      await card.evaluate(
        (element) =>
          element.isConnected &&
          element === (window as unknown as { e2eFreshCard?: Element }).e2eFreshCard,
      ),
    ).toBe(true);
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    expect((await menuLabels(page)).length).toBeGreaterThan(3);
  });
});

test.describe('touch pointer', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the «⋯» stays visible but quiet and opens the same menu', async ({ page }) => {
    await openLibraryWithDocuments(page);
    const card = page.locator('.user-library-card').filter({ hasText: 'synthetic-book' });
    const wrapper = page.locator('.user-library-card-menu').filter({ has: card });
    const button = wrapper.getByRole('button', { name: DISCOVER_NAME });
    await expect(button).toBeVisible();
    const opacity = await opacityOf(button);
    expect(opacity).toBeGreaterThan(0.4);
    expect(opacity).toBeLessThan(1);
    await button.tap();
    expect((await menuLabels(page)).length).toBeGreaterThan(3);
  });
});
