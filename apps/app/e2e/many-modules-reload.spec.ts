import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { chromium, expect, test } from '@playwright/test';
import { LOCAL_DATA_ROOT } from './local-data';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

/**
 * MEM1: the search core after a reload with many modules installed. Every small module used to be
 * deserialized into the 2 GB wasm heap of the main thread; with the full recommendation set
 * (774 modules, 1.65 GB) the heap ran out and every search failed with SQLITE_NOMEM. Modules now
 * live as files of one OPFS pool opened by one worker (`composition/module-shelf.ts`).
 *
 * `MEM1_MODULES=774` runs the whole set (about a minute). The default is a quick slice. The browser
 * is a persistent profile on purpose: Playwright's default contexts are incognito, where OPFS is
 * served over IPC and a read costs ten times what it does for a person, so latency measured there
 * says nothing about the app.
 */
const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');
const DIRECTORY = resolve(LOCAL_DATA_ROOT, 'output/module-zstd-kd1-2026-10-11');
const COUNT = Number(process.env['MEM1_MODULES'] ?? 120);

interface Seed {
  readonly moduleId: string;
  readonly version: string;
  readonly file: string;
}

async function seeds(): Promise<readonly Seed[]> {
  const catalog = ContentModuleCatalogSchema.parse(
    JSON.parse(
      await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
    ),
  );
  const present = new Set(readdirSync(DIRECTORY));
  const result: Seed[] = [];
  for (const module of catalog.modules) {
    const artifact = module.artifacts.find((item) => item.kind === 'index');
    const file = artifact?.url ? new URL(artifact.url).pathname.split('/').at(-1) : undefined;
    if (module.kind === 'clinical' && file && present.has(file)) {
      result.push({ moduleId: module.id, version: module.version, file });
    }
  }
  return result.slice(0, COUNT);
}

/** Resident memory (MB) of the browser started with `profile` and every process it spawned. */
async function browserRssMb(profile: string): Promise<number> {
  const { stdout } = await run('ps', ['-Ao', 'pid=,ppid=,rss=,command=']);
  const rows = stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      parent: Number(match[2]),
      rss: Number(match[3]),
      command: match[4] ?? '',
    }));
  const owned = new Set(rows.filter((row) => row.command.includes(profile)).map((row) => row.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!owned.has(row.pid) && owned.has(row.parent)) {
        owned.add(row.pid);
        grew = true;
      }
    }
  }
  return Math.round(
    rows.filter((row) => owned.has(row.pid)).reduce((total, row) => total + row.rss, 0) / 1024,
  );
}

const ALL_QUERIES = [
  'бронхиальная астма у детей',
  'сахарный диабет 2 типа лечение',
  'артериальная гипертензия',
  'пневмония у взрослых',
  'острый коронарный синдром',
  'хроническая сердечная недостаточность',
  'язвенная болезнь желудка',
  'инфаркт миокарда',
  'ревматоидный артрит',
  'эпилепсия',
  'депрессия',
  'рак молочной железы',
  'гепатит С',
  'анемия',
  'инсульт',
  'атопический дерматит',
  'катаракта',
  'преэклампсия',
  'остеоартрит',
  'панкреатит',
];
const QUERIES = ALL_QUERIES.slice(0, Number(process.env['MEM1_QUERIES'] ?? ALL_QUERIES.length));

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

