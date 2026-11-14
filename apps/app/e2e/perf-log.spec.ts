import { readFileSync, writeFileSync } from 'node:fs';

import { type CDPSession, expect, type Page, test } from '@playwright/test';

import { renderPerfReport } from '../../../scripts/perf-log-report';
import type { PerfLogFile } from '../src/state/perf-log-analysis';
import { installDeviceKeyAndSpeech, installFakeSpeech } from './fake-speech';
import {
  E2E_ASSET_ORIGIN,
  mountBuiltApp,
  waitForSearchEditable,
  waitForSearchReady,
} from './mount-built-app';
import { openSettingsPage } from './settings-nav';

/**
 * PERFLOG1 (owner 2026-11-14): the opt-in performance log. It is turned on in Settings, records a
 * search, a recording with live text, screens and long frames, and «Поделиться журналом» hands over
 * a JSON with no content: none of the words typed, heard or entered for a patient. Off, it loads
 * nothing and adds no work to an idle screen; on, an idle screen stays nearly as quiet.
 *
 * The app runs as the Android build (`installDeviceKey`): the native share and the native sampler
 * are stand-ins that keep what they are given, so the Android code path is the one tested.
 */
const chromiumPath = process.env.CHROMIUM_PATH;

test.use({
  permissions: ['microphone'],
  viewport: { width: 390, height: 844 },
  launchOptions: {
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

/** Words that must never reach the log. */
const SECRET_QUERY = 'пневмония';
const SECRET_PHRASES = ['Как вы спали эту неделю?', 'Плохо, просыпаюсь в четыре утра.'];
const SECRET_PATIENT = 'Сидорова Анна';

/** The native share and sampler stand-ins: the shared file is kept on `window`. */
async function installNativePerfStandIns(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const capacitor = (
      window as unknown as {
        Capacitor: {
          PluginHeaders: { name: string; methods: { name: string; rtype: string }[] }[];
          nativePromise: (
            plugin: string,
            method: string,
            options?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).Capacitor;
    const methods = (names: string[]) => names.map((name) => ({ name, rtype: 'promise' }));
    capacitor.PluginHeaders.push(
      { name: 'LocalMedShare', methods: methods(['shareFile', 'shareText']) },
      { name: 'LocalMedPerf', methods: methods(['start', 'stop', 'sample']) },
    );
    const original = capacitor.nativePromise;
    const state = window as unknown as { __perfShared?: string; __perfNativeStarted?: number };
    capacitor.nativePromise = async (plugin, method, options = {}) => {
      if (plugin === 'LocalMedShare' && method === 'shareFile') {
        state.__perfShared = String(options['data'] ?? '');
        return {};
      }
      if (plugin === 'LocalMedPerf') {
        if (method === 'start') state.__perfNativeStarted = (state.__perfNativeStarted ?? 0) + 1;
        if (method === 'sample') {
          return {
            device: { manufacturer: 'Emu', model: 'Stand-in', release: '15', sdk: 35 },
            sample: { epochMs: Date.now(), cpuCores: 0.42, tempC: 34.5, thermal: 0, pssMb: 210 },
          };
        }
        return {};
      }
      return original(plugin, method, options);
    };
  });
}

async function openPerfLogRow(page: Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await openSettingsPage(page, 'Основные');
  const row = page.getByTestId('perf-log-settings');
  await expect(row).toBeVisible();
  return row;
}

async function sharedLog(page: Page): Promise<{ text: string; file: PerfLogFile }> {
  const base64 = await page.waitForFunction(
    () => (window as unknown as { __perfShared?: string }).__perfShared,
    undefined,
    { timeout: 20_000 },
  );
  const text = Buffer.from(String(await base64.jsonValue()), 'base64').toString('utf8');
  return { text, file: JSON.parse(text) as PerfLogFile };
}

async function recordWithLiveText(page: Page, patient?: string): Promise<void> {
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Все инструменты' })
    .locator('.quick-tool-row__open', { hasText: 'Запись беседы' })
    .click();
  const live = page.getByTestId('conversation-live');
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await live
    .locator('.asr-model-card')
    .getByRole('button', { name: /Скачать/u })
    .click();
  if (patient) {
    await live.getByRole('button', { name: 'Выбрать пациента', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Пациент', exact: true });
    await chooser.getByRole('button', { name: 'Добавить пациента', exact: true }).click();
    await chooser.getByLabel('Имя или псевдоним').fill(patient);
    await chooser.getByRole('button', { name: 'Создать пациента', exact: true }).click();
    await expect(live.getByText(patient)).toBeVisible();
  }
  await expect(live.locator('.recorder-window__line').first()).toHaveText(SECRET_PHRASES[0] ?? '', {
    timeout: 40_000,
  });
  await live.getByRole('button', { name: 'Стоп' }).click();
  const sheet = page.getByRole('dialog', { name: 'Запись сохранена' });
  if (patient) {
    await expect(sheet.locator('.recording-sheet__filed')).toContainText(patient, {
      timeout: 20_000,
    });
  }
  // «Готово» with a patient, «Позже» without one; «Закрыть» is always there.
  await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** No content: none of the secrets, no search address, no Russian outside the app's summary. */
function expectNoContent(text: string, file: PerfLogFile, secrets: readonly string[]): void {
  for (const secret of secrets) expect(text.includes(secret), secret).toBe(false);
  expect(text).not.toMatch(/[?&]q=/u);
  expect(JSON.stringify({ ...file, summary: [] })).not.toMatch(/[А-Яа-яЁё]/u);
}

function entryNames(file: PerfLogFile): Set<string> {
  return new Set(
    file.sessions.flatMap((session) => session.entries).map((entry) => `${entry.k}:${entry.n}`),
  );
}

test('browser: `?perf=1` records a search, a recording and a long frame; the file has no content', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await installFakeSpeech(page, SECRET_PHRASES);
  // No system share sheet in a headless browser: «Поделиться журналом» downloads the file.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, waitForCore: true });

  // Not offered to everyone: no row in Settings until this device has had the log on.
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await openSettingsPage(page, 'Основные');
  await expect(
    page.getByRole('switch', { name: 'Обновлять материалы автоматически' }),
  ).toBeVisible();
  await expect(page.getByTestId('perf-log-settings')).toHaveCount(0);

  // The browser's flag; on a phone the owner's adb intent does the same.
  await page.goto(`${E2E_ASSET_ORIGIN}/?perf=1#/search`);
  await waitForSearchReady(page);
  const row = await openPerfLogRow(page);
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

  // A search with words that must not be logged.
  await page.goto(`${E2E_ASSET_ORIGIN}/?perf=1#/search`);
  await waitForSearchEditable(page);
  await page.getByTestId('search-input').click();
  await page.keyboard.type(SECRET_QUERY, { delay: 40 });
  await expect(page.locator('.results-list .result-group').first()).toBeVisible({
    timeout: 60_000,
  });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  // A long frame the log must catch.
  await page.evaluate(() => {
    const until = performance.now() + 180;
    while (performance.now() < until) {
      // busy
    }
  });

  // An in-app move: a new page load would drop what was not yet written.
  await page.evaluate(() => {
    window.location.hash = '#/search';
  });
  await recordWithLiveText(page);

  const shareRow = await openPerfLogRow(page);
  await expect(shareRow.getByTestId('perf-log-progress')).toContainText('Пишется');
  await page.screenshot({ path: testInfo.outputPath('perf-log-on.png') });
  const download = page.waitForEvent('download');
  await shareRow.getByRole('button', { name: 'Поделиться журналом' }).click();
  const path = await (await download).path();
  const text = readFileSync(path, 'utf8');
  writeFileSync(testInfo.outputPath('perf-log-browser.json'), text);
  const file = JSON.parse(text) as PerfLogFile;

  expect(file.format).toBe('minimed-perf-log');
  expect(file.summary.length).toBeGreaterThan(1);
  const names = entryNames(file);
  for (const expected of [
    'route:enter',
    'settle:screen',
    'span:search.core',
    'mark:recorder.start',
    'mark:recorder.stop',
    'span:recorder.recording',
    'span:asr.stretch',
    'mem:heap',
  ]) {
    expect(names, expected).toContain(expected);
  }
  const entries = file.sessions.flatMap((session) => session.entries);
  const stretch = entries.find((entry) => entry.n === 'asr.stretch');
  expect(stretch?.f?.['engine']).toBe('whisper');
  expect(stretch?.f?.['audioS']).toBeGreaterThan(0);
  const busy = entries.find(
    (entry) => (entry.k === 'frame' || entry.k === 'task') && (entry.d ?? 0) >= 170,
  );
  expect(busy, 'the 180 ms busy frame').toBeDefined();
  expect(entries.some((entry) => entry.k === 'jank' && entry.s === 'search')).toBe(true);
  expectNoContent(text, file, [SECRET_QUERY, ...SECRET_PHRASES, 'спали']);

  const report = renderPerfReport(file);
  writeFileSync(testInfo.outputPath('perf-log-report.md'), report);
  expect(report).toContain('## Conversation recorder');
  expect(report).toMatch(/\| whisper \| \d+ \|/u);
});

test('Android: native samples and the native share; a patient chosen while recording is not logged', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await installDeviceKeyAndSpeech(page, SECRET_PHRASES);
  await installNativePerfStandIns(page);
  // The owner's adb intent set the device flag (`LocalMedPerfPlugin`) a minute ago.
  await page.addInitScript(() => {
    let enabledAt = Date.now() - 60_000;
    Object.assign(window, {
      MiniMedPerfFlag: {
        enabledAt: () => enabledAt,
        set: (on: boolean) => {
          enabledAt = on ? enabledAt || Date.now() : 0;
        },
      },
    });
  });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const row = await openPerfLogRow(page);
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __perfNativeStarted?: number }).__perfNativeStarted ?? 0,
      ),
    )
    .toBe(1);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await recordWithLiveText(page, SECRET_PATIENT);
  // One collector tick (15 s) so the native sampler is read.
  await page.waitForTimeout(16_000);

  const shareRow = await openPerfLogRow(page);
  await shareRow.getByRole('button', { name: 'Поделиться журналом' }).click();
  const { text, file } = await sharedLog(page);
  writeFileSync(testInfo.outputPath('perf-log-android.json'), text);
  const names = entryNames(file);
  expect(names).toContain('native:sample');
  expect(names).toContain('span:recorder.recording');
  expect(file.sessions.at(-1)?.device['native']).toMatchObject({ model: 'Stand-in' });
  const sample = file.sessions
    .flatMap((session) => session.entries)
    .find((entry) => entry.k === 'native');
  expect(sample?.f).toMatchObject({ cpuCores: 0.4, tempC: 34.5, pssMb: 210 });
  expectNoContent(text, file, [SECRET_PATIENT, 'Сидорова', ...SECRET_PHRASES]);
});

/** JS time spent in the performance log's own files over `seconds` of an idle screen (profiler). */
async function perfLogScriptMs(page: Page, cdp: CDPSession, seconds: number): Promise<number> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(seconds * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const deltas = profile.timeDeltas ?? [];
  let micros = 0;
  (profile.samples ?? []).forEach((id, index) => {
    if (/perf-log/u.test(nodes.get(id)?.callFrame.url ?? '')) micros += deltas[index] ?? 0;
  });
  return micros / 1000;
}

test('off, the log loads nothing; on, its own work on an idle screen is tiny', async ({ page }) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const cdp = await page.context().newCDPSession(page);
  /** A full load with the flag, the core open, 4 s to settle, then 10 s of an idle search home. */
  const idleAfterLoad = async (flag: '0' | '1'): Promise<number> => {
    await page.goto(`${E2E_ASSET_ORIGIN}/?perf=${flag}#/search`);
    await waitForSearchReady(page);
    await waitForSearchEditable(page);
    await page.waitForTimeout(4_000);
    return perfLogScriptMs(page, cdp, 10);
  };

  const offMs = await idleAfterLoad('0');
  const offState = await page.evaluate(async () => ({
    collector: performance
      .getEntriesByType('resource')
      .some((entry) => entry.name.includes('perf-log-collector')),
    databases: (await indexedDB.databases()).map((database) => database.name),
  }));
  expect(offState.collector, 'the collector chunk is not loaded while the log is off').toBe(false);
  expect(offState.databases).not.toContain('minimed-perf-log');
  expect(offMs, 'off: the log runs no code').toBeLessThan(1);

  const onMs = await idleAfterLoad('1');
  const loaded = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .some((entry) => entry.name.includes('perf-log-collector')),
  );
  expect(loaded).toBe(true);
  console.log(
    `performance-log script time over 10 s idle: off ${offMs.toFixed(2)} ms, on ${onMs.toFixed(2)} ms`,
  );
  // On: observers, the screen watcher and one 15 s tick; idle it neither draws nor polls. Measured
  // ≈ 0.6 ms per 8 s on a Mac (PERFLOG1); the bound leaves room for a loaded machine.
  expect(onMs).toBeLessThan(20);
});
