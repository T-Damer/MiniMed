import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// QA 0.6.60: the pooled-cohort page was 66 px wider than the screen because of an unbreakable
// citation. Every calculator and questionnaire page must fit a 375 px phone with no horizontal
// scroll, with its sources and result shown.
const TOOL_MODULES = resolve(import.meta.dirname, '../../../content/tool-modules');

interface ToolRoute {
  readonly kind: 'calculator' | 'assessment';
  readonly slug: string;
}

function toolRoutes(): readonly ToolRoute[] {
  const routes: ToolRoute[] = [];
  for (const name of readdirSync(TOOL_MODULES).filter((file) => file.endsWith('.json'))) {
    const module = JSON.parse(readFileSync(join(TOOL_MODULES, name), 'utf8')) as {
      tools: readonly { kind: 'calculator' | 'assessment'; slug: string }[];
    };
    for (const tool of module.tools) routes.push({ kind: tool.kind, slug: tool.slug });
  }
  return routes;
}

/** Pixels by which the document is wider than the viewport, or by which an element sticks out. */
async function horizontalOverflow(page: Page): Promise<{ page: number; widest: string }> {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    let widest = '';
    let widestRight = viewport;
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      if (element.closest('[data-sonner-toaster], .app-bottom-nav')) continue;
      const style = getComputedStyle(element);
      if (style.position === 'fixed' || style.visibility === 'hidden') continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Content inside a horizontally scrolling area (a wide table, a chart) scrolls there.
      let scrolled = false;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const overflowX = getComputedStyle(ancestor).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
          scrolled = true;
          break;
        }
      }
      if (scrolled) continue;
      if (box.right > widestRight + 0.5) {
        widestRight = box.right;
        widest = `${element.tagName.toLowerCase()}.${element.className} «${(element.textContent ?? '').trim().slice(0, 60)}»`;
      }
    }
    return {
      page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewport,
      widest:
        widestRight > viewport + 0.5 ? `${widest} → ${Math.round(widestRight - viewport)} px` : '',
    };
  });
}

async function installAllToolSections(page: Page): Promise<void> {
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  const downloads = page.getByRole('button', { name: /^Скачать раздел — / });
  // The download queue takes every section at once; the buttons of installed sections disappear.
  for (const label of await downloads.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label') ?? ''),
  )) {
    // A section that a module of an earlier click already carried has no button any more.
    const button = page.getByRole('button', { name: label, exact: true });
    if ((await button.count()) > 0) await button.click();
  }
  await expect.poll(async () => downloads.count(), { timeout: 900_000, intervals: [2000] }).toBe(0);
}

test('every calculator and questionnaire page fits a 375 px phone', async ({ page }) => {
  test.setTimeout(1_800_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await installAllToolSections(page);

  const routes = toolRoutes().slice(
    Number(process.env['TOOL_ROUTES_FROM'] ?? 0),
    Number(process.env['TOOL_ROUTES_TO'] ?? Number.MAX_SAFE_INTEGER),
  );
  if (process.env['TOOL_ROUTES_TO'] === undefined)
    expect(routes.length).toBeGreaterThanOrEqual(251);
  const failures: string[] = [];
  for (const route of routes) {
    const hash =
      route.kind === 'calculator' ? `#/calculators/${route.slug}` : `#/assessments/${route.slug}`;
    await page.evaluate((target) => {
      window.location.hash = target;
    }, hash);
    try {
      await page
        .locator(route.kind === 'calculator' ? '.calculator-form' : '.assessment-page-header')
        .first()
        .waitFor({ timeout: Number(process.env['TOOL_PAGE_WAIT_MS'] ?? 20_000) });
    } catch {
      failures.push(`${route.slug}: the page did not open`);
      continue;
    }
    // Let the form and the footnote with the sources render.
    await page.waitForTimeout(60);
    const overflow = await horizontalOverflow(page);
    if (overflow.page > 0 || overflow.widest) {
      failures.push(`${route.slug}: page +${overflow.page} px; ${overflow.widest}`);
    }
  }
  expect(failures).toEqual([]);
});

test('the pooled-cohort page keeps its long citation inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { persistentOrigin: true, skipLargeCompanionPacks: true });
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: 'Калькуляторы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Скачать раздел — Кардиология' }).click();
  await expect(page.getByText(/^Доступно офлайн: (\d+) из \1$/u)).toBeVisible();
  await page.goto(`${E2E_ASSET_ORIGIN}/#/calculators/pooled-cohort-equations-ascvd-risk`);
  await expect(page.locator('.calculator-footnote')).toBeVisible();
  const overflow = await horizontalOverflow(page);
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.widest).toBe('');

  // Control: the check does see the overflow once the citation may not break again.
  await page.addStyleTag({
    content:
      '.calculator-footnote, .calculator-source-reference { overflow-wrap: normal !important; word-break: keep-all !important; white-space: nowrap !important; }',
  });
  const broken = await horizontalOverflow(page);
  expect(broken.page > 0 || broken.widest !== '').toBe(true);
});
