import { expect, type Page, test } from '@playwright/test';

import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

async function emulateNativeShell(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
    document.querySelector<HTMLElement>('.app-shell')?.classList.add('app-shell--native');
    const probeStyle = document.createElement('style');
    probeStyle.textContent = '.app-shell::before { pointer-events: auto !important; }';
    document.head.append(probeStyle);
  });
}

async function classAtPoint(page: Page, point: { readonly x: number; readonly y: number }) {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    if (!element) return '';
    return `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`;
  }, point);
}

function nativeBlurOpacity(page: Page): Promise<string> {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    return shell ? getComputedStyle(shell, '::before').opacity : '';
  });
}

function nativeBlurGrain(page: Page): Promise<string> {
  return page.evaluate(() =>
    decodeURIComponent(
      getComputedStyle(document.documentElement).getPropertyValue('--masked-grain-image'),
    ),
  );
}

test('keeps native status blur below sticky controls and above page content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page);
  await emulateNativeShell(page);
  await expect.poll(() => nativeBlurOpacity(page)).toBe('0');
  await page.evaluate(() => window.scrollTo(0, 160));
  await expect(page.locator('.search-mode-tools')).toHaveClass(/sticky-surface--stuck/u);
  await expect.poll(() => nativeBlurOpacity(page)).toBe('1');
  await expect
    .poll(() =>
      page.locator('.search-mode-tools').evaluate((element) => {
        const safeTop = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
        );
        return element.getBoundingClientRect().top - safeTop;
      }),
    )
    .toBeCloseTo(8, 0);
  await expect.poll(() => nativeBlurGrain(page)).toContain("feFlood flood-color='white'");
  await expect(page.locator('.search-home__backdrop-blur')).toHaveCSS('opacity', '0');

  const historyButton = await page.locator('.search-history-fab').boundingBox();
  if (!historyButton) throw new Error('Search history button is not visible.');
  const historyButtonTarget = await classAtPoint(page, {
    x: historyButton.x + 4,
    y: historyButton.y + historyButton.height / 2,
  });
  const contentTarget = await classAtPoint(page, { x: 195, y: 100 });
  expect(historyButtonTarget).toContain('search-history-fab');
  expect(contentTarget).toContain('app-shell');
});

test('refreshes search sticky state when its keep-alive view becomes visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page);
  const tools = page.locator('.search-mode-tools');
  await tools.waitFor();
  await page.evaluate(() => window.scrollTo(0, 160));
  await expect(tools).toHaveClass(/sticky-surface--stuck/u);

  await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('.search-mode-tools')?.closest('.app-view');
    if (!view) throw new Error('Search view is not mounted.');
    const spacer = document.createElement('div');
    spacer.style.height = '1000px';
    document.body.append(spacer);
    view.hidden = true;
    window.scrollTo(0, 0);
  });
  await expect(tools).not.toHaveClass(/sticky-surface--stuck/u);
  await page.evaluate(() => window.scrollTo(0, 160));
  await expect(tools).not.toHaveClass(/sticky-surface--stuck/u);

  await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('.search-mode-tools')?.closest('.app-view');
    if (!view) throw new Error('Search view is not mounted.');
    view.hidden = false;
  });
  await expect(tools).toHaveClass(/sticky-surface--stuck/u);
});

test('keeps native status blur below the nested files header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__search-chrome').waitFor();
  await emulateNativeShell(page);

  const searchInput = await page.locator('.user-library-page__search-chrome input').boundingBox();
  if (!searchInput) throw new Error('Files search input is not visible.');
  const target = await classAtPoint(page, {
    x: searchInput.x + searchInput.width / 2,
    y: searchInput.y + searchInput.height / 2,
  });
  expect(target).toContain('archive-search__input');

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '1000px';
    document.body.append(spacer);
    window.scrollTo(0, 160);
  });
  const heading = page.locator('.user-library-page__search-chrome');
  await expect(heading).toHaveClass(/sticky-surface--stuck/u);
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element, '::before').opacity))
    .toBe('1');
  const backdrop = await heading.evaluate((element) => {
    const elementRect = element.getBoundingClientRect();
    const styles = getComputedStyle(element, '::before');
    const top = elementRect.top + Number.parseFloat(styles.top);
    return {
      top,
      bottom: top + Number.parseFloat(styles.height),
      elementBottom: elementRect.bottom,
      mask: styles.maskImage || styles.webkitMaskImage,
    };
  });
  expect(backdrop.top).toBeCloseTo(0, 0);
  expect(backdrop.bottom).toBeGreaterThan(backdrop.elementBottom);
  expect(backdrop.mask).toContain('linear-gradient');
});

