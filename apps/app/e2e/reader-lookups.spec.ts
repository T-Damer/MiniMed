import { expect, test } from '@playwright/test';
import {
  E2E_ASSET_ORIGIN,
  mountBuiltApp,
  waitForSearchEditable,
  waitForSearchReady,
} from './mount-built-app';

const pointerId =
  'core.catalog.pointer.medication.esklp.mnn.аскорбиновая-кислота-парацетамол-bfbe39d48f8ac5dc';

test('a medication lookup preserves the reader position and shows a short drug card', async ({
  page,
}) => {
  // The pointer document opens once the core has (`waitForSearchReady`, its own 120 s bound).
  test.setTimeout(240_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await waitForSearchReady(page);
  const token = Buffer.from(pointerId).toString('base64url');
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/d/${token}`);
  const link = page
    .locator('.document-text-chunk .document-inline-link')
    .filter({ hasText: /^АСКОРБИНОВАЯ КИСЛОТА$/u })
    .first();
  await link.waitFor();
  await link.scrollIntoViewIfNeeded();
  const url = page.url();
  await link.click();
  const preview = page.locator('.document-inline-preview__card');
  await expect(preview).toBeVisible();
  // Substance, group/ATC and trade names from the pointer and the drug index; no per-form lines.
  await expect(preview.locator('.medication-link-summary')).toBeVisible();
  await expect(preview).toContainText(/Торговые названия/u);
  await expect(preview).toContainText(/АТХ [A-Z]\d{2}/u);
  await expect(preview).not.toContainText(/форма\/дозировка|Открыть фрагмент источника/u);
  expect(page.url()).toBe(url);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(link).toBeInViewport();
});

// A found fragment opens its document in the reader (owner phone QA 2026-10-20, e06f0ee48); the
// search's old «source context» card is no longer shown, so the lookup is checked in that reader.
test('a drug found in search opens in the reader with the same inline medication lookup', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  // The field takes a query while the core opens; the result wait below covers the search only.
  await waitForSearchEditable(page);
  await page.getByTestId('search-input').fill('АСКОРБИНОВАЯ КИСЛОТА ПАРАЦЕТАМОЛ');
  const result = page
    .locator('.result-group')
    .filter({ has: page.getByText('АСКОРБИНОВАЯ КИСЛОТА+ПАРАЦЕТАМОЛ', { exact: true }) })
    .getByTestId('search-result')
    .filter({ hasText: /Действующее вещество/u })
    .first();
  await result.waitFor({ timeout: 30_000 });
  await result.click();
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
  const link = page
    .locator('.document-text-chunk .document-inline-link')
    .filter({ hasText: /^АСКОРБИНОВАЯ КИСЛОТА$/u })
    .first();
  await link.scrollIntoViewIfNeeded();
  await link.click();
  // A short drug card: names, group/ATC, «Открыть» — no registry codes or per-form source links.
  const card = page.locator('.document-inline-preview__card');
  // The card opens on «Открываем локальные данные…» while the drug index answers; on a loaded
  // machine that takes longer than the default wait.
  await expect(card.locator('.medication-link-summary')).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText(/Торговые названия|АТХ/u);
  await expect(card).not.toContainText(/smnnCode|\d{2}\.\d{2}\.\d{2}\.\d{3}-/u);
  await expect(card.getByRole('button', { name: /Открыть/u })).toBeVisible();
  await expect(page.getByTestId('reader-context')).toHaveCount(0);
});
