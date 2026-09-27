import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`search stays on screen while the core downloads at ${viewport.width}px and is not remounted when ready`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    // Onboarding has separate coverage; this suite covers later opens with the setup dismissed.
    await page.addInitScript(() => localStorage.setItem('minimed:package-setup-dismissed:v1', '1'));
    let releaseCore = () => {};
    const coreGate = new Promise<void>((resolve) => {
      releaseCore = resolve;
    });
    await page.route('**/core.db', async (route) => {
      await coreGate;
      await route.continue();
    });
    await page.goto(`${process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173'}/#/search`, {
      waitUntil: 'domcontentloaded',
    });
    const coreStatus = page.locator('.search-core-status');
    try {
      // The web build reports progress once the response starts; until then the core is opening.
      await expect(coreStatus).toContainText(/Подготавливаем поиск|Загружаем базу/u);
      await expect(page.locator('.boot-screen')).toHaveCount(0);
      await expect(page.locator('.app-bottom-nav')).toBeVisible();
      await expect(page.getByTestId('search-input')).toBeDisabled();
      await expect(
        coreStatus.locator('.search-core-status__mark, .search-core-status__spinner'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Все инструменты' })).toBeVisible();
      // Picking a random record needs the corpus, like the dictionary.
      await expect(page.getByRole('button', { name: 'Случайная запись' })).toBeDisabled();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow).toBe(false);
      // The same page element must survive core readiness: no remount, no lost state.
      await page.evaluate(() => {
        Object.assign(window, { __searchHome: document.querySelector('.search-home') });
      });
      await page.screenshot({ path: testInfo.outputPath('core-downloading.png') });
      await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
      await expect(coreStatus).toBeHidden();
      await expect(page.locator('.app-shell')).not.toHaveClass(/app-shell--booting/);
      await page.getByRole('button', { name: 'Действия со страницей' }).click();
      await page.getByRole('menuitem', { name: 'Создать папку', exact: true }).click();
      await page.getByLabel('Название новой папки').fill('До готовности ядра');
    } finally {
      releaseCore();
    }
    await expect(page.locator('.app-nav-button--active')).toHaveAttribute(
      'aria-label',
      'Мои файлы',
    );
    await page.waitForFunction(
      () => performance.getEntriesByName('minimed:search-ready').length > 0,
      undefined,
      { timeout: 60000 },
    );
    await expect(page.getByLabel('Название новой папки')).toHaveValue('До готовности ядра');
    await page.getByRole('dialog').getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Открыть папку «До готовности ядра»' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Поиск', exact: true }).click();
    await expect(page.getByTestId('search-input')).toBeEnabled({ timeout: 60000 });
    await expect(coreStatus).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.querySelector('.search-home') ===
          (window as unknown as { __searchHome?: Element }).__searchHome,
      ),
    ).toBe(true);
    await expect(page.locator('.app-bottom-nav')).toBeVisible();
  });
}

test('the knowledge base shows the core status by direct link and keeps its page when ready', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('minimed:package-setup-dismissed:v1', '1'));
  let releaseCore = () => {};
  const coreGate = new Promise<void>((resolve) => {
    releaseCore = resolve;
  });
  await page.route('**/core.db', async (route) => {
    await coreGate;
    await route.continue();
  });
  await page.goto(
    `${process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173'}/#/modules/documents`,
    { waitUntil: 'domcontentloaded' },
  );
  const knowledge = page.locator('.knowledge-base-page');
  try {
    await expect(knowledge.getByRole('heading', { name: 'База знаний', level: 1 })).toBeVisible();
    await expect(knowledge.locator('.search-core-status')).toContainText(
      /Подготавливаем поиск|Загружаем базу/u,
    );
    await page.evaluate(() => {
      Object.assign(window, { __knowledgePage: document.querySelector('.knowledge-base-page') });
    });
  } finally {
    releaseCore();
  }
  await expect(page.getByRole('heading', { name: 'Наборы документов' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(knowledge.locator('.search-core-status')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.querySelector('.knowledge-base-page') ===
        (window as unknown as { __knowledgePage?: Element }).__knowledgePage,
    ),
  ).toBe(true);
});

test('missing core on a cellular connection waits for the user while files and settings remain available', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // On Wi-Fi the core starts downloading by itself; cellular keeps the explicit button.
    Object.defineProperty(navigator, 'connection', { value: { type: 'cellular' } });
    localStorage.setItem('minimed:package-setup-dismissed:v1', '1');
    Object.assign(window, {
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        PluginHeaders: [
          { name: 'LocalMedDatabase', methods: [{ name: 'hasCorePack', rtype: 'promise' }] },
          { name: 'CapacitorDownloader', methods: [{ name: 'checkStatus', rtype: 'promise' }] },
        ],
        nativePromise: async (plugin: string, method: string) => {
          if (plugin === 'LocalMedDatabase' && method === 'hasCorePack')
            return { installed: false };
          if (plugin === 'CapacitorDownloader' && method === 'checkStatus') {
            throw Object.assign(new Error('No retained download'), {
              code: 'NATIVE_DOWNLOAD_NOT_FOUND',
            });
          }
          throw new Error(`Unexpected native call: ${plugin}.${method}`);
        },
      },
    });
  });
  await page.goto(`${process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173'}/#/search`);
  await expect(page.getByRole('heading', { name: 'Скачайте ядро MiniMed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать ядро · ~490 МБ' })).toBeVisible();
  const navigation = page.locator('.app-bottom-nav');
  await expect(navigation.locator('.app-nav-button')).toHaveCount(3);
  // The search page stays mounted under the setup screen, but hidden.
  await expect(page.getByTestId('search-input')).toBeHidden();
  const bounds = await page.locator('.boot-screen').boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(844);
  expect(bounds?.y).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('core-setup.png') });
  await navigation.getByRole('button', { name: 'Мои файлы', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();
  await navigation.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Поиск', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Скачать ядро · ~490 МБ' })).toBeVisible();
});

test('the first run on a cellular connection shows only the setup screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { type: 'cellular' } });
  });
  await page.goto(`${process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173'}/#/search`);
  const setup = page.getByRole('dialog', { name: 'Добро пожаловать в MiniMed' });
  await expect(setup).toBeVisible();
  // The consent to download belongs to the setup screen; no boot card may layer under it.
  await expect(setup).toContainText('Ждёт вашего решения', { timeout: 30_000 });
  await expect(page.locator('.boot-screen')).toHaveCount(0);
});

test('the first-run tour shows how a CT study opens while the core downloads', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/core.db', () => new Promise(() => {}));
  await page.goto(`${process.env.MINIMED_LIVE_URL ?? 'http://127.0.0.1:4173'}/#/search`);
  const setup = page.getByRole('dialog', { name: 'Добро пожаловать в MiniMed' });
  await setup.getByRole('button', { name: 'Снимки КТ и МРТ' }).click();
  const slide = setup.locator('.feature-tour__slide--active');
  await expect(slide).toContainText('Снимки КТ и МРТ');
  await slide.getByRole('button', { name: 'Кость', exact: true }).click();
  await expect(slide.locator('.tour-imaging__label')).toContainText('Кость');
  await expect(slide.getByRole('button', { name: 'Скачать пример КТ' })).toBeEnabled();
});
