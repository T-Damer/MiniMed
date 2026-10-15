import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

// DL3: «Скачать всё» queues ~840 modules. The page draws the first rows of each group and one
// «Показать все · N» button instead of ~700 rows at once; the counts stay in the group headings.
const DOWNLOADS = `${E2E_ASSET_ORIGIN}/#/settings/downloads`;
const FAILED_TASKS = 40;

test('a long group of downloads is folded behind «Показать все» and sizes use a decimal comma', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript((count) => {
    localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    localStorage.setItem('minimed:core-download-consent:v1', '1');
    if (localStorage.getItem('long-queue-seeded')) return;
    localStorage.setItem('long-queue-seeded', '1');
    localStorage.setItem(
      'minimed.download-queue.v1',
      JSON.stringify({
        version: 1,
        tasks: Array.from({ length: count }, (_, index) => ({
          id: `file:long-queue-${index}`,
          kind: 'document',
          title: `Файл ${index + 1}`,
          state: 'failed',
          downloadedBytes: 1.4 * 1024 * 1024,
          totalBytes: 1.14 * 1024 * 1024 * 1024,
        })),
      }),
    );
  }, FAILED_TASKS);
  await page.goto(DOWNLOADS, { waitUntil: 'domcontentloaded' });
  const downloads = page.getByTestId('downloads-page');
  await expect(downloads).toBeVisible({ timeout: 60_000 });

  const attention = downloads.getByRole('region', { name: 'Требуют внимания' });
  await expect(attention.locator('.downloads-group__count')).toHaveText(String(FAILED_TASKS));
  // Only the first rows are drawn, the rest sit behind one button.
  await expect(attention.locator('.download-task')).toHaveCount(6);
  const showAll = attention.getByTestId('downloads-show-all');
  await expect(showAll).toContainText(`Показать все · ${FAILED_TASKS}`);

  // One formatter: no decimal point in any size of the page.
  const meta = await attention.locator('.download-task__meta').first().innerText();
  expect(meta).not.toMatch(/\d\.\d/u);

  await showAll.click();
  await expect(attention.locator('.download-task')).toHaveCount(FAILED_TASKS);
  await expect(showAll).toHaveCount(0);
});
