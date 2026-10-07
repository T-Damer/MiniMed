import { expect, type Page, test } from '@playwright/test';
import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { mountBuiltApp } from './mount-built-app';

const PHONE = { width: 390, height: 844 } as const;

async function mountOnPhone(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
  await expect(page.getByTestId('search-input')).toHaveAttribute('data-search-ready', 'true', {
    timeout: 60_000,
  });
}

/** Installs the clinical module from its pointer and waits for the opened full document. */
async function openClinicalReader(page: Page): Promise<void> {
  await routeClinicalModule(page);
  await mountOnPhone(page);
  await installClinicalModule(page);
  await expect(page.locator('.document-overlay-paper')).toBeVisible();
  await expect(page.locator('.document-overlay-section').first()).toBeVisible();
}

test('a pointer that becomes its document takes its history entry and leaves one crumb', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeClinicalModule(page);
  await mountOnPhone(page);
  // Every header and heading text the reader shows while the pointer turns into the document.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __seenTitles: string[] }).__seenTitles = seen;
    new MutationObserver(() => {
      const crumbs = document.querySelector('.document-crumbs')?.textContent ?? '';
      const heading = document.querySelector('.document-overlay-paper__title')?.textContent ?? '';
      seen.push(`${crumbs}|${heading}`);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const entriesBefore = await page.evaluate(() => window.history.length);
  await installClinicalModule(page);
  await expect(page.locator('.document-overlay-section').first()).toBeVisible();

  // Opening the pointer added one entry; the redirect replaced it instead of adding a second.
  expect(await page.evaluate(() => window.history.length)).toBe(entriesBefore + 1);
  const seen = await page.evaluate(
    () => (window as unknown as { __seenTitles: string[] }).__seenTitles,
  );
  expect(seen.some((text) => text.includes('Открываем'))).toBe(false);
  // The document shows once in the header trail: the origin, and no second crumb for it.
  await expect(page.locator('.document-crumbs__item')).toHaveCount(1);

  // Back leaves the reader instead of landing on the pointer, which would open the document again.
  await page.goBack();
  await expect(page.getByTestId('search-input')).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain('/modules/documents/d/');
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).hash).not.toContain('/modules/documents/d/');
});

test('the reader counts its sections «12 / 48» and jumps from a bubble', async ({ page }) => {
  test.setTimeout(240_000);
  await openClinicalReader(page);

  const counter = page.locator('[data-reader-position="chrome"]');
  await expect(counter).toBeVisible();
  await expect(counter).toHaveText(/^\s*1\s*\/\s*\d+\s*$/u);
  expect(
    await counter.evaluate((element) => getComputedStyle(element).fontVariantNumeric),
  ).toContain('tabular-nums');
  const total = Number.parseInt((await counter.innerText()).split('/')[1] ?? '', 10);
  expect(total).toBeGreaterThan(8);

  // The outline lists exactly as many sections as the counter totals.
  await page.getByRole('button', { name: 'Открыть оглавление' }).click();
  await expect(page.locator('.document-overlay-outline-section-button')).toHaveCount(total);
  await expect(page.locator('[data-reader-position="outline"]')).toHaveText(
    new RegExp(`^\\s*1\\s*/\\s*${String(total)}\\s*$`, 'u'),
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.document-overlay-outline--hidden')).toHaveCount(1);

  // Tapping the pill opens the bubble; a second tap closes it (no reopening race).
  await counter.click();
  const bubble = page.getByRole('dialog', { name: 'Перейти к разделу' });
  await expect(bubble).toBeVisible();
  await counter.click();
  await expect(bubble).toHaveCount(0);

  await counter.click();
  const field = bubble.getByRole('textbox');
  await expect(field).toBeFocused();
  await field.fill('9');
  await page.keyboard.press('Enter');
  await expect(bubble).toHaveCount(0);
  await expect(counter).toHaveText(/^\s*9\s*\/\s*\d+\s*$/u);
  // The jump is the outline's own (`chrome.scrollTo`), so the controls stay visible while it runs.
  await expect(page.locator('.document-page__chrome')).toBeInViewport();

  // A number beyond the end goes to the last section.
  await counter.click();
  await bubble.getByRole('textbox').fill('9999');
  await page.keyboard.press('Enter');
  await expect(counter).toHaveText(
    new RegExp(`^\\s*${String(total)}\\s*/\\s*${String(total)}\\s*$`, 'u'),
  );
});

test('the outline drawer covers the bottom bar, in z-order and while it closes', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openClinicalReader(page);
  const nav = page.locator('.app-bottom-nav');
  await expect(nav).toBeVisible();

  await page.getByRole('button', { name: 'Открыть оглавление' }).click();
  await expect(page.locator('.document-overlay-outline--open')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/reader-outline-open/u);
  // The drawer has slid in before the bar is compared with it.
  await expect
    .poll(async () => (await page.locator('.document-overlay-outline').boundingBox())?.x ?? -999)
    .toBeGreaterThanOrEqual(-1);
  // The bar steps aside; held in place, the drawer is still what the bottom of the screen shows.
  const covering = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.app-bottom-nav');
    if (!bar) throw new Error('No bottom navigation.');
    bar.style.transition = 'none';
    bar.style.transform = 'none';
    const box = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 40, box.top + box.height / 2);
    bar.style.transition = '';
    bar.style.transform = '';
    return Boolean(hit?.closest('.document-overlay-outline'));
  });
  expect(covering).toBe(true);
  // Back to its resting state (hidden) before the closing is watched.
  await expect
    .poll(async () => (await nav.boundingBox())?.y ?? PHONE.height)
    .toBeGreaterThanOrEqual(PHONE.height);

  // While the drawer slides out, the bar stays out of the way: it must not reappear over it.
  await page.evaluate(() => {
    const frames: Array<{ navTop: number; outlineRight: number }> = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    const start = performance.now();
    const sample = (): void => {
      const bar = document.querySelector('.app-bottom-nav')?.getBoundingClientRect();
      const outline = document.querySelector('.document-overlay-outline')?.getBoundingClientRect();
      if (bar && outline) frames.push({ navTop: bar.top, outlineRight: outline.right });
      if (performance.now() - start < 700) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveClass(/reader-outline-open/u);
  await page.waitForTimeout(500);
  const frames = await page.evaluate(
    () =>
      (window as unknown as { __frames: Array<{ navTop: number; outlineRight: number }> }).__frames,
  );
  expect(frames.length).toBeGreaterThan(5);
  const overlapping = frames.filter(
    (frame) => frame.outlineRight > 1 && frame.navTop < PHONE.height,
  );
  expect(overlapping).toEqual([]);
  // And it returns afterwards.
  await expect
    .poll(async () => (await nav.boundingBox())?.y ?? PHONE.height, { timeout: 5000 })
    .toBeLessThan(PHONE.height - 40);
});

test("the reader's «Меню действий» button toggles its menu", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await page.getByLabel('Загрузить документы').setInputFiles({
    name: 'план.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('План обследования.'),
  });
  await page.locator('.user-library-card').filter({ hasText: 'план' }).click();
  await expect(page.locator('.user-document-reader')).toContainText('План обследования.');

  const button = page.getByRole('button', { name: 'Меню действий' });
  const menu = page.getByRole('menu');
  await button.click();
  await expect(menu).toBeVisible();
  // The second tap closes it; the click that follows the press must not open it again.
  await button.click();
  await expect(menu).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(menu).toHaveCount(0);
  // And the button still opens it afterwards.
  await button.click();
  await expect(menu).toBeVisible();
});
