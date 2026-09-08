import { expect, test } from '@playwright/test';

import { mountBuiltApp } from './mount-built-app';

test('shows a verified mirrored reference illustration and keeps it available offline', async ({
  page,
  context,
}) => {
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/datasets/content-2026-09-06/assets/')) {
      imageRequests.push(request.url());
    }
  });
  await mountBuiltApp(page);
  const id =
    'core.catalog.pointer.reference.krasotaimedicina.disease.0007ef852d70ba32-82f435504305e1c9';
  await page.evaluate((documentId) => {
    window.location.hash = `#/modules/documents/d/${btoa(documentId)}`;
  }, id);
  const illustration = page.locator('.document-reference-image__image');
  await expect(illustration).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() => illustration.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(illustration).toHaveAttribute('src', /^blob:/u);
  expect(imageRequests).toHaveLength(1);
  await page.screenshot({ path: '/tmp/minimed-reference-image.png' });
  await context.setOffline(true);
  await page.locator('.document-page').getByRole('button', { name: 'Назад', exact: true }).click();
  await page.evaluate((documentId) => {
    window.location.hash = `#/modules/documents/d/${btoa(documentId)}`;
  }, id);
  await expect(illustration).toBeVisible();
  await expect
    .poll(() => illustration.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test('attributes every definition to its source without mixing ICD codes', async ({ page }) => {
  await mountBuiltApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/modules/documents/conditions/diseases/code%3AI42.6';
  });
  const definitions = page.locator('.condition-detail-definition');
  await expect(definitions.first()).toBeVisible({ timeout: 30000 });
  expect(await definitions.count()).toBeGreaterThanOrEqual(3);
  await expect(definitions.first()).toContainText('Клиническая рекомендация');
  await expect(definitions.filter({ hasText: 'Алкогольная кардиомиопатия' }).first()).toContainText(
    'Справочный материал',
  );
  await expect(page.locator('.condition-catalog-page__header')).toContainText('МКБ-10: I42.6');
  await expect(page.locator('.condition-catalog-page__header')).not.toContainText('I42.0');
  await definitions.first().getByRole('button').click();
  await expect(page.locator('.document-initial-anchor')).toBeInViewport({ timeout: 30000 });
  await expect(page.locator('.document-initial-anchor')).toContainText('кардиомиопатия');
});

test('uses source lookup even when a previous installation remembered medication mode', async ({
  page,
}) => {
  await mountBuiltApp(page, {
    localStorage: {
      'minimed.app-preferences.v1': JSON.stringify({ rememberSearchMode: true }),
      'minimed.search-scope.v1': 'medications',
    },
  });
  await expect(page.getByRole('button', { name: 'Раздел поиска', exact: true })).toContainText(
    'Все источники',
  );
  await expect(page.locator('.search-mode-picker input')).toHaveCount(0);
  await page.getByTestId('search-input').fill('пневмония');
  await expect(page.getByTestId('search-results').locator('.result-group').first()).toBeVisible({
    timeout: 30000,
  });
});

test('opens a single ICD source directly and Back returns to the catalog', async ({ page }) => {
  await mountBuiltApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/modules/documents/conditions/conditions/code%3AT51.2';
  });
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u, { timeout: 30000 });
  await expect(page.locator('.document-overlay-paper__title')).toContainText('пропанол');
  await expect(page.locator('.document-overlay-paper__title')).toContainText(
    'Токсическое действие алкоголя',
  );
  await expect(page.locator('.document-page')).toContainText(
    'Клиническое описание и рекомендации в этом материале отсутствуют.',
  );
  await page.locator('.document-page').getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page).toHaveURL(/#\/modules\/documents\/conditions\/conditions$/u);
  await expect(page.locator('.condition-catalog-toolbar')).toBeVisible();
});

test('keeps condition controls above their sticky backdrop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/modules/documents/conditions';
  });
  const toolbar = page.locator('.condition-catalog-toolbar');
  await expect(page.locator('.condition-catalog-card').first()).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(toolbar).toHaveClass(/sticky-surface--stuck/u);
  const layers = await toolbar.evaluate((element) => ({
    backdrop: Number(getComputedStyle(element, '::before').zIndex),
    controls: [...element.children].map((child) => Number(getComputedStyle(child).zIndex)),
  }));
  expect(layers.controls.every((layer) => layer > layers.backdrop)).toBe(true);
  await page.screenshot({ path: '/tmp/minimed-ux-conditions-after.png' });
  await toolbar.getByRole('searchbox').fill('T51.2');
  await page.getByRole('button', { name: /^Состояния/u }).click();
  const card = page.locator('.condition-catalog-card').filter({
    has: page.locator('.condition-catalog-card__code', { hasText: /^T51\.2$/u }),
  });
  await expect(card).toHaveCount(1);
  await card.locator('.condition-catalog-card__open').click();
  await expect(page).toHaveURL(/#\/modules\/documents\/d\//u);
});

test('opens the core graph and remains responsive to pan and zoom', async ({ page }) => {
  await mountBuiltApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/modules/documents/core-library';
  });
  const open = page.getByRole('button', { name: 'Карта связей', exact: true });
  await expect(open).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.document-library-card').first()).toBeVisible({ timeout: 30000 });
  const started = Date.now();
  await open.click();
  const canvas = page.locator('.knowledge-graph-canvas');
  await expect(canvas).toBeVisible();
  const subtitle = await page.locator('.overlay-dialog__subtitle').innerText();
  expect(Number.parseInt(subtitle, 10)).toBeGreaterThan(10000);
  console.log(`Core graph corpus: ${subtitle}`);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  console.log(`Core graph first paint: ${Date.now() - started} ms`);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Graph canvas is missing.');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -300);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 + 40);
  await page.mouse.up();
  await page.screenshot({ path: '/tmp/minimed-ux-graph-after.png' });
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveCount(0);
});
