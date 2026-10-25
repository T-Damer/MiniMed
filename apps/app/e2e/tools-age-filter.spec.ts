import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';
import { openHomeSection } from './select-search-section';

interface Tool {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly definition: { readonly ageScope: { readonly groups: readonly string[] } };
}

const tools: readonly Tool[] = [
  'core-clinical',
  'pediatrics',
  'neonatology',
  'psychology',
  'emergency',
].flatMap(
  (name) =>
    (JSON.parse(readFileSync(`content/tool-modules/${name}.json`, 'utf8')) as { tools: Tool[] })
      .tools,
);

function titleWhere(kind: string, groups: readonly string[]): string {
  const found = tools.find(
    (tool) =>
      tool.kind === kind &&
      tool.definition.ageScope.groups.length === groups.length &&
      groups.every((group) => tool.definition.ageScope.groups.includes(group)),
  );
  if (!found) throw new Error(`no ${kind} tool for ${groups.join(',')}`);
  return found.title;
}

const adultCalculator = titleWhere('calculator', ['adults']);

async function filter(page: Page, label: 'Дети' | 'Взрослые' | 'Все'): Promise<void> {
  await page.getByTestId('tool-age-filter').first().getByText(label, { exact: true }).click();
}

const card = (page: Page, title: string) =>
  page.locator('.unified-catalog__tool-shell', { hasText: title });

/** The catalog grid renders only the cards in view, so assert on the age tones that are there. */
const tones = (page: Page) => page.locator('.unified-catalog__tool-shell .tool-age-badge');

for (const width of [390, 1280]) {
  test(`search lists every calculator with its age tag and no age filter at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
    await openHomeSection(page, 'Калькуляторы');
    await expect(tones(page).first()).toBeVisible();
    // Every card says whom the tool is for; search itself has no «Дети / Взрослые / Все» switch.
    await expect(tones(page).first()).not.toBeEmpty();
    await expect(page.getByTestId('tool-age-filter')).toHaveCount(0);
    await page.getByTestId('search-input').fill(adultCalculator);
    await expect(card(page, adultCalculator).first()).toBeVisible();
  });
}

test('a remembered children choice does not hide adult tools in search', async ({ page }) => {
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({
        splitNavigation: true,
        toolAgeFilter: 'children',
      }),
    },
  });
  await openHomeSection(page, 'Калькуляторы');
  await page.getByTestId('search-input').fill(adultCalculator);
  const shell = card(page, adultCalculator).first();
  await expect(shell).toBeVisible();
  // A starred adult tool stays in the tool row and the sheet whatever age was chosen elsewhere.
  await shell.getByRole('button', { name: `Добавить «${adultCalculator}» в избранное` }).click();
  await page.getByTestId('search-input').fill('');
  await expect(
    page.locator('.search-quick-access').getByRole('button', { name: adultCalculator }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet.getByTestId('tool-age-filter')).toHaveCount(0);
  await expect(sheet.locator('.quick-tool-row', { hasText: adultCalculator })).toBeVisible();
});

test('questionnaires in search keep the create card and every age group', async ({ page }) => {
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await openHomeSection(page, 'Опросники');
  await expect(tones(page).first()).toBeVisible();
  await expect(page.getByTestId('tool-age-filter')).toHaveCount(0);
  await expect(
    page.locator('.unified-catalog__tool-shell', { hasText: 'Создать свой опросник' }),
  ).toBeVisible();
});

test('filters the calculator sections and an assessment specialty page', async ({ page }) => {
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await page.evaluate(() => {
    window.location.hash = '#/calculators/section/renal';
  });
  await expect(page.getByRole('heading', { name: 'Функция почек' })).toBeVisible();
  await filter(page, 'Дети');
  await expect(page.locator('.calculator-card', { hasText: 'CKiD' }).first()).toBeVisible();
  await expect(page.locator('.calculator-card', { hasText: 'CKD-EPI' })).toHaveCount(0);
  await filter(page, 'Взрослые');
  await expect(page.locator('.calculator-card', { hasText: 'CKD-EPI' }).first()).toBeVisible();
  await expect(page.locator('.calculator-card', { hasText: 'CKiD' })).toHaveCount(0);
  await filter(page, 'Все');

  await page.evaluate(() => {
    window.location.hash = '#/assessments/neonatology';
  });
  await expect(page.locator('.assessment-section').first()).toBeVisible();
  await filter(page, 'Взрослые');
  await expect(page.getByText('Для выбранного возраста в этом разделе нет тестов')).toBeVisible();
  await filter(page, 'Дети');
  await expect(page.locator('.assessment-section').first()).toBeVisible();
});
