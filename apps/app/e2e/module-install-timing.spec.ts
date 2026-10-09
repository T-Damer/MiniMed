import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchReady } from './mount-built-app';

/**
 * Install-phase timings of two real modules: the 96 MiB «Красота и медицина» reference pack (630 MB
 * decoded) and the 8.9 MB antiinfective drug group (174 MB decoded). Each is installed through its
 * core pointer from the local release copy, served over HTTP so the download is not the cost under
 * test; the app records `minimed:install:*` User Timing measures (features/modules/install-timing).
 *
 *   E2E_PORT=4211 bunx playwright test module-install-timing --workers=1
 *   INSTALL_TIMING_OUT=/path/report.json   writes the per-phase table as JSON
 *
 * The budgets below are guards against a return of the slow paths on a loaded laptop, not targets.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
// Worktrees (.claude/worktrees/<name>) keep the big local data in the main checkout.
const CHECKOUTS = [ROOT, resolve(ROOT, '../../..')];
const REPORT = process.env['INSTALL_TIMING_OUT'];

interface Case {
  readonly name: string;
  readonly moduleId: string;
  readonly directories: readonly string[];
  readonly pointer: string;
  readonly target: string;
  /** Budget for everything after the download, in ms: ~5× what a loaded laptop needs now, 10× below the old full-file scans. */
  readonly installBudgetMs: number;
  /**
   * Budget for install complete -> the target painted in the reader, in ms. It no longer queues
   * behind the new module's whole-pack listings; before that it was ~4 s (drug group), ~1.5 s (pack).
   */
  readonly targetBudgetMs: number;
}

const CASES: readonly Case[] = [
  {
    name: 'drug group (8.9 MB)',
    moduleId: 'minimed.medications.antiinfectives.ru',
    directories: ['output/module-zstd-2026-10-01/esklp-compacted'],
    pointer: 'core.catalog.pointer.medication.esklp.mnn.амоксициллин-39ac47a244d081af',
    target: 'esklp.mnn.амоксициллин',
    installBudgetMs: 12_000,
    targetBudgetMs: 3_000,
  },
  {
    name: 'reference pack (96 MiB)',
    moduleId: 'minimed.reference.krasotaimedicina.ru',
    directories: ['data/build/krasotaimedicina-module/release'],
    pointer:
      'core.catalog.pointer.reference.krasotaimedicina.disease.0007ef852d70ba32-82f435504305e1c9',
    target: 'krasotaimedicina.disease.0007ef852d70ba32',
    installBudgetMs: 30_000,
    targetBudgetMs: 1_200,
  },
];

const route = (id: string): string =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

