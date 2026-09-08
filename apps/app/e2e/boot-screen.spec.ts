import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`boot screen fills the viewport at ${viewport.width}px and exits after initialization`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
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
    const boot = page.locator('.boot-screen');
    try {
      await expect(boot).toBeVisible();
      await expect(page.locator('.app-bottom-nav')).toBeVisible();
      const bounds = await boot.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(viewport.height);
      expect(bounds?.y).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('boot.png') });
      await page.getByRole('button', { name: 'Мои файлы', exact: true }).click();
      await expect(boot).toHaveCount(0);
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
    await expect(page.getByTestId('search-input')).toBeVisible({ timeout: 60000 });
    await expect(boot).toHaveCount(0);
    await expect(page.locator('.app-bottom-nav')).toBeVisible();
  });
}

test('missing core locks search while files and settings remain available', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
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
  await expect(page.getByTestId('search-input')).toHaveCount(0);
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
