import { mkdirSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { installDeviceKeyAndSpeech } from './fake-speech';
import { mountBuiltApp } from './mount-built-app';

/**
 * FORMFILL1: a finished recording fills a form. The recording dialog offers «Заполнить форму»; the
 * picked form opens with its «Беседа» sheet on the values the conversation gives, each with the
 * words it rests on; only the accepted ones reach the form. Synthetic speech, no patient data.
 */
const chromiumPath = process.env.CHROMIUM_PATH;

test.use({
  permissions: ['microphone'],
  viewport: { width: 375, height: 812 },
  launchOptions: {
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    args: ['--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

const CONVERSATION = [
  'Врач: Диагноз: гипертоническая болезнь второй стадии.',
  'Врач: Противопоказаний нет. Рекомендую амбулаторно.',
  'Врач: Лучше весной или осенью.',
];

/** `E2E_SHOTS=<dir>` saves the screen in light and dark for review. */
async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_SHOTS'];
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.waitForTimeout(500);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${directory}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a finished recording fills form 070/у, accepted values only', async ({ page }) => {
  test.setTimeout(180_000);
  await installDeviceKeyAndSpeech(page, CONVERSATION);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });

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
  await expect(live.locator('.recorder-window__line')).toHaveCount(CONVERSATION.length, {
    timeout: 90_000,
  });
  await live.getByRole('button', { name: 'Стоп' }).click();

  const dialog = page.getByRole('dialog', { name: 'Запись сохранена' });
  await expect(dialog.getByRole('list', { name: 'Текст беседы' })).toContainText('Диагноз');
  await dialog.getByRole('button', { name: 'Заполнить форму', exact: true }).click();
  const forms = dialog.getByRole('list', { name: 'Форма по беседе' });
  await expect(forms.getByRole('button')).toHaveText([
    /Психический статус/u,
    /CHA₂DS₂-VASc/u,
    /PHQ-9/u,
    /Форма № 070\/у/u,
  ]);
  await forms.getByRole('button').last().scrollIntoViewIfNeeded();
  await shot(page, 'formfill-recording-forms');
  await forms.getByRole('button', { name: /Форма № 070\/у/u }).click();

  await expect(page).toHaveURL(/#\/notes\/forms\/ru\.minzdrav\.274n\.070u/u);
  const sheet = page.getByRole('dialog', { name: 'Заполнить по беседе' });
  const items = sheet.locator('.form-fill-review__item');
  await expect(items).toHaveCount(4);
  await expect(sheet.locator('.form-fill-sheet__source')).toContainText('Запись беседы');
  await expect(items.first().locator('.form-fill-review__speaker')).toHaveText('врач');
  await shot(page, 'formfill-recording-review');

  // The doctor turns the seasons down and accepts the rest.
  await items.filter({ hasText: 'весна' }).getByRole('button', { name: 'Отклонить' }).click();
  await sheet.getByRole('button', { name: 'Принять все', exact: true }).click();
  await shot(page, 'formfill-recording-decided');
  await sheet.getByRole('button', { name: 'Подставить', exact: true }).click();
  await expect(sheet).toBeHidden();

  await expect(page.locator('#form-field-diagnosis').getByRole('textbox')).toHaveValue(
    'гипертоническая болезнь второй стадии',
  );
  await expect(page.locator('#form-field-noContraindications').getByRole('checkbox')).toBeChecked();
  await expect(
    page.locator('#form-field-treatmentSetting').getByRole('radio', { name: 'амбулаторно' }),
  ).toBeChecked();
  await expect(
    page.locator('#form-field-seasons').getByRole('checkbox', { name: 'весна' }),
  ).not.toBeChecked();
  await page.locator('#form-field-diagnosis').scrollIntoViewIfNeeded();
  await shot(page, 'formfill-recording-applied');
});
