import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { installFakeSpeech } from './fake-speech';
import { mountBuiltApp } from './mount-built-app';

/**
 * REC1 screenshots for the owner (not a gate; `REC_SHOTS=1`): the floating recorder over another
 * screen, the recorder window, the recording sheet with the player and the text, «Файлы» →
 * «Записи бесед» — on a phone (390 px) and wide (1280 px), light theme. `REC_SHOTS_DIR` picks the
 * folder. `REC_SHOTS_OLD=1` takes the same moments of the recorder before REC1 (its own selectors).
 */
const chromiumPath = process.env.CHROMIUM_PATH;
const DIR =
  process.env['REC_SHOTS_DIR'] ?? resolve(import.meta.dirname, '../../../output/rec1-shots');
const OLD = process.env['REC_SHOTS_OLD'] === '1';
const PHRASES = [
  'Здравствуйте, проходите. Как вы себя чувствовали эту неделю?',
  'Честно говоря, тяжело. Плохо спал, просыпался в четыре утра.',
  'Понимаю. А настроение? Бывало, что ничего не радовало?',
  'Почти каждый день. Сил ни на что нет.',
];

test.use({
  permissions: ['microphone'],
  launchOptions: {
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: [
      '--mute-audio',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      // Synthetic speech instead of the fake device's beep, so the waveforms look like a talk.
      ...(process.env['REC_SHOTS_WAV']
        ? [`--use-file-for-fake-audio-capture=${process.env['REC_SHOTS_WAV']}`]
        : []),
    ],
  },
});

for (const width of [390, 1280]) {
  test(`recorder screens at ${width} px`, async ({ page }) => {
    test.skip(process.env['REC_SHOTS'] !== '1', 'run with REC_SHOTS=1');
    test.setTimeout(180_000);
    mkdirSync(DIR, { recursive: true });
    const tag = `${OLD ? 'before' : 'after'}-${width}`;
    const shot = (name: string): Promise<Buffer> =>
      page.screenshot({ path: `${DIR}/${tag}-${name}.png` });
    await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
    await page.emulateMedia({ colorScheme: 'light' });
    // The browser build (a phone bridge stand-in would leave the search core unopened on screen).
    await installFakeSpeech(page, PHRASES);
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });

    await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Все инструменты' })
      .locator('.quick-tool-row__open', { hasText: 'Запись беседы' })
      .click();
    const live = page.getByTestId('conversation-live');
    await expect(live).toBeVisible();
    await page.waitForTimeout(400);
    await shot('1-ready');
    await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
    await live
      .locator('.asr-model-card')
      .getByRole('button', { name: /Скачать/u })
      .click();
    // A browser without a vault offers to create one; the shots show the text saved.
    const offer = live.getByRole('button', { name: /Текст не сохранится/u });
    await offer.click({ timeout: 30_000 }).catch(() => undefined);
    const line = OLD ? '.conversation-live__line' : '.recorder-window__line';
    await expect(live.locator(line)).toHaveCount(2, { timeout: 60_000 });
    await shot('2-recording');
    await collapse(page);
    await page.waitForTimeout(600);
    await shot('3-collapsed-over-app');
    await expand(page);
    await expect(live.locator(line)).toHaveCount(3, { timeout: 60_000 });
    await live.getByRole('button', { name: 'Стоп' }).click();
    const sheet = page.getByRole('dialog', { name: 'Запись сохранена' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(1_500);
    await shot('4-saved');
    if (OLD) return;
    await sheet.getByRole('button', { name: 'Слушать' }).click();
    await page.waitForTimeout(2_500);
    await sheet.getByRole('button', { name: 'Пауза' }).click();
    await shot('5-player');
    await sheet.getByRole('button', { name: 'Позже', exact: true }).click();
    await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
    await page.getByTestId('user-library-kind-recordings').getByRole('button').click();
    await expect(page.getByTestId('conversation-recording-row')).toHaveCount(1);
    await page.waitForTimeout(400);
    await shot('6-files-recordings');
  });
}

async function collapse(page: Page): Promise<void> {
  if (OLD) {
    await page.getByRole('button', { name: 'Свернуть в строку записи' }).click();
    return;
  }
  await page
    .getByRole('dialog', { name: 'Запись беседы' })
    .getByRole('button', { name: 'Свернуть' })
    .click();
}

async function expand(page: Page): Promise<void> {
  if (OLD) {
    await page.getByRole('button', { name: /Открыть окно с текстом/u }).click();
    return;
  }
  await page.getByTestId('recorder-fab').click();
}