test('keeps transparent route headers below the native status bar after viewport resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  const heading = page.locator('.user-library-page__search-chrome');
  await heading.waitFor();
  await emulateNativeShell(page);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '1000px';
    document.body.append(spacer);
    window.scrollTo(0, 160);
  });
  await expect(heading).toHaveClass(/sticky-surface--stuck/u);

  await page.locator('.user-library-page__search-chrome input').focus();
  await page.setViewportSize({ width: 390, height: 480 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));

  const geometry = await heading.evaluate((element) => {
    const safeTop = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
    );
    return {
      top: element.getBoundingClientRect().top,
      paddingTop: Number.parseFloat(getComputedStyle(element).paddingTop),
      safeTop,
    };
  });
  expect(geometry.top - geometry.safeTop).toBeCloseTo(8, 0);
  expect(geometry.paddingTop).toBeCloseTo(4, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect
    .poll(() =>
      heading.evaluate((element) => {
        const safeTop = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
        );
        return element.getBoundingClientRect().top - safeTop;
      }),
    )
    .toBeCloseTo(8, 0);
});

test('removes native status blur from routes without transparent sticky chrome', async ({
  page,
}) => {
  await mountBuiltApp(page);
  for (const route of ['#/assessments', '#/calculators', '#/notes', '#/settings']) {
    await page.goto(`${E2E_ASSET_ORIGIN}/${route}`);
    await page.locator('.app-shell').waitFor();
    await emulateNativeShell(page);
    await expect.poll(() => nativeBlurOpacity(page)).toBe('0');
  }
});

test('hides native status blur on document readers and medical viewers', async ({ page }) => {
  await mountBuiltApp(page);
  await emulateNativeShell(page);
  await page.locator('.app-bottom-nav').getByRole('button', { name: 'База знаний' }).click();
  await page.getByRole('heading', { name: 'Наборы документов' }).waitFor();
  await page.locator('article[aria-label="Открыть набор «Ядро»"]').click();
  await page.getByRole('searchbox', { name: 'Поиск по текущему разделу' }).fill('пневмония');
  await page
    .getByRole('button', { name: /Пневмония/u })
    .first()
    .click();
  await expect(page.locator('.document-page__chrome')).toBeVisible();
  const readerChrome = await page.locator('.document-page__chrome').evaluate((element) => {
    const styles = getComputedStyle(element);
    const backButton = element.querySelector<HTMLElement>('.document-page__back');
    const safeTop = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
    );
    return {
      top: element.getBoundingClientRect().top,
      controlTop: backButton?.getBoundingClientRect().top ?? Number.NaN,
      safeTop,
      background: styles.backgroundColor,
    };
  });
  expect(readerChrome.top).toBeCloseTo(0, 0);
  expect(readerChrome.controlTop).toBeGreaterThanOrEqual(readerChrome.safeTop);
  expect(readerChrome.background).not.toBe('rgba(0, 0, 0, 0)');
  await expect.poll(() => nativeBlurOpacity(page)).toBe('0');

  await page.evaluate(() =>
    document.querySelector('.app-shell')?.classList.add('app-shell--medical-image'),
  );
  await expect.poll(() => nativeBlurOpacity(page)).toBe('0');
});

test('moves sticky document headings with the hidden reader chrome', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBuiltApp(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/d/a3IucmYuNzE0XzIucG5ldW1vbmlh`);
  await page.getByRole('button', { name: 'Загрузить полный текст' }).click();

  const heading = page
    .locator('.document-overlay-section__title--h1, .document-overlay-section__title--h2')
    .first();
  await heading.waitFor({ state: 'visible', timeout: 30_000 });
  expect(await heading.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
    await page
      .locator('.document-page__chrome')
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  );
  await emulateNativeShell(page);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.evaluate(() => window.scrollTo(0, 450));
  await expect
    .poll(() =>
      page.locator('html').evaluate((root) => root.classList.contains('app-chrome-hidden')),
    )
    .toBe(true);

  const gap = await heading.evaluate((element) => {
    const safeTop = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
    );
    return (
      Number.parseFloat(getComputedStyle(element).top) - (Number.isFinite(safeTop) ? safeTop : 0)
    );
  });
  expect(gap).toBeCloseTo(7, 0);

  const safeFill = await page.locator('.document-overlay-paper').evaluate((paper) => {
    const styles = getComputedStyle(paper, '::before');
    return { background: styles.backgroundColor, height: styles.height, opacity: styles.opacity };
  });
  expect(safeFill.height).toBe('24px');
  expect(safeFill.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(safeFill.opacity).toBe('1');

  await page.evaluate(() => window.scrollTo(0, 300));
  await expect
    .poll(() =>
      page.locator('html').evaluate((root) => root.classList.contains('app-chrome-hidden')),
    )
    .toBe(false);
});
