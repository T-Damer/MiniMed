import { expect, type Page, test } from '@playwright/test';
import {
  installMedicationModule,
  routeInstructionModule,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// LEAF1 (2026-10-15): the table of contents of a patient leaflet is one list at the top of the
// instruction, not headings and one-line chunks (docs/CURRENT_STATE.md «LEAF1»). Installs the
// smallest ЕСКЛП group and its ГРЛС instruction module from their published bytes (local release
// copies, docs/data-ledger.json); skipped when absent. Screenshots: LEAF1_SHOTS=<directory>.
const SHOTS = process.env['LEAF1_SHOTS'];

const DRUGS = [
  'Вермокс',
  'Декарис',
  'Немозол',
  'Гелмодол',
  'Празиквантел',
  'Пирантел',
  'Албендазол-Алиум',
] as const;

async function openInstruction(page: Page, name: string): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/medications`);
  await page.getByRole('searchbox', { name: 'Поиск по препаратам' }).fill(name);
  await page.locator('.medication-product-card').first().click({ timeout: 60_000 });
  await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 30_000 });
  const offer = page.locator('.document-medication-product__offer-button');
  if (await offer.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await offer.click({ force: true });
  }
  await expect(page.getByRole('radio', { name: 'Инструкция' })).toBeEnabled({ timeout: 180_000 });
  await page.getByRole('radio', { name: 'Инструкция' }).check({ force: true });
  // The instruction's source rows are under «⋯» → «Информация» (owner 2026-10-20): wait for its text.
  await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible();
}

test('the contents of a leaflet is one list: no section made of an entry, no lone list number', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await routeMedicationModule(page);
  await routeInstructionModule(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installMedicationModule(page);
  for (const name of DRUGS) {
    await openInstruction(page, name);
    await page.waitForTimeout(600);
    const report = await page.evaluate(() => {
      const headings = Array.from(
        document.querySelectorAll('[class*="document-overlay-section"] :is(h1,h2,h3,h4)'),
      ).map((element) => element.textContent?.trim() ?? '');
      const paragraphs = Array.from(
        document.querySelectorAll('.document-overlay-section__paragraph'),
      ).map((element) => element.textContent?.trim() ?? '');
      const lists = Array.from(document.querySelectorAll('ol.document-text-list')).map((list) =>
        Array.from(list.querySelectorAll('li')).map((item) => item.textContent?.trim() ?? ''),
      );
      return { headings, paragraphs, lists };
    });
    const contents = report.lists.find((items) =>
      /^Что из себя представляет/u.test(items[0] ?? ''),
    );
    console.log(
      `LEAF1 ${name}: headings ${report.headings.length}, contents list ${contents?.length ?? 0}`,
    );
    // no paragraph is only a list number, and a contents list has its six entries
    expect(report.paragraphs.filter((text) => /^\d{1,2}\.?$/u.test(text))).toEqual([]);
    if (contents) expect(contents.length).toBeGreaterThanOrEqual(5);
    if (name === 'Вермокс') {
      expect(contents).toHaveLength(6);
      // the reader numbers the <ol> itself
      expect(contents?.[3]).toBe('Возможные нежелательные реакции.');
      // before the first real section there is no heading made of a contents entry
      const first = report.headings.findIndex((heading) => /^1\.\s*Что из себя/u.test(heading));
      expect(first).toBeGreaterThan(0);
      expect(report.headings.slice(0, first)).toEqual(['Общая информация']);
    }
    if (SHOTS) {
      const list = page
        .locator('ol.document-text-list')
        .filter({ hasText: 'Что из себя представляет' });
      if ((await list.count()) > 0) await list.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/leaf1-${name}-375.png` });
    }
  }
});
