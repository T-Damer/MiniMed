import { expect, type Page, test } from '@playwright/test';
import { mountBuiltApp } from './mount-built-app';

const chromiumPath = process.env.CHROMIUM_PATH;

async function openToolsSheet(page: Page) {
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.use({
  permissions: ['microphone'],
  launchOptions: {
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('the bar expands to a live window with full screen, survives a tab switch and stops', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const sheet = await openToolsSheet(page);
  await sheet.locator('.quick-tool-row__open', { hasText: 'Запись беседы' }).click();

  // The row only opens the window: nothing is recorded until the round button is tapped.
  const live = page.getByTestId('conversation-live');
  const bar = page.locator('.conversation-bar');
  await expect(live).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(live.locator('.conversation-live__time')).toHaveCount(0);
  await expect(live.getByRole('button', { name: 'Стоп' })).toHaveCount(0);

  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await expect(live.getByRole('button', { name: 'Стоп' })).toBeVisible();

  // Collapsing leaves the recording bar; expanding brings the window back.
  await live.getByRole('button', { name: 'Свернуть в строку записи' }).click();
  await expect(live).toHaveCount(0);
  await expect(bar).toBeVisible();
  await expect(bar.getByText('Идёт запись беседы')).toBeVisible();
  await expect(bar.locator('.conversation-bar__time')).toHaveText(/\d{2}:\d{2}/u);
  await bar.getByRole('button', { name: /Открыть окно с текстом/u }).click();
  await expect(live).toBeVisible();
  await expect(bar).toHaveCount(0);
  // No speech model in the test: the timer and meter stay, and the model is offered in place.
  await expect(live.locator('.conversation-live__time')).toHaveText(/\d{2}:\d{2}/u);
  await expect(
    live.getByText('Загрузите модель, чтобы голос автоматически превращался в текст'),
  ).toBeVisible();
  await expect(live.getByRole('button', { name: /Скачать · \d+ МБ/u })).toBeVisible();

  await live.getByRole('button', { name: 'Открыть на весь экран' }).click();
  await expect(live).toHaveClass(/floating-window--fullscreen/u);
  await live.getByRole('button', { name: 'Свернуть в маленькое окно' }).click();
  await expect(live).not.toHaveClass(/floating-window--fullscreen/u);

  // Another tab: the window stays.
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /^Настройки/u })
    .click();
  await expect(live).toBeVisible();

  await live.getByRole('button', { name: 'Стоп' }).click();
  await expect(live).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Запись сохранена' })).toBeVisible();
});

test('the saved recording shows its length and is filed through the patient picker', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const sheet = await openToolsSheet(page);
  await sheet.locator('.quick-tool-row__open', { hasText: 'Запись беседы' }).click();
  const live = page.getByTestId('conversation-live');
  await live.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await expect(live.locator('.conversation-live__time')).toHaveText(/00:0[1-9]/u, {
    timeout: 10_000,
  });
  await live.getByRole('button', { name: 'Стоп' }).click();

  const dialog = page.getByRole('dialog', { name: 'Запись сохранена' });
  await expect(dialog).toBeVisible();
  // A MediaRecorder file starts without a length; the player must still show the real total.
  const duration = (): Promise<number> =>
    dialog.locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration);
  await expect.poll(duration, { timeout: 10_000 }).toBeGreaterThan(0.5);
  expect(Number.isFinite(await duration())).toBe(true);

  // Nobody is chosen yet; the shared picker row offers to choose or to add a patient.
  const file = dialog.getByRole('button', { name: 'Добавить в карту', exact: true });
  await expect(file).toBeDisabled();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Выбрать пациента', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Пациент', exact: true });
  await chooser.getByRole('button', { name: 'Добавить пациента', exact: true }).click();
  await chooser.getByLabel('Имя или псевдоним').fill('Пациент беседы');
  await chooser.getByRole('button', { name: 'Создать пациента', exact: true }).click();
  await expect(dialog.getByText('Пациент беседы')).toBeVisible();
  await expect(file).toBeEnabled();
});
