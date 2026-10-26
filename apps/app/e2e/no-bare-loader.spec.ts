import { expect, type Page, test } from '@playwright/test';
import {
  CLINICAL_DOCUMENT_ROUTE,
  installClinicalModule,
  routeClinicalModule,
} from './clinical-module-fixture';
import {
  installMedicationModule,
  routeInstructionModule,
  routeMedicationModule,
} from './medication-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// Owner 2026-10-26 (QA item 13 follow-up): a page that is still loading never shows a loader on its
// own. Every frame in which a loader (a spinner, a skeleton) is on screen must also show the way
// out: a back control, a close control or the bottom navigation. The flows below are the ones that
// produced a bare ring on the phone: a document scrolled down (controls hidden) followed by another
// document, and a drug card switching to a trade name's instruction, on a 4× slower CPU.

/** Watches every animation frame and records the frames with a loader but no way out. */
const BARE_LOADER_SAMPLER = `
(() => {
  const found = [];
  window.__bareLoaders = found;
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.top >= innerHeight) return false;
    if (rect.right <= 0 || rect.left >= innerWidth) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  };
  const LOADERS =
    '[class*="spinner"], [data-testid="skeleton-lines"], [data-testid="page-skeleton-body"], [aria-busy="true"]';
  const WAYS_OUT = '[aria-label^="Назад"], [aria-label^="Закрыть"], nav[aria-label="Разделы приложения"]';
  const tick = () => {
    const loaders = [...document.querySelectorAll(LOADERS)].filter(
      (element) => !element.closest('.boot-screen') && visible(element),
    );
    if (loaders.length > 0 && ![...document.querySelectorAll(WAYS_OUT)].some(visible)) {
      if (found.length < 20) {
        found.push({
          hash: location.hash.slice(0, 60),
          loaders: loaders.slice(0, 3).map((element) => String(element.className).slice(0, 60)),
        });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

const bareLoaders = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bareLoaders: unknown[] }).__bareLoaders);

async function goTo(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
}

/** Scrolls the reader down the way a finger does, so the shell hides its controls. */
async function readOn(page: Page): Promise<void> {
  await page.mouse.move(195, 500);
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(120);
  }
}

test('no screen shows a loader without its back control or the bottom bar', async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(BARE_LOADER_SAMPLER);
  await routeClinicalModule(page);
  await routeMedicationModule(page);
  await routeInstructionModule(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page, {
    skipLargeCompanionPacks: true,
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ experimentalModulesEnabled: true }),
    },
  });
  await installClinicalModule(page);
  await installMedicationModule(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  for (const hash of ['#/search', '#/modules', '#/notes', '#/news', '#/settings']) {
    await goTo(page, hash);
    await page.waitForTimeout(1200);
  }

  // A long recommendation read on until the controls hide, then another document opened from there.
  await goTo(page, new URL(CLINICAL_DOCUMENT_ROUTE).hash);
  await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible({
    timeout: 90_000,
  });
  await readOn(page);
  await expect(page.locator('html')).toHaveClass(/app-chrome-hidden/u);
  await goTo(page, '#/modules/documents/medications');
  await page.getByRole('searchbox', { name: 'Поиск по препаратам' }).fill('Мебендазол');
  await page.locator('.medication-product-card').first().click({ timeout: 60_000 });
  await expect(page.locator('.drug-header__title')).toBeVisible({ timeout: 60_000 });
  // The new page opened with its controls in view.
  await expect(page.locator('html')).not.toHaveClass(/app-chrome-hidden/u);

  // The drug card read on, then a trade name picked: its instruction replaces the card's text.
  await readOn(page);
  await page.locator('.drug-instruction-of .drug-link, button.drug-link').first().click();
  await expect(page.locator('.document-overlay-section__paragraph').first()).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);

  // A tool route whose code loads on first use.
  await goTo(page, '#/notes/vaccination');
  await page.waitForTimeout(2000);

  expect(await bareLoaders(page)).toEqual([]);
});

test('an empty origin check: the sampler sees a bare loader when there is one', async ({
  page,
}) => {
  await page.addInitScript(BARE_LOADER_SAMPLER);
  await page.goto(`${E2E_ASSET_ORIGIN}/`);
  await page.evaluate(() => {
    document.body.innerHTML = '<div class="probe-spinner" style="width:40px;height:40px"></div>';
  });
  await page.waitForTimeout(300);
  expect((await bareLoaders(page)).length).toBeGreaterThan(0);
});
