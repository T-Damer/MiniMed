import { expect, type Page, test } from '@playwright/test';
import {
  CLINICAL_DOCUMENT_ROUTE,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import { mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// NAV1 in the document reader: a jump through the contents is a history step, the inline link
// preview is a layer, the «Поиск» crumb is a step back to the search, and the places come back.

const DOCUMENT_HASH = new URL(CLINICAL_DOCUMENT_ROUTE).hash;
const TERM = 'инфаркт миокарда';

interface Snapshot {
  readonly scrollY: number;
  readonly entries: number;
  readonly hash: string;
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    entries: window.history.length,
    hash: window.location.hash,
  }));

async function openDocumentFromSearch(page: Page): Promise<void> {
  await installClinicalModule(page);
  await page.evaluate(() => {
    window.location.hash = '#/search';
  });
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, DOCUMENT_HASH);
  await expect(page.locator('.document-overlay-section').first()).toBeVisible();
  // Give the idle batches time to mount the rest of the sections.
  await page.waitForTimeout(2500);
}

test.describe('document reader navigation', () => {
  test.beforeEach(async ({ page }) => {
    await routeClinicalModule(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
    await waitForSearchEditable(page);
  });

  test('a jump through the contents is a history step: back returns to the place in the same document', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openDocumentFromSearch(page);
    const atTop = await snapshot(page);
    expect(atTop.hash).toBe(DOCUMENT_HASH);

    await page.getByRole('button', { name: 'Открыть оглавление' }).first().click();
    const items = page.locator('.document-overlay-outline-section-button');
    await expect(items.nth(3)).toBeVisible();
    await items.nth(3).click();
    await expect.poll(async () => (await snapshot(page)).scrollY).toBeGreaterThan(300);
    const jumped = await snapshot(page);
    expect(jumped.hash).toBe(DOCUMENT_HASH);
    expect(jumped.entries).toBe(atTop.entries + 1);

    // Back (the system's) returns to where the reader was, in the same document.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DOCUMENT_HASH}$`, 'u'));
    await expect
      .poll(async () => (await snapshot(page)).scrollY)
      .toBeLessThan(jumped.scrollY - 200);
    await expect(page.locator('.document-overlay-section').first()).toBeAttached();

    // Forward returns to the section jumped to; the in-app ‹ steps back the same way.
    await page.goForward();
    await expect.poll(async () => (await snapshot(page)).scrollY).toBeGreaterThan(300);
    await page.getByRole('button', { name: 'Назад' }).first().click();
    await expect(page).toHaveURL(new RegExp(`${DOCUMENT_HASH}$`, 'u'));
    await expect
      .poll(async () => (await snapshot(page)).scrollY)
      .toBeLessThan(jumped.scrollY - 200);
    expect((await snapshot(page)).entries).toBe(jumped.entries);

    // One more back leaves the document for the search it was opened from.
    await page.getByRole('button', { name: 'Назад' }).first().click();
    await expect(page.getByTestId('search-input')).toBeVisible();
    expect((await snapshot(page)).entries).toBe(jumped.entries);
  });

  test('an inline link preview is a layer: back closes it and the document stays', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openDocumentFromSearch(page);
    const link = page.locator('.document-inline-link', { hasText: TERM }).first();
    await link.scrollIntoViewIfNeeded();
    const before = await snapshot(page);
    await link.click();
    await expect(page.locator('.document-inline-preview__card')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.document-inline-preview__card')).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.hash).toBe(DOCUMENT_HASH);
    expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThan(60);
    // The document is still there: one more back is the search, not an empty step.
    await page.goBack();
    await expect(page.getByTestId('search-input')).toBeVisible();
  });

  test('the «Поиск» crumb is a step back to the search; back returns to the reader', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openDocumentFromSearch(page);
    const crumb = page.locator('.document-crumbs__link', { hasText: 'Поиск' }).first();
    await expect(crumb).toBeVisible();
    const entries = (await snapshot(page)).entries;
    await crumb.click();
    await expect(page.getByTestId('search-input')).toBeVisible();
    expect((await snapshot(page)).entries).toBe(entries);
    // The crumb stepped back to the search; going forward returns to the reader.
    await page.goForward();
    await expect(page.locator('.document-overlay-section').first()).toBeVisible();
    expect((await snapshot(page)).hash).toBe(DOCUMENT_HASH);
  });

  test('a document comes back at the place it was left, after the contents jump and a reload of the app', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openDocumentFromSearch(page);
    await page.evaluate(() => window.scrollTo({ top: 4200, behavior: 'instant' }));
    await page.waitForTimeout(900);
    const left = (await snapshot(page)).scrollY;
    expect(left).toBeGreaterThan(3000);
    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
    await expect(page).toHaveURL(/#\/settings$/u);
    await page.goBack();
    await expect(page.locator('.document-overlay-section').first()).toBeAttached();
    await expect
      .poll(async () => Math.abs((await snapshot(page)).scrollY - left), { timeout: 15_000 })
      .toBeLessThan(40);
  });
});
