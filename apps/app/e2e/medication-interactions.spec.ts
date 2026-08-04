import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('checks reviewed medication relations without treating missing data as compatibility', async ({
  page,
}) => {
  await mountBuiltApp(page);

  await page.getByRole('radio', { name: 'Препараты' }).check();
  const checker = page.getByRole('region', { name: 'Проверка взаимодействий' });
  await checker.getByRole('button', { name: 'Открыть' }).click();

  const input = checker.getByLabel('Препараты через запятую или с новой строки');
  await input.fill('эсциталопрам, фосфомицин');
  await expect(checker.getByText('Данные не подтверждены')).toBeVisible();
  await expect(checker.getByText(/не подтверждает отсутствие взаимодействия/u)).toBeVisible();

  await input.fill('эсциталопрам, неизвестный препарат');
  await expect(checker.getByText(/Пары с этими названиями помечены как непроверенные/u)).toBeVisible();
  await expect(checker.getByRole('heading', { name: /Эсциталопрам \+ неизвестный препарат/u })).toBeVisible();
  await expect(checker.getByText(/не распознаны в подключённой проверенной базе/u)).toBeVisible();

  await input.fill('эсциталопрам, линезолид');
  await expect(checker.getByText('Противопоказано')).toBeVisible();
  await expect(checker.getByText('Повышенный риск серотонинового синдрома.')).toBeVisible();
  await checker.getByText('Подтверждающие источники').click();
  await expect(checker.getByRole('link', { name: /DailyMed — Escitalopram/u })).toBeVisible();
  await expect(checker.getByText(/юрисдикция: США/u)).toBeVisible();
});
