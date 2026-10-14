import {
  E2E_ASSET_ORIGIN,
  mountBuiltApp,
  waitForSearchEditable,
} from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, test } from '@playwright/test';

import {
  type ContrastFailure,
  contrastFailures,
  coveredByNavigation,
  smallTargets,
} from './readability-audit';

/** Screens that open without a download: each is audited in light and dark, on a phone and a desk. */
const SCREENS: readonly { readonly name: string; readonly hash: string }[] = [
  { name: 'search home', hash: '#/search' },
  { name: 'calculators', hash: '#/calculators' },
  { name: 'calculator section', hash: '#/calculators/section/unit-conversion' },
  { name: 'unit converter', hash: '#/calculators/unit-conversion' },
  { name: 'assessments', hash: '#/assessments' },
  { name: 'drug comparison', hash: '#/notes/drug-comparison' },
  { name: 'drug interactions', hash: '#/notes/drug-interactions' },
  { name: 'vaccination', hash: '#/notes/vaccination' },
  { name: 'knowledge base', hash: '#/modules/documents' },
  { name: 'settings', hash: '#/settings' },
  { name: 'news', hash: '#/news' },
];

async function openScreen(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
  await page.waitForTimeout(1200);
}

function format(failures: ReadonlyMap<string, readonly ContrastFailure[]>): string {
  return [...failures]
    .map(
      ([screen, items]) =>
        `${screen}\n${items
          .map(
            (item) =>
              `  ${item.ratio} < ${item.need}  ${item.selector}  ${item.foreground} on ${item.background}  «${item.text}»`,
          )
          .join('\n')}`,
    )
    .join('\n');
}

const SCHEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const scheme of SCHEMES) {
  for (const viewport of VIEWPORTS) {
    test(`every text on the main screens is readable (${scheme}, ${viewport.name})`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });

      const failing = new Map<string, readonly ContrastFailure[]>();
      for (const screen of SCREENS) {
        await openScreen(page, screen.hash);
        const failures = await contrastFailures(page);
        if (failures.length > 0) failing.set(screen.name, failures);
      }
      expect(failing.size, `Text below the contrast floor:\n${format(failing)}`).toBe(0);
    });
  }
}

test('small controls on the home screen keep a 44 px hit area', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await openScreen(page, '#/search');
  const small = await smallTargets(
    page,
    '.help-icon-link, .carousel__dot, .carousel__arrow, .content-download-nav__pie, .search-history-fab, .search-clinical-toggle, .search-button, .app-nav-button',
  );
  expect(small, `Targets under 44 px: ${JSON.stringify(small)}`).toEqual([]);
});

const CHROME_VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'landscape phone', width: 812, height: 375 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const viewport of CHROME_VIEWPORTS) {
  test(`the bottom navigation covers no content at the end of a page (${viewport.name})`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
    const covered = new Map<string, unknown>();
    for (const screen of SCREENS) {
      await openScreen(page, screen.hash);
      const items = await coveredByNavigation(page);
      if (items.length > 0) covered.set(screen.name, items);
    }
    expect(covered.size, `Content under the navigation: ${JSON.stringify([...covered])}`).toBe(0);
  });
}

test('the scroll-to-top button stands beside the navigation, over no control', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, {
    splitNavigation: false,
    skipLargeCompanionPacks: true,
    waitForCore: true,
  });
  await openScreen(page, '#/calculators');
  // The button belongs to a ready app (core open) and follows real scrolling.
  await page.mouse.move(180, 400);
  await page.mouse.wheel(0, 1500);
  const button = page.getByRole('button', { name: 'Вернуться наверх' });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  const bar = await page.locator('.app-bottom-nav').boundingBox();
  if (!box || !bar) throw new Error('The button and the navigation are on screen.');
  // Level with the navigation bar and clear of it: it never floats over the page's own content.
  expect(box.x).toBeGreaterThanOrEqual(bar.x + bar.width);
  expect(box.y + box.height).toBeGreaterThan(bar.y);
});

test('a long result title wraps inside its card and keeps «[НАБОР]» out of it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { splitNavigation: false, skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await waitForSearchEditable(page);
  await page.getByTestId('search-input').fill('амоксициллин');
  await page.getByTestId('search-input').press('Enter');
  const titles = page.locator('.result-group-header__title');
  await expect(titles.first()).toBeVisible();
  const overflowing = await titles.evaluateAll((elements) =>
    elements
      .filter((element) => {
        const card = element.closest('.result-group');
        const right = card?.getBoundingClientRect().right ?? 0;
        return (
          element.scrollWidth > element.clientWidth + 1 ||
          element.getBoundingClientRect().right > right + 1 ||
          (element.textContent ?? '').includes('[НАБОР]')
        );
      })
      .map((element) => element.textContent),
  );
  expect(overflowing).toEqual([]);
  // One footer line per card: the offer and «Ещё N» share it; no card repeats the old note.
  await expect(page.getByText(/Найдено ещё в/u)).toHaveCount(0);
});
