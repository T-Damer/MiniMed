import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installMedicationGroup, routeMedicationGroup } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// SRCHDRUG1 measurement, opt-in (`RECIPE_COVERAGE=<out.json>`): with the nervous-system ЕСКЛП group
// and its instructions installed, opens «⋯» → «Рецепт» on the card of every ЖНВЛП substance with an
// N ATC code (`RECIPE_COVERAGE_SLUGS`, a JSON list of card slugs) and records what the sheet says.
// Numbers: docs/research/prescription-coverage-2026-11.md.
const OUT = process.env['RECIPE_COVERAGE'];
const SLUGS = process.env['RECIPE_COVERAGE_SLUGS'];
const POINTER = 'core.catalog.pointer.medication.esklp.mnn.кветиапин-4a6836f336013c7e';

type Outcome =
  | 'no-card'
  | 'no-instruction-refused'
  | 'by-hand'
  | 'not-installed'
  | 'recipe-or-editor'
  | 'choose-form-or-strength'
  | 'card-not-in-group'
  | 'other';

/** What the sheet offers, in the order a doctor meets it. */
function classify(text: string): Outcome {
  if (/нет карточки/u.test(text)) return 'no-card';
  // Before SRCHDRUG1: no instruction → no recipe at all.
  if (/собрать не из чего|доз из неё не взять/u.test(text)) return 'no-instruction-refused';
  // After: the registry's Rp. line, the sign by hand.
  if (/впишите сами/u.test(text)) return 'by-hand';
  if (/скачайте её|не установлена/u.test(text)) return 'not-installed';
  if (/Rp\./u.test(text)) return 'recipe-or-editor';
  if (/Выберите (лекарственную форму|дозировку)/u.test(text)) return 'choose-form-or-strength';
  return 'other';
}

test('recipe coverage of the ЖНВЛП nervous-system cards', async ({ page }) => {
  test.skip(!OUT || !SLUGS, 'Measurement only: set RECIPE_COVERAGE and RECIPE_COVERAGE_SLUGS.');
  test.setTimeout(3_600_000);
  const slugs = JSON.parse(SLUGS ?? '[]') as string[];
  await routeMedicationGroup(page, 'nervous-system');
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationGroup(page, POINTER, 'esklp.mnn.кветиапин');
  const results: { slug: string; outcome: Outcome; text: string }[] = [];
  for (const slug of slugs) {
    const id = `esklp.mnn.${slug}`;
    await page.goto(
      `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`,
    );
    const menu = page.getByRole('button', { name: 'Меню действий' });
    const pointer = page.locator('.document-module-pointer__action');
    try {
      await expect(menu.or(pointer).first()).toBeVisible({ timeout: 30_000 });
    } catch {
      results.push({ slug, outcome: 'other', text: 'screen did not open' });
      continue;
    }
    // A pointer: the card lives in another group's module.
    if ((await pointer.count()) > 0) {
      results.push({ slug, outcome: 'card-not-in-group', text: '' });
      continue;
    }
    // Let the substance instruction settle: the reader swaps its document once it is read.
    await page.waitForTimeout(1500);
    await menu.click();
    const recipe = page.getByTestId('drug-recipe-button');
    if ((await recipe.count()) === 0) {
      await page.keyboard.press('Escape');
      results.push({ slug, outcome: 'other', text: 'no «Рецепт» item' });
      continue;
    }
    await recipe.click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/Загружаем указатель|Читаем инструкцию/u, {
      timeout: 30_000,
    });
    await page.waitForTimeout(400);
    const text = (await dialog.innerText()).replace(/\s+/gu, ' ').trim();
    results.push({ slug, outcome: classify(text), text: text.slice(0, 800) });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
  const counts: Record<string, number> = {};
  for (const result of results) counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
  writeFileSync(OUT ?? '', JSON.stringify({ counts, results }, null, 2));
});

// SRCHDRUG1 evidence for «По названию», opt-in (`TITLE_OVERLAP=<out.json>`): for each query, the
// title answers shown at once and the full-text result groups that follow, by title, to see whether
// the strip ever names a document the results leave out.
const OVERLAP = process.env['TITLE_OVERLAP'];
const OVERLAP_QUERIES = [
  'Кветиапин',
  'галоперидол',
  'амитриптилин',
  'оланзапин',
  'карбамазепин',
  'вальпроевая кислота',
  'сертралин',
  'флуоксетин',
  'диазепам',
  'феназепам',
  'пневмония',
  'депрессия',
  'шизофрения',
  'бронхиальная астма',
  'гипертония',
  'сахарный диабет',
  'инсульт',
  'эпилепсия',
  'мигрень',
  'биполярное расстройство',
  'артериальная гипертензия',
  'деменция',
  'тревожное расстройство',
  'алкоголизм',
  'бессонница',
];

test('title answers against the full-text results', async ({ page }) => {
  test.skip(!OVERLAP, 'Measurement only: set TITLE_OVERLAP.');
  test.setTimeout(3_600_000);
  await routeMedicationGroup(page, 'nervous-system');
  await page.setViewportSize({ width: 390, height: 30_000 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationGroup(page, POINTER, 'esklp.mnn.кветиапин');
  const rows: {
    query: string;
    titles: string[];
    results: string[];
    titlesMissingFromResults: string[];
  }[] = [];
  const key = (text: string): string =>
    text
      .toLocaleLowerCase('ru-RU')
      .replaceAll('ё', 'е')
      .replace(/[^a-zа-я0-9]+/gu, ' ')
      .trim();
  for (const query of OVERLAP_QUERIES) {
    await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
    const input = page.getByTestId('search-input');
    await expect(input).toBeEditable({ timeout: 120_000 });
    await input.fill(query);
    await page.getByTestId('search-submit').click();
    await expect(page.locator('.result-group').first()).toBeVisible({ timeout: 90_000 });
    // The whole list: the search has finished, nothing is still arriving.
    await expect(page.locator('[data-testid="search-submit"][aria-busy="true"]')).toHaveCount(0, {
      timeout: 90_000,
    });
    await expect(page.locator('.results-skeleton')).toHaveCount(0);
    await page.waitForTimeout(1500);
    const titles = await page.locator('.search-meanings--titles .choice-chip').allInnerTexts();
    // The list is virtualized: the viewport is tall enough to draw every group at once.
    const seen = new Map<string, string>();
    for (const group of await page.locator('.result-group[data-document-id]').all()) {
      seen.set((await group.getAttribute('data-document-id')) ?? '', await group.innerText());
    }
    const results = [...seen.values()].map(
      (text) => text.split('\n').find((line) => line.trim().length > 2) ?? '',
    );
    const resultKeys = [...seen.values()].map(key);
    const missing = titles.filter((title) => {
      const name = key(title.split('\n')[0] ?? title);
      return !resultKeys.some((result) => result.includes(name));
    });
    rows.push({ query, titles, results, titlesMissingFromResults: missing });
  }
  writeFileSync(
    OVERLAP ?? '',
    JSON.stringify(
      {
        queries: rows.length,
        withTitles: rows.filter((row) => row.titles.length > 0).length,
        titleAnswers: rows.reduce((sum, row) => sum + row.titles.length, 0),
        titleAnswersMissingFromResults: rows.reduce(
          (sum, row) => sum + row.titlesMissingFromResults.length,
          0,
        ),
        rows,
      },
      null,
      2,
    ),
  );
});
