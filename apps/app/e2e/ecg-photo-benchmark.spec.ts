import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import {
  type EcgPhotoBenchmarkResult,
  parseEcgPhotoBenchmarkManifest,
  parseEcgPhotoBenchmarkResult,
  validateEcgRealPhoneDigitizationHoldoutManifest,
  validateEcgRealPhoneHoldoutFiles,
} from '../../../tools/benchmarks/src/evaluate-ecg-photo-benchmark';

const benchmarkDirectory = process.env.ECG_BENCHMARK_DIR;

test.skip(
  !benchmarkDirectory,
  'Set ECG_BENCHMARK_DIR to the collected external ECG fixture folder.',
);

test('records the local digitizer result for every external ECG fixture', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  if (!benchmarkDirectory) throw new Error('ECG_BENCHMARK_DIR is required.');
  const directory = resolve(benchmarkDirectory);
  const output = resolve(
    process.env.ECG_BENCHMARK_OUTPUT ?? '/tmp/minimed-ecg-digitizer-baseline.json',
  );
  const screenshotDirectory = process.env.ECG_BENCHMARK_SCREENSHOT_DIR
    ? resolve(process.env.ECG_BENCHMARK_SCREENSHOT_DIR)
    : undefined;
  if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true });
  if (existsSync(output)) throw new Error(`Benchmark output already exists: ${output}`);
  const manifestValue = JSON.parse(
    readFileSync(resolve(directory, 'manifest.json'), 'utf8'),
  ) as unknown;
  const strictRealPhone = process.env.ECG_BENCHMARK_STRICT_REAL_PHONE === '1';
  const manifest = strictRealPhone
    ? validateEcgRealPhoneDigitizationHoldoutManifest(manifestValue)
    : parseEcgPhotoBenchmarkManifest(manifestValue);
  if (strictRealPhone) validateEcgRealPhoneHoldoutFiles(directory, manifest);
  const start = Number(process.env.ECG_BENCHMARK_START ?? 0);
  const limit = Number(process.env.ECG_BENCHMARK_LIMIT ?? manifest.cases.length);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1) {
    throw new Error('ECG_BENCHMARK_START must be non-negative and LIMIT must be positive.');
  }
  const origin = process.env.ECG_BENCHMARK_ORIGIN ?? 'http://127.0.0.1:5174';

  await page.goto(`${origin}/#/calculators/ecg-photo-caliper`);
  await expect(page.getByRole('heading', { name: 'Измерения по фото ЭКГ' })).toBeVisible();
  if (await page.getByText('Оцифровка не установлена', { exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Установить всё' }).click();
    await expect(page.getByText('Оцифровка готова', { exact: true })).toBeVisible({
      timeout: 180_000,
    });
    await expect(page.getByRole('button', { name: /Установка/u })).toHaveCount(0, {
      timeout: 180_000,
    });
  }

  const results: EcgPhotoBenchmarkResult[] = [];
  for (const fixture of manifest.cases.slice(start, start + limit)) {
    if (!fixture.local_file) throw new Error(`Missing local_file for case ${fixture.case_id}.`);
    const startedAt = performance.now();
    await page
      .locator('.ecg-example__file-input')
      .setInputFiles(resolve(directory, fixture.local_file));
    const dialog = page.getByRole('dialog', { name: 'Оцифровка ЭКГ' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const resultTitle = dialog.locator('.ecg-caliper__digitization-title');
    const failure = dialog.locator('.ecg-digitization-dialog__failure');
    await expect(resultTitle.or(failure)).toBeVisible({ timeout: 90_000 });
    const title = (await resultTitle.count())
      ? await resultTitle.innerText()
      : 'Ошибка оцифровщика';
    const quality = title.includes('прошла')
      ? 'usable'
      : title.includes('проверить')
        ? 'review'
        : 'failed';
    const meta = await dialog.locator('.ecg-caliper__digitization-meta').allTextContents();
    const digitization = dialog.locator('.ecg-caliper__digitization');
    const structured = (await digitization.count())
      ? await digitization.evaluate((element) => {
          const number = (name: string): number | undefined => {
            const value = element.getAttribute(name);
            if (value === null || value === '') return undefined;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
          };
          return {
            layout: element.getAttribute('data-layout') ?? undefined,
            lead_count: number('data-lead-count'),
            rhythm_coverage: number('data-rhythm-coverage'),
            duration_seconds: number('data-duration-seconds'),
            rr_ms: number('data-rr-ms'),
            heart_rate_bpm: number('data-heart-rate-bpm'),
          };
        })
      : {};
    if (quality === 'usable') {
      if (meta[0]?.startsWith('12×1')) {
        const profileConfirmation = dialog.getByLabel(/На записи указано 50 мм\/с/u);
        await expect(
          dialog.getByRole('button', { name: 'Сначала подтвердите профиль записи' }),
        ).toBeDisabled();
        await profileConfirmation.check();
        await expect(
          dialog.getByRole('button', { name: 'Принять черновик и проверить интервалы' }),
        ).toBeEnabled();
        await profileConfirmation.uncheck();
      } else {
        await expect(dialog.getByRole('button', { name: 'Нужна раскладка 12×1' })).toBeDisabled();
      }
    }
    const collected = parseEcgPhotoBenchmarkResult({
      case_id: fixture.case_id,
      fixture_kind: fixture.fixture_kind,
      labels: fixture.labels,
      title: fixture.title,
      quality,
      elapsed_ms: Math.round(performance.now() - startedAt),
      meta,
      photo_quality_issues: await dialog.locator('.ecg-caliper__quality-issue').allTextContents(),
      photo_quality_issue_codes: await dialog
        .locator('.ecg-caliper__quality-issue')
        .evaluateAll((elements) =>
          elements.flatMap((element) => {
            const code = element.getAttribute('data-code');
            return code ? [code] : [];
          }),
        ),
      reasons: await dialog.locator('.ecg-caliper__digitization-reason').allTextContents(),
      error: (await failure.count()) ? await failure.innerText() : null,
      ...structured,
    });
    const screenshotName = fixture.case_id.replaceAll(/[^a-z0-9._-]/giu, '-');
    if (screenshotDirectory) {
      await dialog.screenshot({
        path: resolve(screenshotDirectory, `${screenshotName}-dialog.png`),
      });
    }
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog).toBeHidden();
    if (screenshotDirectory) {
      await page.locator('.ecg-example__workspace').screenshot({
        path: resolve(screenshotDirectory, `${screenshotName}-workspace.png`),
      });
    }
    const result = {
      ...collected,
      rectified_primary: await page.getByText('Выправленный лист', { exact: true }).isVisible(),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }

  writeFileSync(
    output,
    `${JSON.stringify(
      {
        schema_version: 1,
        dataset_id: manifest.dataset_id,
        measured_at: new Date().toISOString(),
        results,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
});
