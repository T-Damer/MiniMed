import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

/**
 * FORMFILL1: «Заполнить по беседе» on form 070/у. A pasted conversation proposes values, each with
 * the words it rests on; only the accepted ones reach the form.
 */
const CONVERSATION = [
  'Врач: Диагноз: гипертоническая болезнь второй стадии.',
  'Врач: Сопутствующие: остеохондроз поясничного отдела.',
  'Врач: Противопоказаний нет. Рекомендую амбулаторно, курсовку.',
  'Пациентка: Хотела бы в Кисловодск.',
  'Врач: Лучше весной или осенью.',
].join('\n');

test('fills form 070/у from a pasted conversation, accepted values only', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/forms/ru.minzdrav.274n.070u`);

  await page.getByRole('button', { name: 'Заполнить по беседе', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Заполнить по беседе' });
  await sheet.getByRole('button', { name: 'Вставить текст', exact: true }).click();
  await sheet
    .getByPlaceholder('Вставьте расшифровку: каждая реплика с новой строки')
    .fill(CONVERSATION);
  await sheet.getByRole('button', { name: 'Разобрать', exact: true }).click();

  const items = sheet.locator('.form-fill-review__item');
  await expect(items).toHaveCount(6);
  const place = items.filter({ hasText: 'Кисловодск' });
  await expect(place.locator('.form-fill-review__quote')).toContainText('Хотела бы в Кисловодск');
  await expect(place.locator('.form-fill-review__speaker')).toHaveText('пациент');

  // The doctor turns the preferred place down and accepts the rest.
  await place.getByRole('button', { name: 'Отклонить' }).click();
  await sheet.getByRole('button', { name: 'Принять все', exact: true }).click();
  await sheet.getByRole('button', { name: 'Подставить', exact: true }).click();
  await expect(sheet).toBeHidden();

  await expect(page.locator('#form-field-diagnosis').getByRole('textbox')).toHaveValue(
    'гипертоническая болезнь второй стадии',
  );
  await expect(page.locator('#form-field-comorbidities').getByRole('textbox')).toHaveValue(
    'остеохондроз поясничного отдела',
  );
  await expect(page.locator('#form-field-noContraindications').getByRole('checkbox')).toBeChecked();
  await expect(
    page.locator('#form-field-treatmentSetting').getByRole('radio', { name: 'амбулаторно' }),
  ).toBeChecked();
  await expect(
    page.locator('#form-field-seasons').getByRole('checkbox', { name: 'весна' }),
  ).toBeChecked();
  await expect(
    page.locator('#form-field-seasons').getByRole('checkbox', { name: 'осень' }),
  ).toBeChecked();
  await expect(
    page.locator('#form-field-seasons').getByRole('checkbox', { name: 'лето' }),
  ).not.toBeChecked();
  await expect(page.locator('#form-field-preferredPlace').getByRole('textbox')).toHaveValue('');
});
