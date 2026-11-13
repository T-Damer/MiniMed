import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';
import { loopedWer } from './word-error-rate';

/**
 * REC1: how well live recognition hears a conversation, before and after the recorder rework. Not a
 * gate (`REC_QUALITY=1`): it downloads the real Whisper model from Hugging Face (as the app does)
 * and plays a synthetic dialogue (`REC_QUALITY_WAV`, e.g. macOS `say -v Milena`, looped by the fake
 * microphone) for `REC_QUALITY_SECONDS`. The text the window shows is scored against the script
 * (`REC_QUALITY_SCRIPT`, plain text) by word error rate. Old and new builds use different class
 * names for the lines; both are read.
 */
const PROFILE_DIR = resolve(import.meta.dirname, '../../../playwright/recorder-quality-profile');
const OUT =
  process.env['REC_QUALITY_OUT'] ??
  resolve(import.meta.dirname, '../../../output/recorder-quality.json');
const SECONDS = Number(process.env['REC_QUALITY_SECONDS'] ?? '130');

test('live recognition of a synthetic dialogue', async () => {
  test.skip(process.env['REC_QUALITY'] !== '1', 'run with REC_QUALITY=1');
  test.setTimeout(20 * 60_000);
  const wav = process.env['REC_QUALITY_WAV'];
  const scriptFile = process.env['REC_QUALITY_SCRIPT'];
  if (!wav || !scriptFile) throw new Error('REC_QUALITY_WAV and REC_QUALITY_SCRIPT are required');
  const loopSeconds = Number(process.env['REC_QUALITY_LOOP_SECONDS'] ?? '42.47');
  mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    permissions: ['microphone'],
    ...(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {}),
    args: [
      '--mute-audio',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    window.localStorage.setItem('minimed:core-download-consent:v1', '1');
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Все инструменты' })
    .locator('.quick-tool-row__open', { hasText: 'Запись беседы' })
    .click();
  const live = page.getByTestId('conversation-live');
  // A first-time download asks before it starts (owner rule): accept it when asked.
  page.on('dialog', (dialog) => void dialog.accept());
  // The model first (cached in the profile after the first run), then a clean recording.
  const card = live.locator('.asr-model-card');
  const action = card.getByRole('button', { name: /Скачать|Включить/u });
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  // The card appears once the runtime has been asked (absent when the model is already loaded).
  if (await action.isVisible({ timeout: 20_000 }).catch(() => false)) await action.click();
  await action.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  if (await action.isVisible().catch(() => false)) await action.click();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  try {
    // Ready: the install card leaves the window (both builds hide or remove it).
    const deadline = Date.now() + 8 * 60_000;
    for (;;) {
      const visible = await card.isVisible().catch(() => false);
      if (!visible) break;
      if (Date.now() > deadline) throw new Error('The speech model did not become ready.');
      console.log(JSON.stringify({ card: (await card.innerText()).replace(/\s+/gu, ' ') }));
      await page.waitForTimeout(10_000);
    }
  } catch (cause) {
    await page.screenshot({ path: `${OUT}.model-timeout.png` });
    console.log(JSON.stringify({ problems: problems.slice(-15) }));
    throw cause;
  }
  await live.getByRole('button', { name: /Стоп/u }).first().click();
  const saved = page.getByRole('dialog', { name: /Запись/u }).last();
  await saved
    .getByRole('button', { name: /Позже|Готово/u })
    .first()
    .click({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(3_000);

  // The measured recording. The old recorder sometimes ignored the first tap after a recording
  // (still finishing the last one): the tap is repeated until «Стоп» shows.
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Все инструменты' })
    .locator('.quick-tool-row__open', { hasText: 'Запись беседы' })
    .click({ timeout: 15_000 });
  const stop = live.getByRole('button', { name: /Стоп/u }).first();
  for (let attempt = 0; attempt < 5 && !(await stop.isVisible()); attempt += 1) {
    await live
      .getByRole('button', { name: 'Начать запись', exact: true })
      .click({ timeout: 10_000 })
      .catch(() => undefined);
    await stop.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
  }
  await expect(stop).toBeVisible();
  const started = Date.now();
  await page.waitForTimeout(SECONDS * 1000);
  await page.screenshot({ path: `${OUT}.end.png` });
  console.log(
    JSON.stringify({
      status: await live.getByRole('status').allTextContents(),
      notes: await live.locator('.recorder-window__note').allTextContents(),
      problems: problems.slice(-10),
    }),
  );
  const lines = live.locator('.recorder-window__line, .conversation-live__line');
  const heard = await lines.allTextContents();
  const recordedSeconds = (Date.now() - started) / 1000;
  await live.getByRole('button', { name: /Стоп/u }).first().click();
  await page.waitForTimeout(8_000);
  // The tail read after «Стоп» shows in the sheet.
  const after = await page
    .getByRole('dialog', { name: /Запись/u })
    .last()
    .locator('.audio-player__segment-text, .conversation-dialog__line')
    .allTextContents();
  const finalText = after.length >= heard.length ? after : heard;

  const result = {
    recordedSeconds: Math.round(recordedSeconds),
    ...loopedWer(
      readFileSync(scriptFile, 'utf8'),
      finalText.join(' '),
      recordedSeconds,
      loopSeconds,
    ),
    lines: finalText,
  };
  console.log(JSON.stringify({ ...result, lines: finalText.length }));
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
});
