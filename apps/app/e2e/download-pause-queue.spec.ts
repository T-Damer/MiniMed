import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

// DL3: a reload with the queue paused leaves a durable queue (the pending-install list and the
// journal). «Продолжить» then finishes every module of it, with no error row. The calculator-pack
// modules are small committed files, so the queue is real: real catalog entries, real bytes, real
// install, validation and activation.
const ROOT = resolve(import.meta.dirname, '../../..');
const DOWNLOADS = `${E2E_ASSET_ORIGIN}/#/settings/downloads`;
const PACKS = 8;

const catalog = ContentModuleCatalogSchema.parse(
  JSON.parse(
    readFileSync(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
  ),
);
const packs = catalog.modules
  .filter((module) => module.kind === 'tool' && module.releaseState === 'published')
  .slice(0, PACKS)
  .map((module) => {
    const artifact = module.artifacts[0];
    if (!artifact?.url) throw new Error(`Module ${module.id} has no artifact.`);
    const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
    const bytes = readFileSync(resolve(ROOT, 'apps/app/public/content/modules', fileName));
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
    return { id: module.id, version: module.version, title: module.title, fileName, bytes };
  });

test('after a reload with the queue paused, resume finishes every module with no error', async ({
  page,
}) => {
  test.setTimeout(240_000);
  expect(packs).toHaveLength(PACKS);
  await page.setViewportSize({ width: 375, height: 812 });
  const requested: string[] = [];
  await page.route(
    (url) => packs.some((pack) => url.pathname.endsWith(`/${pack.fileName}`)),
    (route) => {
      const fileName = new URL(route.request().url()).pathname.split('/').at(-1);
      requested.push(fileName ?? '');
      const pack = packs.find((candidate) => candidate.fileName === fileName);
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: pack?.bytes ?? Buffer.alloc(0),
      });
    },
  );
  await page.addInitScript(
    (seed) => {
      localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
      localStorage.setItem('minimed:core-download-consent:v1', '1');
      if (localStorage.getItem('queue-resume-seeded')) return;
      localStorage.setItem('queue-resume-seeded', '1');
      // What a reload leaves behind when the queue was paused with every module still moving.
      localStorage.setItem(
        'minimed.pending-module-installs.v1',
        JSON.stringify(
          seed.map((pack) => ({
            moduleId: pack.id,
            version: pack.version,
            includeSourceAssets: false,
            queuedAt: '2026-10-15T00:00:00.000Z',
          })),
        ),
      );
      localStorage.setItem(
        'minimed.download-queue.v1',
        JSON.stringify({
          version: 1,
          paused: true,
          tasks: seed.map((pack) => ({
            id: `module:${pack.id}@${pack.version}`,
            kind: 'module',
            title: pack.title,
            state: 'downloading',
            downloadedBytes: 1_000,
            totalBytes: 500_000,
          })),
        }),
      );
    },
    packs.map(({ id, version, title }) => ({ id, version, title })),
  );

  await page.goto(DOWNLOADS, { waitUntil: 'domcontentloaded' });
  const downloads = page.getByTestId('downloads-page');
  const toggle = downloads.getByTestId('downloads-pause-toggle');
  await expect(toggle).toHaveAccessibleName('Продолжить загрузки', { timeout: 90_000 });
  await expect(downloads.locator('.download-task[data-download-state="paused"]')).toHaveCount(
    PACKS,
    { timeout: 60_000 },
  );
  // The hero says so as well: «На паузе», not «Скачиваем…».
  await expect(downloads.getByTestId('full-download-offer')).toContainText('На паузе', {
    timeout: 60_000,
  });
  await expect(downloads.getByTestId('full-download-offer')).not.toContainText('Скачиваем');
  // Held: no module bytes are requested while paused.
  await page.waitForTimeout(2_000);
  expect(requested).toHaveLength(0);

  await toggle.click();
  await expect
    .poll(
      () =>
        page.evaluate(
          (ids) => {
            const raw = localStorage.getItem('localmed.installed-modules.v1');
            const entries = raw ? (JSON.parse(raw).entries ?? []) : [];
            return ids.filter((id) =>
              entries.some((entry: { moduleId: string }) => entry.moduleId === id),
            ).length;
          },
          packs.map((pack) => pack.id),
        ),
      { timeout: 180_000, intervals: [500] },
    )
    .toBe(PACKS);
  await expect(downloads.locator('.download-task[data-download-state="failed"]')).toHaveCount(0);
  await expect(downloads.locator('.download-task[data-download-state="interrupted"]')).toHaveCount(
    0,
  );
  // Nothing is held any more, and the queue says so.
  await expect(downloads.locator('.downloads-overview__title')).toHaveText(
    'Все загрузки завершены',
    { timeout: 30_000 },
  );
});
