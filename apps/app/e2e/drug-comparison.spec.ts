import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  routeInstructionModule,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// CMP1: «Сравнение препаратов». The antiparasitic ГРЛС instruction module (a local release copy, see
// docs/data-ledger.json) holds the instructions of albendazole and mebendazole; the test installs it
// through the tool's own download offer. Skipped when the copy is absent.
// Screenshots: CMP1_SHOTS=<directory> (390 and 1280 wide, light and dark).
const SHOTS = process.env['CMP1_SHOTS'];

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  if (!SHOTS) return;
  const width = page.viewportSize()?.width ?? 0;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: `${SHOTS}/${name}-${width}-${colorScheme}.png`,
      fullPage,
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const PREFERENCES = {
  'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
};

for (const width of [390, 1280]) {
  test(`a comparison query opens the tool, which quotes both instructions (${width} px)`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await routeInstructionModule(page);
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });

    // A query of two drugs gets a card above the unchanged results; two diseases get none.
    const input = page.getByTestId('search-input');
    await expect(input).toBeEnabled({ timeout: 60_000 });
    await input.fill('албендазол или мебендазол');
    await page.getByTestId('search-submit').click();
    const suggestion = page.getByTestId('comparison-suggestion');
    await expect(suggestion).toContainText('Сравнить:', { timeout: 60_000 });
    await expect(suggestion).toContainText('Албендазол');
    await expect(suggestion).toContainText('Мебендазол');
    await expect(suggestion).toContainText('а не клиническая рекомендация');
    await expect(page.getByTestId('search-results')).toBeVisible();
    await shoot(page, 'search-card');

    await input.fill('менингит или энцефалит');
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('comparison-suggestion')).toHaveCount(0);

    await input.fill('сравнить албендазол и мебендазол');
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('comparison-suggestion')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('comparison-suggestion').click();

    // The tool: two columns, registry rows from the index, the notice.
    await expect(page).toHaveURL(/#\/notes\/drug-comparison\?/u);
    const items = page.getByTestId('comparison-item');
    await expect(items).toHaveCount(2, { timeout: 60_000 });
    await expect(page.getByTestId('comparison-notice')).toContainText(
      'Сравнение текстов инструкций, а не клиническая рекомендация',
    );
    const columns = page.getByTestId('comparison-column');
    await expect(columns).toHaveCount(2);
    await expect(page.getByTestId('comparison-matrix')).toContainText('Код АТХ и группа');
    await expect(page.getByTestId('comparison-matrix')).toContainText('Перечень ЖНВЛП');
    await expect(page.getByTestId('comparison-matrix')).toContainText(
      'Лекарственные формы и дозировки',
    );

    // The instructions are not installed yet: one offer, then the quoted sections and the marks.
    const offer = page.locator('.drug-interactions__offer-button');
    await expect(offer).toHaveCount(1, { timeout: 60_000 });
    await shoot(page, 'not-installed');
    await offer.click({ force: true });
    await expect(page.getByTestId('comparison-source').first()).toContainText('ГРЛС', {
      timeout: 180_000,
    });
    const section = page.getByTestId('comparison-section').first();
    await expect(section).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('comparison-cluster').first()).toBeVisible();
    const marks = await page.getByTestId('comparison-mark').allTextContents();
    expect(marks.some((text) => /только у|у обоих/u.test(text))).toBe(true);
    for (const text of marks) expect(text).not.toMatch(/лучше|хуже|рекоменду/iu);
    await shoot(page, 'compared');

    // Only differences hides the statements that are the same in both.
    const before = await page.getByTestId('comparison-cluster').count();
    await page.getByRole('switch', { name: 'Показать только различия' }).click();
    const after = await page.getByTestId('comparison-cluster').count();
    expect(after).toBeLessThanOrEqual(before);
    const kinds = await page
      .getByTestId('comparison-cluster')
      .evaluateAll((nodes) =>
        nodes.map(
          (node) => `${node.getAttribute('data-kind')}|${node.getAttribute('data-identical')}`,
        ),
      );
    expect(kinds).not.toContain('shared|true');
    await shoot(page, 'only-differences');

    // A quoted statement opens the instruction at its place.
    const link = page.locator('.drug-comparison__link').first();
    await link.click();
    await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
    await page.goBack();
    await expect(page.getByTestId('comparison-item')).toHaveCount(2, { timeout: 60_000 });
  });
}

test('the tool opens from an address and takes drugs from the picker, at most four', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1100, height: 900 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-comparison?d=албендазол&d=ксзвцфыв`);
  await expect(page.getByTestId('comparison-item')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.drug-comparison__item--missing')).toContainText('ксзвцфыв');
  await expect(page.getByTestId('comparison-empty')).toContainText('ещё один препарат');
  const picker = page.getByRole('searchbox', { name: 'Добавить препарат' });
  await picker.fill('пирантел');
  await page.locator('.drug-comparison__candidate').first().click();
  await expect(page.getByTestId('comparison-item')).toHaveCount(2);
  await expect(page.getByTestId('comparison-matrix')).toBeVisible();
  for (const name of ['празиквантел', 'мебендазол']) {
    await picker.fill(name);
    await page.locator('.drug-comparison__candidate').first().click();
  }
  await expect(page.getByTestId('comparison-item')).toHaveCount(4);
  await expect(page.getByTestId('comparison-column')).toHaveCount(4);
  await expect(page.locator('.drug-comparison__hint').first()).toContainText('предел в 4');
  // Removing a drug removes its column.
  await page
    .getByRole('button', { name: /Убрать «Пирантел»/u })
    .first()
    .click();
  await expect(page.getByTestId('comparison-column')).toHaveCount(3);
});

test('the interaction tool links to the comparison of its drugs', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?d=албендазол&d=празиквантел`);
  const link = page.getByTestId('interaction-compare-link');
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toContainText('Сравнить эти препараты');
  await expect(link).toHaveAttribute('href', /#\/notes\/drug-comparison\?c=.*c=/u);
  await link.click();
  await expect(page.getByTestId('comparison-item')).toHaveCount(2, { timeout: 60_000 });
});

test('a drug card offers «Сравнить с…»', async ({ page }) => {
  test.setTimeout(240_000);
  await routeMedicationModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true, localStorage: PREFERENCES });
  await installMedicationModule(page);
  const link = page.getByTestId('drug-compare-link');
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toHaveAttribute('href', /#\/notes\/drug-comparison\?c=/u);
  await shoot(page, 'drug-card', false);
  await link.click();
  await expect(page.getByTestId('comparison-item')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId('comparison-empty')).toContainText('ещё один препарат');
});

test('the tool is listed among the tools', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  const input = page.getByTestId('search-input');
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.fill('сравнение препаратов');
  await page.getByTestId('search-submit').click();
  await expect(page.getByText('Сравнение препаратов').first()).toBeVisible({ timeout: 60_000 });
});