function localFile(directories: readonly string[], fileName: string): string | undefined {
  for (const root of CHECKOUTS) {
    for (const directory of directories) {
      const path = resolve(root, directory, fileName);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

interface Measure {
  readonly name: string;
  readonly start: number;
  readonly duration: number;
}

for (const scenario of CASES) {
  test(`installs the ${scenario.name} within its post-download budget`, async ({ page }) => {
    test.setTimeout(900_000);
    const catalog = ContentModuleCatalogSchema.parse(
      JSON.parse(
        await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
      ),
    );
    const artifact = catalog.modules
      .find((module) => module.id === scenario.moduleId)
      ?.artifacts.find((entry) => entry.kind === 'index');
    if (!artifact?.url) throw new Error(`No index artifact for ${scenario.moduleId}`);
    const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
    const filePath = localFile(scenario.directories, fileName);
    test.skip(!filePath, `The published module file ${fileName} is local-only.`);
    if (!filePath) return;
    expect(await sha256File(filePath)).toBe(artifact.sha256);

    // Large files go over HTTP: a CDP message stops at 100 MiB.
    const server = createServer((_request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Content-Type', 'application/zstd');
      createReadStream(filePath).pipe(response);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const moduleUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/module.zst`;
    try {
      const small = (await stat(filePath)).size < 50 * 1024 * 1024;
      const smallBody = small ? await readFile(filePath) : undefined;
      await page.route(
        (url) => url.pathname.endsWith(`/${fileName}`),
        (request) =>
          smallBody
            ? request.fulfill({ body: smallBody, contentType: 'application/zstd' })
            : request.continue({ url: moduleUrl }),
      );
      await mountBuiltApp(page, {
        skipLargeCompanionPacks: true,
        localStorage: {
          'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
        },
      });
      await waitForSearchReady(page);
      await page.goto(route(scenario.pointer));
      await page.evaluate(() => {
        (window as unknown as { __routeSwappedAt?: number }).__routeSwappedAt = undefined;
        window.addEventListener('hashchange', () => {
          const holder = window as unknown as { __routeSwappedAt?: number };
          holder.__routeSwappedAt ??= performance.now();
        });
      });
      const install = page.locator('.document-module-pointer__action');
      await expect(install).toBeVisible({ timeout: 60_000 });
      const clickedAt = await page.evaluate(() => performance.now());
      await install.click();
      await expect(page).toHaveURL(route(scenario.target), { timeout: 600_000 });
      await page.waitForFunction(
        () => performance.getEntriesByName('minimed:install:target-first-paint').length > 0,
        undefined,
        { timeout: 60_000 },
      );

      const { measures, marks, swappedAt } = await page.evaluate(() => ({
        measures: performance
          .getEntriesByType('measure')
          .filter((entry) => entry.name.startsWith('minimed:install:'))
          .map((entry) => ({
            name: entry.name.replace('minimed:install:', ''),
            start: entry.startTime,
            duration: entry.duration,
          })),
        marks: performance
          .getEntriesByType('mark')
          .filter((entry) => entry.name.startsWith('minimed:install:state:'))
          .map((entry) => ({
            name: entry.name.replace('minimed:install:', ''),
            start: entry.startTime,
            duration: 0,
          })),
        swappedAt: (window as unknown as { __routeSwappedAt?: number }).__routeSwappedAt ?? null,
      }));
      const entries: Measure[] = [...measures, ...marks]
        .filter((entry) => entry.start >= clickedAt - 1)
        .toSorted((left, right) => left.start - right.start);
      const downloadEnd = entries.find((entry) => entry.name === 'download');
      const completed = entries.find((entry) => entry.name === 'state:completed');
      expect(downloadEnd).toBeDefined();
      expect(completed).toBeDefined();
      const targetPaint = entries.find((entry) => entry.name === 'target-first-paint');
      expect(targetPaint).toBeDefined();
      const origin = (downloadEnd?.start ?? 0) + (downloadEnd?.duration ?? 0);
      const rows = entries.map((entry) => ({
        phase: entry.name,
        startMs: Math.round(entry.start - origin),
        durationMs: Math.round(entry.duration),
      }));
      const installMs = Math.round((completed?.start ?? 0) - origin);
      const reload = entries.find((entry) => entry.name === 'core-reload');
      const reloadEnd = reload ? reload.start + reload.duration - origin : null;
      const summary = {
        scenario: scenario.name,
        installMs,
        coreReloadMs: reload ? Math.round(reload.duration) : null,
        routeSwappedMs: swappedAt === null ? null : Math.round(swappedAt - origin),
        reloadEndMs: reloadEnd === null ? null : Math.round(reloadEnd),
        // Install complete -> the target document painted in the reader.
        targetPaintMs: Math.round(targetPaint?.duration ?? 0),
        phases: rows,
      };
      console.log(`\n=== ${scenario.name} (after download, ms) ===`);
      for (const row of rows) {
        console.log(
          `${row.phase.padEnd(24)} start ${String(row.startMs).padStart(8)}  took ${String(row.durationMs).padStart(8)}`,
        );
      }
      console.log(
        `installed ${installMs} ms after the download; core reload ${summary.coreReloadMs ?? '-'} ms; route swapped at ${summary.routeSwappedMs ?? '-'} ms; target painted ${summary.targetPaintMs} ms after the install completed`,
      );
      if (REPORT) {
        const path = REPORT.replace(/\.json$/u, `.${scenario.moduleId}.json`);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(summary, null, 2));
      }
      expect(installMs).toBeLessThan(scenario.installBudgetMs);
      expect(summary.targetPaintMs).toBeLessThan(scenario.targetBudgetMs);
      await expect(page.locator('.document-module-pointer__error')).toHaveCount(0);
    } finally {
      server.close();
    }
  });
}
