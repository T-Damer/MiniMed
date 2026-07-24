import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

const enabled = process.env.PRODUCTION_DOWNLOAD_SMOKE === '1';
const MODEL_CATALOG_URL =
  'https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/models/catalog.preview.json';
const REGULATORY_TITLE = 'Порядок диспансерного наблюдения несовершеннолетних — приказ № 192н';

test.skip(!enabled, 'Production download smoke runs only in its dedicated workflow.');
test.setTimeout(20 * 60 * 1000);

test('the built app downloads a real database and reaches the real model source', async ({
  page,
}) => {
  await mountBuiltApp(page, { persistentOrigin: true });

  await page.locator('.app-nav-icons').getByRole('button', { name: 'База знаний' }).click();
  const regulatoryCard = page
    .locator('.module-card')
    .filter({ hasText: 'Нормативные документы РФ: педиатрия' });
  await expect(regulatoryCard.getByRole('button', { name: 'Скачать документы' })).toBeVisible();
  await regulatoryCard.getByRole('button', { name: 'Скачать документы' }).click();
  await expect(regulatoryCard.locator('.module-state')).toHaveText('Установлено', {
    timeout: 120_000,
  });
  await expect(regulatoryCard.getByText('SHA-256 и SQLite проверены')).toBeVisible();

  await page.locator('.app-nav-icons').getByRole('button', { name: 'Поиск' }).click();
  await page.getByTestId('search-input').fill('приказ 192н диспансерное наблюдение');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results').getByText(REGULATORY_TITLE).first()).toBeVisible({
    timeout: 15_000,
  });

  const modelResult = await page.evaluate(async (catalogUrl) => {
    const catalogResponse = await fetch(catalogUrl, { cache: 'no-store' });
    if (!catalogResponse.ok) {
      throw new Error(`The production model catalog returned HTTP ${catalogResponse.status}.`);
    }
    const catalog = (await catalogResponse.json()) as {
      runtime?: { wllamaModuleUrl?: string; wllamaWasmUrl?: string };
      models?: Array<{
        id?: string;
        license?: { id?: string };
        artifacts?: Array<{
          runtime?: string;
          published?: boolean;
          upstreamUrl?: string;
          downloadBytes?: number;
        }>;
      }>;
    };
    const moduleUrl = catalog.runtime?.wllamaModuleUrl;
    const wasmUrl = catalog.runtime?.wllamaWasmUrl;
    if (!moduleUrl || !wasmUrl) throw new Error('The catalog has no complete wllama runtime.');

    const candidates = (catalog.models ?? [])
      .filter((model) => model.license?.id === 'apache-2.0')
      .flatMap((model) =>
        (model.artifacts ?? [])
          .filter(
            (artifact) =>
              artifact.runtime === 'wllama-web' &&
              artifact.published === true &&
              typeof artifact.upstreamUrl === 'string',
          )
          .map((artifact) => ({ modelId: model.id ?? 'unknown', artifact })),
      )
      .toSorted(
        (left, right) =>
          (left.artifact.downloadBytes ?? Number.MAX_SAFE_INTEGER) -
          (right.artifact.downloadBytes ?? Number.MAX_SAFE_INTEGER),
      );
    const candidate = candidates[0];
    if (!candidate?.artifact.upstreamUrl) {
      throw new Error('The catalog has no published Apache wllama model source.');
    }

    const runtimeModule = (await import(moduleUrl)) as { Wllama?: unknown };
    if (typeof runtimeModule.Wllama !== 'function') {
      throw new Error('The production wllama module has no Wllama constructor.');
    }
    const wasmResponse = await fetch(wasmUrl, { cache: 'no-store' });
    if (!wasmResponse.ok) throw new Error(`wllama WASM returned HTTP ${wasmResponse.status}.`);
    const wasmBytes = await wasmResponse.arrayBuffer();
    if (wasmBytes.byteLength < 1024) throw new Error('The wllama WASM response is too small.');

    const upstreamResponse = await fetch(candidate.artifact.upstreamUrl, {
      method: 'HEAD',
      cache: 'no-store',
    });
    if (!upstreamResponse.ok) {
      throw new Error(`The upstream model returned HTTP ${upstreamResponse.status}.`);
    }
    return {
      modelId: candidate.modelId,
      declaredBytes: candidate.artifact.downloadBytes ?? null,
      upstreamBytes: Number(upstreamResponse.headers.get('content-length')) || null,
      wasmBytes: wasmBytes.byteLength,
    };
  }, MODEL_CATALOG_URL);

  console.log(JSON.stringify(modelResult));
  expect(modelResult.declaredBytes).toBeGreaterThan(0);
  expect(modelResult.wasmBytes).toBeGreaterThan(0);
});
