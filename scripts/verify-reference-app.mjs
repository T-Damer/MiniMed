import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer, loadConfigFromFile } from 'vite';

const root = resolve(import.meta.dirname, '..');
const appRoot = resolve(root, 'apps/app');
const output = resolve(root, 'data/build/reference-app-check');
await mkdir(output, { recursive: true });
// Only the existing synthetic demo is used as the core. Public reference inputs are built separately.
const fixture = spawnSync(
  'uv',
  [
    'run',
    '--project',
    'tools/ingest',
    'python',
    '-c',
    `
import json
from pathlib import Path
from localmed_ingest.models import ContentPack
from localmed_ingest.sqlite_builder import write_sqlite_pack
raw=json.loads(Path('packages/test-fixtures/src/generated/core-demo.json').read_text())
raw={key:raw[key] for key in ['manifest','documents','aliases','embeddingProfiles','embeddings'] if key in raw}
raw['manifest']['schemaVersion']=2
write_sqlite_pack(ContentPack.model_validate(raw), Path('data/build/reference-app-check/core.db'))
`,
  ],
  { cwd: root, stdio: 'inherit' },
);
assert.equal(fixture.status, 0, 'Synthetic core must build with the existing ingester.');
const core = await readFile(resolve(output, 'core.db'));
const checksum = 'sha256:' + createHash('sha256').update(core).digest('hex');
const descriptor = JSON.parse(
  await readFile(
    resolve(appRoot, 'src/features/modules/catalog.definition-reference.local.json'),
    'utf8',
  ),
);
const sourceManifest = JSON.parse(
  await readFile(resolve(root, 'content/definition-drafts/source-inputs.json'), 'utf8'),
);
assert.equal(descriptor.module.definitionReference.entries, sourceManifest.entries);
const archive = await readFile(
  resolve(appRoot, 'public/content/definition-reference', descriptor.fileName),
);
let coreGets = 0;
let referenceGets = 0;
let blockDatabaseReads = false;
const config = await loadConfigFromFile(
  { command: 'serve', mode: 'development' },
  resolve(appRoot, 'vite.config.ts'),
);
assert(config);
// Viewer/OCR assets are outside this browser slice. Keep the real App, Solid transform, aliases,
// SQLite worker and headers; omit unrelated asset preparation instead of downloading OCR models.
const plugins = config.config.plugins
  .flat(Infinity)
  .filter(
    (plugin) =>
      !plugin ||
      ![
        'ensure-tessdata-assets',
        'ensure-pdfjs-assets',
        'ensure-cornerstone-codec-assets',
      ].includes(plugin.name),
  );
