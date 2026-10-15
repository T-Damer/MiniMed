import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

// DL3: the meaning-search model (130 MB) was left «Прервано перезапуском» after a reload and never
// resumed. Its task now carries a restore recipe, so the app picks it up again by itself.
const DOWNLOADS = `${E2E_ASSET_ORIGIN}/#/settings/downloads`;
const MODEL_ID = 'model:minimed/kd1-query-encoder@kd1-query-encoder-2026.10.11.2';
const MODEL_REVISION = 'kd1-query-encoder-2026.10.11.2';

test('a reload during the meaning-search model download resumes it without a tap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const modelRequests: string[] = [];
  await page.route(
    (url) => url.href.includes(`/datasets/${MODEL_REVISION}/`),
    (route) => {
      modelRequests.push(route.request().url());
      // Held: the download stays in flight, so the row can be inspected.
      return new Promise(() => undefined);
    },
  );
  await page.addInitScript(
    ({ id, revision }) => {
      localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
      localStorage.setItem('minimed:core-download-consent:v1', '1');
      if (localStorage.getItem('model-resume-seeded')) return;
      localStorage.setItem('model-resume-seeded', '1');
      // What a reload leaves: the model task was downloading when the page went away.
      localStorage.setItem(
        'minimed.download-queue.v1',
        JSON.stringify({
          version: 1,
          tasks: [
            {
              id,
              kind: 'model',
              title: 'Поиск по смыслу',
              state: 'downloading',
              downloadedBytes: 5_000_000,
              totalBytes: 130_000_000,
              resume: { kind: 'semantic-model', id, version: revision },
            },
          ],
        }),
      );
    },
    { id: MODEL_ID, revision: MODEL_REVISION },
  );
  await page.goto(DOWNLOADS, { waitUntil: 'domcontentloaded' });
  const row = page.locator(`.download-task[data-download-id="${MODEL_ID}"]`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  // Not «Прервано перезапуском»: the restorer started the download again.
  await expect(row).toHaveAttribute('data-download-state', /^(queued|downloading)$/u, {
    timeout: 60_000,
  });
  await expect.poll(() => modelRequests.length, { timeout: 60_000 }).toBeGreaterThan(0);
});
