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

  const bar = page.locator('.conversation-bar');
  await expect(bar).toBeVisible();
  await expect(bar.getByText('Идёт запись беседы')).toBeVisible();
  await expect(bar.locator('.conversation-bar__time')).toHaveText(/\d{2}:\d{2}/u);

  await bar.getByRole('button', { name: /Открыть окно с текстом/u }).click();
  const live = page.getByTestId('conversation-live');
  await expect(live).toBeVisible();
  await expect(bar).toHaveCount(0);
  // No speech model in the test: the timer and meter stay, with a clear note.
  await expect(live.locator('.conversation-live__time')).toHaveText(/\d{2}:\d{2}/u);
  await expect(live.getByText('Распознавание речи не включено')).toBeVisible();

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
