import { expect, type Page, test } from '@playwright/test';
import { routeInstructionModule } from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { routeSeverityModule } from './severity-module-fixture';

// INT2: the optional DDInter severity labels. The antiparasitic ГРЛС instruction module holds the
// instruction of albendazole, which names praziquantel; DDInter lists the pair as «Minor». Both
// modules are local release copies (docs/data-ledger.json); the test skips when one is absent.
// Screenshots: INT2_SHOTS=<directory>.
const SHOTS = process.env['INT2_SHOTS'];

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `${SHOTS}/${name}-${colorScheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a pair gets no label without the module, and a labelled, sourced one after installing it', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeInstructionModule(page);
  await routeSeverityModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?d=албендазол&d=празиквантел`);
  await expect(page.getByTestId('interaction-item')).toHaveCount(2, { timeout: 150_000 });

  // The instruction is installed first: a label needs a sentence that can be quoted.
  await page.locator('.drug-interactions__offer-button').first().click({ force: true });
  const quote = page.locator('.drug-interactions__quote').first();
  await expect(quote).toBeVisible({ timeout: 180_000 });
  await expect(quote).toContainText(/празиквант/iu);

  // Without the optional module: no label, an offer that names the source and the licence.
  await expect(page.getByTestId('interaction-severity')).toHaveCount(0);
  const offer = page.getByTestId('severity-offer');
  await expect(offer).toContainText('DDInter', { timeout: 60_000 });
  await expect(offer).toContainText('CC BY-NC-SA 4.0');
  await expect(page.getByTestId('severity-source')).toHaveCount(0);
  await shoot(page, 'severity-offer');

  // Install the module from its local bytes.
  const button = page.getByTestId('severity-offer-button');
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  const label = page.getByTestId('interaction-severity');
  await expect(label).toBeVisible({ timeout: 180_000 });
  await expect(label).toContainText('Слабое по DDInter');
  await expect(label).toContainText('не из инструкции');
  await expect(label.locator('.drug-interactions__severity-label')).toHaveAttribute(
    'data-level',
    'minor',
  );
  // The label sits with the quoted sentence; the source block names the licence and the date.
  await expect(page.getByTestId('interaction-pair')).toHaveCount(1);
  await expect(quote).toBeVisible();
  const source = page.getByTestId('severity-source');
  await expect(source).toContainText('DDInter 2.0');
  await expect(source).toContainText('CC BY-NC-SA 4.0');
  await expect(source).toContainText('2026-10-06');
  await expect(page.getByTestId('severity-offer')).toHaveCount(0);
  await shoot(page, 'severity-label');

  // The module does not leak into the ordinary search.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/`);
  await page.getByTestId('search-input').fill('албендазол празиквантел');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('search-results')).not.toContainText('DDInter');
  await expect(page.getByTestId('search-results')).not.toContainText('ddinter.severity');
});

test('a pair that has no instruction sentence gets no label, even with the module installed', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeInstructionModule(page);
  await routeSeverityModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?d=албендазол&d=пирантел`);
  await expect(page.getByTestId('interaction-item')).toHaveCount(2, { timeout: 150_000 });
  await expect(page.getByTestId('interaction-pair')).toHaveCount(1);
  await expect(page.getByTestId('interaction-pair-status')).toContainText('упоминаний не найдено');
  await expect(page.getByTestId('interaction-severity')).toHaveCount(0);
  // Nothing found: no offer to download labels for a pair that could not show one.
  await expect(page.getByTestId('severity-offer')).toHaveCount(0);
});

test('sentences from the other sections are folded, the interaction section stays in view', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeInstructionModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  // The pyrantel instruction names levamisole in its interaction section; the levamisole
  // instruction names pyrantel among its contraindications.
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/drug-interactions?d=левамизол&d=пирантел`);
  await expect(page.getByTestId('interaction-item')).toHaveCount(2, { timeout: 150_000 });
  await page.locator('.drug-interactions__offer-button').first().click({ force: true });
  const quotes = page.locator('.drug-interactions__quote');
  await expect(quotes.first()).toBeVisible({ timeout: 180_000 });
  await expect(quotes).toHaveCount(1);
  await expect(quotes.first().locator('.drug-interactions__quote-section')).toContainText(
    'Взаимодействие с другими лекарственными средствами',
  );

  const fold = page.locator('.drug-interactions__fold');
  await expect(fold).toHaveCount(1);
  await expect(fold).toContainText('ещё из других разделов (1)');
  await expect(fold.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('interaction-fold-body')).toHaveCount(0);
  await shoot(page, 'fold-closed');

  await fold.getByRole('button').click();
  await expect(fold.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  const folded = page.getByTestId('interaction-fold-body').locator('.drug-interactions__quote');
  await expect(folded).toHaveCount(1);
  await expect(folded.locator('.drug-interactions__quote-section')).toContainText(
    'Противопоказания',
  );
  await shoot(page, 'fold-open');
  // No DDInter module here: no label and no source block.
  await expect(page.getByTestId('interaction-severity')).toHaveCount(0);
});
