import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

const ORIGIN = process.env['MINIMED_LIVE_URL'] ?? E2E_ASSET_ORIGIN;
const WAIT_MESSAGE = 'Загружаем ядро знаний, подождите';

test.use({ viewport: { width: 375, height: 812 } });

/** Opens the home with the core download held back; `release()` lets it through. */
async function openHomeWithHeldCore(
  page: Page,
  route = '',
): Promise<{ readonly release: () => void }> {
  await page.addInitScript(() => {
    localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    localStorage.setItem('minimed:core-download-consent:v1', '1');
  });
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/core.db', async (handled) => {
    await gate;
    await handled.continue();
  });
  await page.goto(`${ORIGIN}/${route}`, { waitUntil: 'domcontentloaded' });
  return { release };
}

const sectionRow = (page: Page, label: string) =>
  page.locator('.search-sections__row', {
    has: page.locator('.search-sections__name', { hasText: new RegExp(`^${label}$`, 'u') }),
  });

test('the «Все инструменты» button is an icon-only capsule as tall as a chip', async ({
  page,
}, testInfo) => {
  const { release } = await openHomeWithHeldCore(page);
  try {
    const all = page.getByRole('button', { name: 'Все инструменты', exact: true });
    await expect(all).toBeVisible();
    await expect(all).toHaveText('');
    const allBox = await all.boundingBox();
    expect(allBox).not.toBeNull();
    // A chip's height (2.25rem), wider than tall: a capsule, not the old 44 px circle.
    expect(allBox?.height ?? 0).toBeGreaterThanOrEqual(34);
    expect(allBox?.height ?? 0).toBeLessThanOrEqual(38);
    expect(allBox?.width ?? 0).toBeGreaterThan(allBox?.height ?? 0);
    await page.screenshot({ path: testInfo.outputPath('home-capsule.png') });
  } finally {
    release();
  }
});

test('a section that needs the core does not open while the core loads, and says why', async ({
  page,
}, testInfo) => {
  const { release } = await openHomeWithHeldCore(page);
  try {
    const medications = sectionRow(page, 'Препараты');
    await expect(medications).toBeVisible();
    await expect(medications).toHaveAttribute('aria-disabled', 'true');
    // aria-disabled: a pointer tap still reaches the row and is answered with the notice.
    await medications.dispatchEvent('click');
    await expect(page.getByText(WAIT_MESSAGE)).toBeVisible();
    await expect(page).not.toHaveURL(/#\/search\/section\//u);
    await expect(page.locator('.search-sections__row').first()).toBeVisible();
    await expect(page.getByText('Открываем каталог')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('section-tap-while-loading.png') });

    // The scope picker answers the same way and keeps the current choice.
    await page.getByRole('button', { name: 'Раздел поиска', exact: true }).click();
    await page
      .locator('.search-section-menu__row')
      .getByRole('button', { name: /^Препараты(?: \(|$)/u })
      .dispatchEvent('click');
    await expect(page.locator('.search-source-picker__label')).toContainText('Все источники');

    // Tools do not need the core: their section still opens.
    await page.keyboard.press('Escape');
    await sectionRow(page, 'Калькуляторы').click();
    await expect(page).toHaveURL(/#\/search\/section\/calculators$/u);
    await expect(page.locator('.unified-catalog__tool').first()).toBeVisible();
  } finally {
    release();
  }
});

test('a section address reached while the core loads shows one loading state, then the catalog', async ({
  page,
}, testInfo) => {
  const { release } = await openHomeWithHeldCore(page, '#/search/section/medications');
  try {
    const wait = page.locator('.search-section-wait');
    await expect(wait).toBeVisible();
    await expect(wait).toContainText(WAIT_MESSAGE);
    await expect(page.getByText('Открываем каталог')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('section-address-while-loading.png') });
  } finally {
    release();
  }
  // The same place shows the finished catalog once the core is ready.
  await expect(page.locator('.search-section-wait')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator('.search-sections__row')).toHaveCount(0);
});
