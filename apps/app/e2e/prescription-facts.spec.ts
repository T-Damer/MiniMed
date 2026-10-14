import { expect, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// VIS2: the patient row of «Назначение». An example in a field is a muted hint, never a value that
// looks typed; the age group is one segmented control; the two states sit in one even row.
test('the age and weight fields hold hints, not example values, and the group fits one row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/prescription`);

  const age = page.getByTestId('prescription-age');
  const weight = page.getByTestId('prescription-weight');
  await expect(age).toBeVisible();
  // No example value is suggested.
  await expect(age).toHaveAttribute('placeholder', 'лет, мес');
  await expect(weight).toHaveAttribute('placeholder', 'кг');
  await expect(age).toHaveValue('');

  // The hint is lighter than typed text.
  const colours = await age.evaluate((input) => ({
    hint: getComputedStyle(input, '::placeholder').color,
    typed: getComputedStyle(input).color,
  }));
  expect(colours.hint).not.toBe(colours.typed);

  // «Ребёнок / Взрослый» is one control across the row; the states below share one even row.
  const group = page
    .getByRole('radiogroup', { name: 'Возрастная группа' })
    .or(page.locator('.prescription__group'));
  await expect(group.getByText('Ребёнок')).toBeVisible();
  await expect(group.getByText('Взрослый')).toBeVisible();
  const groupBox = await group.first().boundingBox();
  expect(groupBox?.width ?? 0).toBeGreaterThan(300);
  const chips = page.locator('.prescription__states .choice-chip');
  await expect(chips).toHaveCount(2);
  const [first, second] = await Promise.all([
    chips.nth(0).boundingBox(),
    chips.nth(1).boundingBox(),
  ]);
  expect(Math.abs((first?.y ?? 0) - (second?.y ?? 100))).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // Choosing an age group clears nothing else and selects exactly one.
  await group.getByText('Ребёнок').click();
  await expect(group.getByRole('radio', { name: 'Ребёнок' })).toBeChecked();
  await group.getByText('Взрослый').click();
  await expect(group.getByRole('radio', { name: 'Взрослый' })).toBeChecked();
  await expect(group.getByRole('radio', { name: 'Ребёнок' })).not.toBeChecked();
});

test('the recipe sheet names what is missing and keeps its tools in view', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/prescription`);
  await page.getByTestId('prescription-recipe-button').click();
  const dialog = page.getByRole('dialog', { name: 'Рецепт' });
  await expect(dialog).toContainText('Добавьте препарат');
  // Copy, share and print are there but dimmed until there is a text.
  await expect(dialog.getByRole('button', { name: 'Копировать' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Поделиться' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Печать' })).toBeDisabled();
});