plugins.push({
  name: 'reference-check-receipt-bound-test-server',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      let bytes;
      let delay = 0;
      if (path === '/content/core-report.json') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ outputChecksum: checksum }));
        return;
      }
      if (path === '/content/core.db') {
        if (request.method !== 'HEAD') coreGets += 1;
        bytes = core;
        delay = 50;
      } else if (path === `/content/definition-reference/${descriptor.fileName}`) {
        if (request.method !== 'HEAD') referenceGets += 1;
        bytes = archive;
        delay = 1;
      } else if (/^\/content\/[^/]+\.db$/u.test(path)) {
        // The synthetic core has no packaged clinical/medication companions.
        response.statusCode = 404;
        response.end();
        return;
      } else {
        next();
        return;
      }
      if (blockDatabaseReads) {
        response.statusCode = 503;
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/octet-stream');
      response.setHeader('content-length', bytes.length);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      let offset = 0;
      let timer;
      const send = () => {
        if (response.destroyed) return;
        const end = Math.min(bytes.length, offset + (delay === 50 ? 8192 : 65536));
        response.write(bytes.subarray(offset, end));
        offset = end;
        if (offset === bytes.length) response.end();
        else timer = setTimeout(send, delay);
      };
      response.on('close', () => clearTimeout(timer));
      send();
    });
  },
});
const server = await createServer({
  ...config.config,
  configFile: false,
  root: appRoot,
  plugins,
  server: { ...config.config.server, host: '127.0.0.1', port: 5192, strictPort: true, proxy: {} },
});
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const failures = [];
const page = await context.newPage();
await page.addInitScript(() => {
  const original = Blob.prototype.arrayBuffer;
  globalThis.__largeModuleBlobReads = 0;
  Blob.prototype.arrayBuffer = function () {
    if (this.size >= 64 * 1024 * 1024) globalThis.__largeModuleBlobReads += 1;
    return original.call(this);
  };
});
page.on('pageerror', (error) => failures.push(error.message));
const external = [];
let blockedCatalogRefreshes = 0;
await context.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') {
    if (
      url.href ===
        'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/modules/catalog.preview.json' &&
      route.request().method() === 'GET'
    )
      blockedCatalogRefreshes += 1;
    else external.push(url.origin);
    return route.abort();
  }
  return route.continue();
});
const cdp = await context.newCDPSession(page);
const heap = [];
async function measure(stage) {
  const usage = await cdp.send('Runtime.getHeapUsage');
  heap.push({
    stage,
    usedSize: usage.usedSize,
    totalSize: usage.totalSize,
    embedderHeapUsedSize: usage.embedderHeapUsedSize,
    backingStorageSize: usage.backingStorageSize,
  });
}
const report = {
  contract: 1,
  assertions: [],
  measurements: heap,
  boundaries:
    'Headless Chromium, actual App with synthetic demo core and complete public local-dev reference. No native Android/device, independent clinical gold, OCR/viewer assets, whole-process peak or production release qualification. Cached restart blocks database downloads but still serves development JS and the core report.',
};
const record = (name) => report.assertions.push(name);
try {
  await page.goto('http://127.0.0.1:5192/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const setup = page.getByRole('dialog', { name: 'Подготовьте MiniMed к работе' });
  await expect(setup).toBeVisible({ timeout: 120000 });
  const coreRow = setup.locator('[data-module-id="minimed.core.ru"]');
  await expect(coreRow.getByRole('button', { name: 'Скачать ядро', exact: true })).toBeVisible({
    timeout: 60000,
  });
  assert.equal(coreGets, 0, 'Core data must wait for explicit consent.');
  const geometry = await setup.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const title = element.querySelector('.package-row__title--required');
    return {
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: element.scrollWidth,
      bold: title ? Number(getComputedStyle(title).fontWeight) : 0,
    };
  });
  assert(Math.abs(geometry.width - geometry.viewportWidth) < 2);
  assert(Math.abs(geometry.height - geometry.viewportHeight) < 2);
  assert(geometry.scrollWidth <= geometry.viewportWidth + 1);
  assert(geometry.bold >= 700);
  await expect(coreRow.locator('.package-row__asterisk')).toHaveText('*');
  record(
    'Fullscreen phone geometry, mandatory bold core and optional package list; no core GET before consent.',
  );
  await measure('setup-before-core');
  await coreRow.getByRole('button', { name: 'Скачать ядро', exact: true }).click();
  await expect(coreRow.getByRole('progressbar')).toBeVisible();
  await setup.getByRole('button', { name: 'Продолжить без ожидания', exact: true }).click();
  await expect(setup).toHaveCount(0, { timeout: 10000 });
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 90000 },
  );
  assert.equal(coreGets, 1);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('minimed:package-setup-dismissed:v1')),
    '1',
  );
  record('Closing setup retains core download/owner and persists dismissal.');
  await measure('core-ready');
  await page.getByRole('button', { name: 'Словарь', exact: true }).click();
  let dictionary = page.getByRole('dialog', { name: 'Словарь терминов', exact: true });
  await expect(dictionary).toBeVisible();
  await dictionary.getByText('Пакеты справочника', { exact: true }).click();
  const referenceRow = dictionary.locator('[data-module-id="minimed.definition.reference.ru"]');
  await referenceRow.getByRole('button', { name: 'Скачать', exact: true }).click();
  await expect(referenceRow.getByRole('progressbar')).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { peekContentModuleRuntime } = await import(
            '/src/features/modules/module-runtime-service.ts'
          );
          const task = peekContentModuleRuntime()
            ?.listTasks()
            .toReversed()
            .find((entry) => entry.moduleId === 'minimed.definition.reference.ru');
          return task ? { state: task.state, error: task.errorMessage ?? null } : null;
        }),
      { timeout: 180000, message: 'Reference installer must finish verification and activation' },
    )
    .toEqual({ state: 'completed', error: null });
  record(
    'Full manifest-counted optional edition installed through the normal download, gzip, checksum and index validator.',
  );
  await expect
    .poll(() => referenceGets, {
      message: 'Observe exactly one reference archive GET',
      timeout: 10000,
    })
    .toBe(1);
  // Core replacement may rebuild the search subtree; the same normal entry opens it again.
  if ((await dictionary.count()) === 0)
    await page.getByRole('button', { name: 'Словарь', exact: true }).click();
  dictionary = page.getByRole('dialog', { name: 'Словарь терминов', exact: true });
  await expect(dictionary.getByLabel('Термин или описание')).toBeVisible({ timeout: 90000 });
  await dictionary.getByLabel('Термин или описание').fill('Гиперестезия');
  await dictionary.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(dictionary.locator('.reference-panel__hit-button').first()).toBeVisible({
    timeout: 30000,
  });
  assert((await dictionary.locator('.reference-panel__hit-button').count()) <= 20);
  await dictionary.locator('.reference-panel__hit-button').first().click();
  await expect(dictionary.locator('.reference-card__text')).not.toBeEmpty({ timeout: 30000 });
  await expect(dictionary.locator('.reference-card__source')).toContainText('Источник:');
  const text = await dictionary.locator('.reference-card__text').innerText();
  assert(Array.from(text).length <= 4096);
  assert((await dictionary.locator('.reference-card__blocks button').count()) <= 8);
  record(
    'Normal dictionary UI finds source records and reads bounded text, block descriptors and source citation.',
  );
  await measure('reference-card-open');
  report.storedIndex = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('minimed-content-modules-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const request = database
          .transaction('versions', 'readonly')
          .objectStore('versions')
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stored = rows.find((row) => row.moduleId === 'minimed.definition.reference.ru');
      return {
        kind: stored?.bytes instanceof Blob ? 'Blob' : 'ArrayBuffer',
        bytes: stored?.bytes instanceof Blob ? stored.bytes.size : stored?.bytes.byteLength,
        checksum: stored?.indexSha256 ?? null,
      };
    } finally {
      database.close();
    }
  });
  if (process.argv.includes('--expect-blob')) {
    assert.equal(report.storedIndex.kind, 'Blob');
    assert.equal(report.storedIndex.bytes, descriptor.module.sizes.installedBytes);
    assert.equal(
      report.storedIndex.checksum,
      descriptor.module.artifacts.find((a) => a.kind === 'index').decodedSha256,
    );
    record('Real IndexedDB stores the complete immutable index as Blob with its decoded checksum.');
  }
  blockDatabaseReads = true;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => performance.getEntriesByName('minimed:search-ready').length > 0,
    undefined,
    { timeout: 120000 },
  );
  await expect(page.getByRole('dialog', { name: 'Подготовьте MiniMed к работе' })).toHaveCount(0);
  assert.equal(coreGets, 1, 'Installed core must reopen without another database GET.');
  assert.equal(referenceGets, 1, 'Installed dictionary must reopen without another archive GET.');
  await page.getByRole('button', { name: 'Словарь', exact: true }).click();
  dictionary = page.getByRole('dialog', { name: 'Словарь терминов', exact: true });
  await dictionary.getByLabel('Термин или описание').fill('Гиперестезия');
  await dictionary.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(dictionary.locator('.reference-panel__hit-button').first()).toBeVisible({
    timeout: 30000,
  });
  record(
    'Persisted dismissal and both installed databases survive application reload with database network reads blocked.',
  );
  assert.equal(failures.length, 0, JSON.stringify(failures));
  assert.equal(external.length, 0, 'The tested path must not require external requests.');
  record(
    'No uncaught page errors or unexpected external requests. Existing metadata-only catalog refreshes were blocked and used bundled fallback.',
  );
  await measure('reference-reopened');
  report.largeBlobReadsOnReopen = await page.evaluate(() => globalThis.__largeModuleBlobReads);
  if (process.argv.includes('--expect-blob')) {
    assert.equal(
      report.largeBlobReadsOnReopen,
      0,
      'Reopen must not materialize the large Blob on the main thread.',
    );
    record('Installed Blob reopens and searches without a main-thread Blob.arrayBuffer read.');
  }
  report.blockedCatalogRefreshes = blockedCatalogRefreshes;
  report.coreBytes = core.length;
  report.referenceInstalledBytes = descriptor.module.sizes.installedBytes;
  report.referenceDownloadBytes = archive.length;
  report.entries = descriptor.module.definitionReference.entries;
  report.coreGets = coreGets;
  report.referenceGets = referenceGets;
  await writeFile(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('Browser check failed:', error);
  console.error('Page errors:', JSON.stringify(failures));
  console.error('External origins:', JSON.stringify(external));
  console.error('Completed checks:', JSON.stringify(report.assertions));
  console.error(
    'UI counters:',
    JSON.stringify({
      dialogs: await page.getByRole('dialog').count(),
      alerts: await page.getByRole('alert').count(),
      coreGets,
      referenceGets,
    }),
  );
  console.error(
    'Boot status:',
    await page.locator('.boot-card__title, .boot-card__description').allTextContents(),
  );
  console.error('UI error messages:', await page.getByRole('alert').allTextContents());
  throw error;
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