test(`search survives a reload with ${COUNT} installed modules`, async () => {
  test.skip(!existsSync(DIRECTORY), 'The published KD1 module copy is local-only.');
  test.setTimeout(900_000);
  const list = await seeds();
  const profile = mkdtempSync(join(tmpdir(), 'mem1-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ['--mute-audio'],
    serviceWorkers: 'block',
  } as never);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.route(`${E2E_ASSET_ORIGIN}/__seed/*`, async (route) => {
      const file = decodeURIComponent(
        new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
      );
      const { stdout } = await run('zstd', ['-dc', resolve(DIRECTORY, file)], {
        encoding: 'buffer',
        maxBuffer: 256 * 1024 * 1024,
      });
      await route.fulfill({ body: stdout, contentType: 'application/octet-stream' });
    });
    const problems: string[] = [];
    page.on('console', (message) => {
      if (/NOMEM|out of memory|sqlite3_step/iu.test(message.text())) problems.push(message.text());
    });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForSearchEditable(page);

    // The library as an app without the shelf left it: every index as bytes in IndexedDB.
    await page.evaluate(async (items) => {
      const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
        const request = indexedDB.open('minimed-content-modules-v1', 2);
        request.onsuccess = () => resolveDb(request.result);
        request.onerror = () => reject(request.error);
      });
      for (let start = 0; start < items.length; start += 8) {
        const rows = await Promise.all(
          items.slice(start, start + 8).map(async (item) => {
            const response = await fetch(`/__seed/${encodeURIComponent(item.file)}`);
            return { item, blob: new Blob([await response.arrayBuffer()]) };
          }),
        );
        const transaction = database.transaction(['versions', 'active'], 'readwrite');
        for (const { item, blob } of rows) {
          transaction.objectStore('versions').put({
            key: `${item.moduleId}@${item.version}`,
            moduleId: item.moduleId,
            version: item.version,
            bytes: blob,
            sourceSetDigest: '',
            installedAt: new Date().toISOString(),
          });
          transaction.objectStore('active').put({ moduleId: item.moduleId, version: item.version });
        }
        await new Promise<void>((resolveTx, reject) => {
          transaction.oncomplete = () => resolveTx();
          transaction.onerror = () => reject(transaction.error);
        });
      }
      database.close();
    }, list);

    // The first start writes every module onto the shelf and drops its IndexedDB copy.
    const firstStartAt = Date.now();
    await page.reload();
    await waitForSearchEditable(page);
    const firstStartMs = Date.now() - firstStartAt;
    const rows = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
        const request = indexedDB.open('minimed-content-modules-v1', 2);
        request.onsuccess = () => resolveDb(request.result);
        request.onerror = () => reject(request.error);
      });
      const all = await new Promise<{ bytes?: unknown; indexStorage?: string }[]>(
        (resolveRows, reject) => {
          const request = database.transaction('versions').objectStore('versions').getAll();
          request.onsuccess = () => resolveRows(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      database.close();
      return {
        total: all.length,
        shelf: all.filter((row) => row.indexStorage === 'shelf').length,
        withBytes: all.filter((row) => row.bytes !== undefined).length,
      };
    });
    expect(rows).toEqual({ total: list.length, shelf: list.length, withBytes: 0 });

    // A later start only opens the files: no payload moves, nothing is written.
    const startedAt = Date.now();
    await page.reload();
    await waitForSearchEditable(page);
    const startupMs = Date.now() - startedAt;
    const phases = await page.evaluate(() =>
      Object.fromEntries(
        performance
          .getEntriesByType('measure')
          .filter((entry) => entry.name.startsWith('minimed:install:core-'))
          .map((entry) => [entry.name.replace('minimed:install:', ''), Math.round(entry.duration)]),
      ),
    );
    const rssStartMb = await browserRssMb(profile);

    const input = page.getByTestId('search-input');
    const timings: number[] = [];
    const failures: string[] = [];
    for (const query of QUERIES) {
      await input.fill(query);
      const queryStartedAt = Date.now();
      await input.press('Enter');
      await page.waitForTimeout(200);
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="search-submit"]')?.getAttribute('aria-busy') !==
          'true',
        undefined,
        { timeout: 120_000 },
      );
      timings.push(Date.now() - queryStartedAt);
      failures.push(...(await page.locator('.error-card').allInnerTexts()));
      if (failures.length === 0) {
        await expect(page.getByTestId('search-result').first()).toBeVisible();
      }
    }
    const rssEndMb = await browserRssMb(profile);
    const session = await context.newCDPSession(page);
    const heap = (await session.send('Runtime.getHeapUsage')) as {
      usedSize: number;
      totalSize: number;
    };
    console.log(
      `MEM1RESULT ${JSON.stringify({
        modules: list.length,
        firstStartMs,
        startupMs,
        phases,
        firstQueryMs: timings[0],
        medianQueryMs: median(timings),
        rssStartMb,
        rssEndMb,
        mainJsHeapMb: Math.round(heap.usedSize / 1048576),
        failures: failures.length,
      })}`,
    );
    expect(problems).toEqual([]);
    expect(failures).toEqual([]);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
