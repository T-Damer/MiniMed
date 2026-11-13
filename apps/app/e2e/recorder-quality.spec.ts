import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

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

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/\[\[[^\]]*\]\]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
}

/** Word-level edit distance. */
function distance(reference: readonly string[], hypothesis: readonly string[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const cost = reference[row - 1] === hypothesis[column - 1] ? 0 : 1;
      current.push(
        Math.min(
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
          (previous[column - 1] ?? 0) + cost,
        ),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length] ?? 0;
}

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
  // The model first (cached in the profile after the first run), then a clean recording.
  const card = live.locator('.asr-model-card');
  const action = card.getByRole('button', { name: /Скачать|Включить/u });
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  if (await action.isVisible().catch(() => false)) await action.click();
  await expect(live.getByRole('status', { name: /Слушаем|Распознаём/u })).toBeVisible({
    timeout: 10 * 60_000,
  });
  await live.getByRole('button', { name: /Стоп/u }).first().click();
  const saved = page.getByRole('dialog', { name: /Запись/u }).last();
  await saved
    .getByRole('button', { name: /Позже|Готово/u })
    .first()
    .click();

  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Все инструменты' })
    .locator('.quick-tool-row__open', { hasText: 'Запись беседы' })
    .click();
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  const started = Date.now();
  await page.waitForTimeout(SECONDS * 1000);
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

  const script = words(readFileSync(scriptFile, 'utf8'));
  // The fake microphone loops the file; the reference is the script as many times as it played.
  const loops = Math.max(1, Math.round(recordedSeconds / loopSeconds));
  const reference = Array.from({ length: loops }, () => script).flat();
  const hypothesis = words(finalText.join(' '));
  const errors = distance(reference, hypothesis);
  const result = {
    recordedSeconds: Math.round(recordedSeconds),
    loops,
    referenceWords: reference.length,
    hypothesisWords: hypothesis.length,
    wer: Math.round((errors / reference.length) * 1000) / 1000,
    lines: finalText,
  };
  console.log(JSON.stringify({ ...result, lines: finalText.length }));
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
});
