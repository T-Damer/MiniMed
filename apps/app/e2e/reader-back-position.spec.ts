import { expect, type Page, test } from '@playwright/test';
import {
  CLINICAL_DOCUMENT_ROUTE,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const DOCUMENT_HASH = new URL(CLINICAL_DOCUMENT_ROUTE).hash;
const TERM = 'Парадоксальная эмболия';

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

/** The reading position the reader saved on the current history entry. */
const savedPosition = (page: Page) =>
  page.evaluate(() => {
    const state = window.history.state as {
      minimedEntry?: { position?: { anchor: string; offset: number } };
    } | null;
    return state?.minimedEntry?.position ?? null;
  });

/** Pixels the section has passed its aligned start now: the number a saved position stores. */
const offsetWithin = (page: Page, anchor: string) =>
  page.evaluate((id) => {
    const section = document.getElementById(id);
    if (!section) return null;
    const margin = Number.parseFloat(getComputedStyle(section).scrollMarginTop);
    return Math.round((Number.isFinite(margin) ? margin : 0) - section.getBoundingClientRect().top);
  }, anchor);

/**
 * Installs the clinical module (its document is the reader's «A»), then reaches A the way a link
 * does: search first, then a pushed document address, so the entry below A belongs to the app.
 */
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

/**
 * Scrolls to the term link in A, opens its card and then the card's document. Returns the place the
 * reader had reached in A (saved on A's entry by the tap on the link).
 */
async function openTermDocument(page: Page): Promise<{ anchor: string; offset: number }> {
  const link = page.locator('.document-inline-link', { hasText: TERM }).first();
  await link.scrollIntoViewIfNeeded();
  expect((await snapshot(page)).scrollY).toBeGreaterThan(1000);
  await link.click();
  const left = await savedPosition(page);
  expect(left).not.toBeNull();
  await page.locator('.document-inline-preview__open').first().click();
  await expect(page).not.toHaveURL(new RegExp(`${DOCUMENT_HASH}$`, 'u'));
  return left ?? { anchor: '', offset: 0 };
}

/** The reading place of `left` is on screen again, to within a few pixels. */
async function expectPlaceRestored(
  page: Page,
  left: { anchor: string; offset: number },
): Promise<void> {
  // The page above the section is estimated until it renders, so the raw scroll offset may differ a
  // little; the section under the reading line and the distance into it do not.
  await expect
    .poll(async () => Math.abs(((await offsetWithin(page, left.anchor)) ?? 9999) - left.offset), {
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(4);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${String(viewport.width)} px`, () => {
    test.beforeEach(async ({ page }) => {
      await routeClinicalModule(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
      await waitForSearchEditable(page);
    });

    test('a document opened from a link starts at its top; the app back returns to the place and pops the history', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await openDocumentFromSearch(page);
      const entriesAtA = (await snapshot(page)).entries;

      const left = await openTermDocument(page);

      // B starts at its top - not at the scroll A had, clamped into B's short loading page.
      for (const waitMs of [100, 600, 1800]) {
        await page.waitForTimeout(waitMs);
        expect((await snapshot(page)).scrollY).toBe(0);
      }
      const opened = await snapshot(page);
      expect(opened.entries).toBe(entriesAtA + 1);
      await expect(page.locator('.document-overlay-paper__title').first()).toBeInViewport();

      // The app's back pops: A returns, the history does not grow.
      await page.getByRole('button', { name: 'Назад' }).first().click();
      await expect(page).toHaveURL(new RegExp(`${DOCUMENT_HASH}$`, 'u'));
      await expect(page.locator('.document-overlay-section').first()).toBeAttached();
      await expectPlaceRestored(page, left);
      const back = await snapshot(page);
      expect(back.entries).toBe(entriesAtA + 1);
      expect(back.scrollY).toBeGreaterThan(1000);

      // And once more: back to the search, still without growing; a system back then leaves to the
      // page before the document, not to a document that was just left.
      await page.getByRole('button', { name: 'Назад' }).first().click();
      await expect(page.getByTestId('search-input')).toBeVisible();
      expect(new URL(page.url()).hash).not.toContain('/modules/documents/d/');
      expect((await snapshot(page)).entries).toBe(entriesAtA + 1);
      await page.goBack();
      await expect(page.locator('.document-overlay-section').first()).toBeVisible();
      expect((await snapshot(page)).entries).toBe(entriesAtA + 1);
    });

    test('the system back and forward follow the same path: places restored, breadcrumbs follow', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await openDocumentFromSearch(page);
      const crumbsAtA = await page.locator('.document-crumbs__item').count();
      const left = await openTermDocument(page);
      await page.waitForTimeout(800);
      const crumbsAtB = await page.locator('.document-crumbs__item').count();
      expect(crumbsAtB).toBeGreaterThan(crumbsAtA);

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${DOCUMENT_HASH}$`, 'u'));
      await expectPlaceRestored(page, left);
      // The breadcrumbs are those of A again, not A and the document just left.
      await expect(page.locator('.document-crumbs__item')).toHaveCount(crumbsAtA);

      // Forward returns to the term document, again from its top.
      await page.goForward();
      await expect(page).not.toHaveURL(new RegExp(`${DOCUMENT_HASH}$`, 'u'));
      await page.waitForTimeout(1500);
      expect((await snapshot(page)).scrollY).toBe(0);

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${DOCUMENT_HASH}$`, 'u'));
      await page.goBack();
      await expect(page.getByTestId('search-input')).toBeVisible();
    });
  });
}

test('a deep-linked document has nothing to go back to: the app back replaces it with its origin', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeClinicalModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, splitNavigation: false });
  await waitForSearchEditable(page);
  await installClinicalModule(page);
  // A fresh page load on the document address, as a shared link or a notification opens it: the
  // entry before it belongs to another page, so the app has nothing of its own to go back to.
  await page.goto('about:blank');
  await page.goto(CLINICAL_DOCUMENT_ROUTE);
  await expect(page.locator('.document-overlay-section').first()).toBeVisible({ timeout: 60_000 });
  const entries = (await snapshot(page)).entries;

  await page.getByRole('button', { name: 'Назад' }).first().click();
  await expect(page.getByTestId('search-input')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/search');
  // The entry was replaced, not stacked on.
  expect((await snapshot(page)).entries).toBe(entries);
  expect(page.url().startsWith(E2E_ASSET_ORIGIN)).toBe(true);
});
