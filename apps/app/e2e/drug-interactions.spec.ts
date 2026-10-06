import { expect, type Page, test } from '@playwright/test';
import { routeInstructionModule } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// INT1: a search over the sentences of the official instructions that name another drug. The
// antiparasitic ГРЛС instruction module (a local release copy, see docs/data-ledger.json) holds the
// instruction of albendazole, which names praziquantel; the test installs it through the tool's own
// download offer. Skipped when the copy is absent. Screenshots: INT1_SHOTS=<directory>.
const SHOTS = process.env['INT1_SHOTS'];

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a search for two drugs opens the tool, offers the instruction and quotes it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeInstructionModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });

  // The search entry: names read from the query, shown on a card above the ordinary results.
  const input = page.getByTestId('search-input');
  await expect(input).toHaveAttribute('data-search-ready', 'true', { timeout: 60_000 });
  await input.fill('албендазол взаимодействие с празиквантелом');
  await page.getByTestId('search-submit').click();
  const suggestion = page.getByTestId('interaction-suggestion');
  await expect(suggestion).toContainText('Проверить взаимодействие: албендазол, празиквантелом', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('search-results')).toBeVisible();
  await shoot(page, 'search-card');
  await suggestion.click();

  // The tool looks both names up with the drug search.
  await expect(page).toHaveURL(/#\/notes\/drug-interactions\?/u);
  const items = page.getByTestId('interaction-item');
  await expect(items).toHaveCount(2, { timeout: 60_000 });
  await expect(items.nth(0)).toContainText('Албендазол');
  await expect(items.nth(1)).toContainText('Празиквантел');
  await expect(page.getByTestId('interaction-notice')).toContainText(
    'не система поддержки врачебных решений',
  );
  await expect(page.locator('.drug-interactions__vidal')).toHaveAttribute(
    'href',
    'https://www.vidal.ru/drugs/interaction/new',
  );

  // The index knows the sentence; the instruction is not installed yet: the module is offered.
  const pair = page.getByTestId('interaction-pair');
  await expect(pair).toHaveCount(1);
  await expect(page.getByTestId('interaction-pair-status')).toContainText('Упоминание найдено');
  await expect(page.getByTestId('interaction-side-status').first()).toContainText(
    'инструкция не установлена',
  );
  const offer = page.locator('.drug-interactions__offer-button');
  await expect(offer).toHaveCount(1, { timeout: 60_000 });
  await expect(offer).toContainText('Скачать инструкции группы', { timeout: 60_000 });
  await shoot(page, 'not-installed');
  await offer.click({ force: true });

  // After the download the sentence is quoted from the installed instruction, the other drug marked.
  const quote = page.locator('.drug-interactions__quote').first();
  await expect(quote).toBeVisible({ timeout: 180_000 });
  await expect(quote).toContainText(/празиквант/iu);
  await expect(quote.locator('.drug-interactions__mark').first()).toContainText(/празиквант/iu);
  await expect(page.locator('.drug-interactions__side-source').first()).toContainText('ГРЛС');
  await shoot(page, 'found');

  // The quote opens the instruction at its place.
  await quote.locator('.drug-interactions__quote-link').click();
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
  await page.goBack();
  await expect(page.getByTestId('interaction-pair')).toHaveCount(1, { timeout: 60_000 });

  // A pair the instructions do not connect says so without calling it safe; alcohol is an item too.
  await page.getByRole('searchbox', { name: 'Добавить препарат' }).fill('пирантел');
  await page.locator('.drug-interactions__candidate').first().click();
  await page.locator('.drug-interactions__alcohol').click();
  await expect(items).toHaveCount(4);
  await expect(page.getByTestId('interaction-pair')).toHaveCount(6);
  const statuses = await page.getByTestId('interaction-pair-status').allTextContents();
  expect(statuses.some((text) => text.includes('упоминаний не найдено'))).toBe(true);
  for (const text of statuses) expect(text).not.toMatch(/безопасн/iu);
  await expect(page.getByTestId('interaction-summary')).toContainText('Пар: 6');
  await shoot(page, 'four-items');
});

test('the tool opens from an address and keeps the names that match no drug', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?d=албендазол&d=ксзвцфыв`);
  const items = page.getByTestId('interaction-item');
  await expect(items).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.drug-interactions__item--missing')).toContainText('ксзвцфыв');
  await expect(page.getByTestId('interaction-pair')).toHaveCount(0);
  await expect(page.locator('.drug-interactions__empty')).toContainText('два препарата');
});
