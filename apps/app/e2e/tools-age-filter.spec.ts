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
  test(`filters the calculators of the search by Дети / Взрослые / Все at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
    await openHomeSection(page, 'Калькуляторы');
    await expect(tones(page).first()).toBeVisible();
    // Every card says whom the tool is for.
    await expect(tones(page).first()).not.toBeEmpty();

    await filter(page, 'Дети');
    await expect(page.getByTestId('tool-age-filter').first()).toContainText('Скрыто по возрасту');
    await expect(tones(page).first()).toBeVisible();
    await expect(page.locator('.unified-catalog__tool-shell [data-age-tone="adults"]')).toHaveCount(
      0,
    );

    await filter(page, 'Взрослые');
    await expect(tones(page).first()).toBeVisible();
    await expect(
      page.locator('.unified-catalog__tool-shell [data-age-tone="children"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('.unified-catalog__tool-shell [data-age-tone="neonates"]'),
    ).toHaveCount(0);
    if (process.env['TOOLS1_SCREENSHOTS']) {
      await page.screenshot({
        path: `${process.env['TOOLS1_SCREENSHOTS']}/search-calculators-adults-${width}-light.png`,
      });
    }

    // The choice is stored as a preference (the next launch starts with it).
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('minimed.app-preferences.v1') ?? '{}'),
    );
    expect(stored.toolAgeFilter).toBe('adults');
    await filter(page, 'Все');
    await expect(page.getByTestId('tool-age-filter').first()).not.toContainText(
      'Скрыто по возрасту',
    );
  });
}

test('starts with the remembered choice', async ({ page }) => {
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
  await expect(page.getByTestId('tool-age-filter').first().locator('input:checked')).toHaveValue(
    'children',
  );
  await expect(tones(page).first()).toBeVisible();
  await expect(page.locator('.unified-catalog__tool-shell [data-age-tone="adults"]')).toHaveCount(
    0,
  );
});

test('filters questionnaires and keeps one choice across every list', async ({ page }) => {
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await openHomeSection(page, 'Опросники');
  await expect(tones(page).first()).toBeVisible();
  await filter(page, 'Дети');
  await expect(page.locator('.unified-catalog__tool-shell [data-age-tone="adults"]')).toHaveCount(
    0,
  );
  // The create-your-own card is an action, never hidden by the age choice.
  await expect(
    page.locator('.unified-catalog__tool-shell', { hasText: 'Создать свой опросник' }),
  ).toBeVisible();

  // The same choice is on in the calculators page and in the all-tools sheet.
  await page.evaluate(() => {
    window.location.hash = '#/calculators';
  });
  await expect(page.getByTestId('tool-age-filter').first().locator('input:checked')).toHaveValue(
    'children',
  );
  await page.evaluate(() => {
    window.location.hash = '#/search';
  });
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet.getByTestId('tool-age-filter').locator('input:checked')).toHaveValue(
    'children',
  );
});

test('hides a starred adult tool from the tool row and the sheet while children are chosen', async ({
  page,
}) => {
  await mountBuiltApp(page, { splitNavigation: true, skipLargeCompanionPacks: true });
  await openHomeSection(page, 'Калькуляторы');
  await page.getByTestId('search-input').fill(adultCalculator);
  const shell = card(page, adultCalculator).first();
  await shell.getByRole('button', { name: `Добавить «${adultCalculator}» в избранное` }).click();
  await page.getByTestId('search-input').fill('');
  const row = page.locator('.search-quick-access');
  await expect(row.getByRole('button', { name: adultCalculator })).toBeVisible();
  await filter(page, 'Дети');
  await expect(row.getByRole('button', { name: adultCalculator })).toHaveCount(0);
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet.locator('.quick-tool-row', { hasText: adultCalculator })).toHaveCount(0);
  await expect(sheet.getByTestId('tool-age-filter')).toContainText('Скрыто по возрасту');
  await sheet.getByTestId('tool-age-filter').getByText('Все', { exact: true }).click();
  await expect(sheet.locator('.quick-tool-row', { hasText: adultCalculator })).toBeVisible();
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
