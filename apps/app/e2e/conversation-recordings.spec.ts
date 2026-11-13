import { expect, type Page, test } from '@playwright/test';
import { installDeviceKeyAndSpeech } from './fake-speech';
import { mountBuiltApp } from './mount-built-app';

/**
 * REC1 (owner 2026-11-13): a recording is found again — in «Файлы» → «Записи бесед» and on the
 * patient chosen while recording — and plays in the app's own player; when the phone is too busy,
 * the text waits for «Расшифровать». The microphone is Chromium's fake device; the speech worker is
 * the e2e stand-in (`fake-speech.ts`).
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

async function openRecorder(page: Page) {
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Все инструменты' })
    .locator('.quick-tool-row__open', { hasText: 'Запись беседы' })
    .click();
  const live = page.getByTestId('conversation-live');
  await expect(live).toBeVisible();
  return live;
}

test('a patient chosen while recording gets it; «Файлы» and the card both find it', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await installDeviceKeyAndSpeech(page, [
    'Как вы спали эту неделю?',
    'Плохо, просыпаюсь в четыре.',
  ]);
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  const live = await openRecorder(page);
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await live
    .locator('.asr-model-card')
    .getByRole('button', { name: /Скачать/u })
    .click();

  // The patient is chosen in the window while the recording runs.
  await live.getByRole('button', { name: 'Выбрать пациента', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Пациент', exact: true });
  await chooser.getByRole('button', { name: 'Добавить пациента', exact: true }).click();
  await chooser.getByLabel('Имя или псевдоним').fill('Пациент сессии');
  await chooser.getByRole('button', { name: 'Создать пациента', exact: true }).click();
  await expect(live.getByText('Пациент сессии')).toBeVisible();

  await expect(live.locator('.recorder-window__line').first()).toHaveText(
    'Как вы спали эту неделю?',
    { timeout: 40_000 },
  );
  await page.screenshot({ path: testInfo.outputPath('recorder-window-phone.png') });
  await live.getByRole('button', { name: 'Стоп' }).click();

  // Stopped: the recording went to the patient's card by itself, and plays here.
  const sheet = page.getByRole('dialog', { name: 'Запись сохранена' });
  await expect(sheet.locator('.recording-sheet__filed')).toContainText('Пациент сессии', {
    timeout: 20_000,
  });
  await expect(sheet.getByRole('button', { name: 'Слушать' })).toBeVisible();
  await expect(sheet.getByRole('slider', { name: /Позиция/u })).toBeVisible();
  await expect(sheet.getByRole('list', { name: 'Текст беседы' })).toContainText(
    'Как вы спали эту неделю?',
  );
  const speed = sheet.getByRole('button', { name: /Скорость/u });
  await expect(speed).toHaveText('1×');
  await speed.click();
  await expect(speed).toHaveText('1,25×');
  await expect
    .poll(() => sheet.locator('audio').evaluate((audio: HTMLAudioElement) => audio.playbackRate))
    .toBe(1.25);
  await page.screenshot({ path: testInfo.outputPath('recording-sheet-phone.png') });
  await sheet.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  // «Файлы» → «По виду» → «Записи бесед».
  await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  const kind = page.getByTestId('user-library-kind-recordings');
  await expect(kind).toContainText('Записи бесед');
  await expect(kind).toContainText('1');
  await kind.getByRole('button').click();
  await expect(page).toHaveURL(/#\/modules\/documents\/user\?kind=recordings$/u);
  const row = page.getByTestId('conversation-recording-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Пациент сессии');
  await page.screenshot({ path: testInfo.outputPath('files-recordings-phone.png') });
  await row.getByRole('button').click();
  const fromFiles = page.getByRole('dialog', { name: 'Запись беседы' });
  await expect(fromFiles.getByRole('button', { name: 'Слушать' })).toBeVisible();

  // The patient's card lists it too.
  await fromFiles.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page).toHaveURL(/#\/notes\/patients\//u);
  // «Файлы» stays mounted behind (hidden); only the card's own list is visible.
  const onCard = page.getByTestId('conversation-recording-row').filter({ visible: true });
  await expect(onCard).toHaveCount(1, { timeout: 15_000 });
  await onCard.getByRole('button').click();
  await expect(page.getByRole('dialog', { name: 'Запись беседы' })).toBeVisible();
});

test('a busy phone leaves the text for «Расшифровать», which reads it from the kept audio', async ({
  page,
}) => {
  test.setTimeout(150_000);
  // A weak phone: live recognition never starts; the recording itself is untouched.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true });
  });
  await installDeviceKeyAndSpeech(page, ['Первая фраза сессии.', 'Вторая фраза сессии.']);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const live = await openRecorder(page);
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await live
    .locator('.asr-model-card')
    .getByRole('button', { name: /Скачать/u })
    .click();
  await expect(live.getByTestId('recorder-deferred')).toBeVisible({ timeout: 40_000 });
  await expect(live.locator('.recorder-window__line')).toHaveCount(0);
  // Long enough for two stretches of the fake microphone's beeps.
  await expect(live.locator('.recorder-window__time')).toHaveText(/00:(1[89]|[2-5]\d)/u, {
    timeout: 30_000,
  });
  await live.getByRole('button', { name: 'Стоп' }).click();

  const sheet = page.getByRole('dialog', { name: 'Запись сохранена' });
  const transcribe = sheet.getByRole('button', { name: 'Расшифровать', exact: true });
  await expect(transcribe).toBeVisible({ timeout: 15_000 });
  await transcribe.click();
  await expect(sheet.getByRole('list', { name: 'Текст беседы' })).toContainText(
    'Первая фраза сессии.',
    { timeout: 40_000 },
  );
  await expect(sheet.getByTestId('recording-transcribing')).toHaveCount(0, { timeout: 30_000 });
  // Everything is text now: nothing is left to read.
  await expect(sheet.getByRole('button', { name: /Расшифровать/u })).toHaveCount(0);
});
