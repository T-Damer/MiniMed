import { expect, test } from '@playwright/test';
import { openSettingsPage } from './settings-nav';

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
]) {
  test(`files and settings work while search is pending at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    let releaseShell = () => {};
    const shellGate = new Promise<void>((resolve) => {
      releaseShell = resolve;
    });
    await page.route('http://127.0.0.1:4173/', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          '<body>',
          '<body><img src="/e2e-shell-load.svg" hidden alt="">',
        ),
      });
    });
    await page.route('**/e2e-shell-load.svg', async (route) => {
      await shellGate;
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      });
    });
    await page.addInitScript(() => localStorage.setItem('minimed:package-setup-dismissed:v1', '1'));
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/content/core-report.json', async (route) => {
      await blocked;
      await route.abort();
    });
    try {
      await page.goto('http://127.0.0.1:4173/#/search', { waitUntil: 'domcontentloaded' });
      const navigation = page.getByRole('navigation', { name: 'Разделы приложения' });
      // The splash-identical boot surface covers the app until its first screen is ready.
      await expect(page.locator('#boot-surface')).toBeVisible();
      await expect(page.locator('.boot-card')).toHaveCount(0);
      await expect(navigation).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('application-loading.png') });
      releaseShell();
      await expect(navigation).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#boot-surface')).toHaveCount(0);
      await expect(navigation.locator('.app-nav-button')).toHaveCount(3);
      // An installed core that is still opening keeps the search page: the field waits disabled.
      const coreStatus = page.locator('.search-core-status');
      await expect(coreStatus).toContainText('Подготавливаем поиск');
      await expect(page.locator('.boot-card')).toHaveCount(0);
      await expect(page.getByTestId('search-input')).toBeDisabled();
      // The status shows once: the note carries it, the disabled field keeps its usual prompt.
      await expect(page.getByTestId('search-input')).toHaveAttribute(
        'placeholder',
        'Название, код МКБ, препарат или фраза из документа',
      );
      await expect(
        page.getByRole('button', { name: 'Все инструменты', exact: true }),
      ).toBeVisible();
      await navigation.getByRole('button', { name: 'Мои файлы', exact: true }).click();
      await expect(coreStatus).toBeHidden();
      await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();
      await page.getByLabel('Загрузить документы').setInputFiles({
        name: 'до-ядра.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Личный файл доступен до загрузки медицинского ядра.'),
      });
      const file = page.locator('.user-library-card').filter({ hasText: 'до-ядра' });
      await expect(file).toBeVisible();
      await file.click();
      await expect(page.locator('.user-document-reader')).toContainText(
        'Личный файл доступен до загрузки медицинского ядра.',
      );
      await page.evaluate(() => {
        window.location.hash = '#/notes';
      });
      await expect(page.getByRole('heading', { name: 'Заметки', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Добавить', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Обычная заметка', exact: true }).click();
      await page.getByLabel('Название заметки').fill('До загрузки ядра');
      await page.getByRole('button', { name: 'Создать', exact: true }).click();
      await page
        .getByLabel('Новая заметка для До загрузки ядра')
        .fill('Заметка без медицинского поиска');
      await navigation.getByRole('button', { name: 'Поиск', exact: true }).click();
      await navigation.getByRole('button', { name: 'Мои файлы', exact: true }).click();
      await page.getByLabel('Назад к записям').click();
      await expect(page.locator('.patient-note-record')).toContainText(
        'Заметка без медицинского поиска',
      );
      await page.getByRole('button', { name: 'К файлам', exact: true }).click();
      await expect(page).toHaveURL(/#\/modules\/documents\/user$/u);
      for (const hash of ['#/notes/patients', '#/notes']) {
        await page.evaluate((nextHash) => {
          window.location.hash = nextHash;
        }, hash);
        // Browser patient cards are unencrypted; the page asks once before showing them.
        if (hash === '#/notes/patients')
          await page.getByRole('button', { name: /^(Понятно, продолжить|Открыть)$/u }).click();
        await expect(page.getByRole('region', { name: 'Личные заметки' })).toBeVisible();
        await navigation.getByRole('button', { name: 'Мои файлы', exact: true }).click();
        await expect(page).toHaveURL(/#\/modules\/documents\/user$/u);
        await expect(page.getByRole('region', { name: 'Ваши документы' })).toBeVisible();
      }
      await navigation.getByRole('button', { name: 'Настройки', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
      await openSettingsPage(page, 'Внешний вид');
      await page.getByRole('switch', { name: 'Отдельные вкладки разделов' }).click();
      await expect(navigation.locator('.app-nav-button')).toHaveCount(3);
      await navigation.getByRole('button', { name: 'Поиск', exact: true }).click();
      await expect(coreStatus).toBeVisible();
      await expect(page.getByTestId('search-input')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeHidden();
      const marks = await page.evaluate(() => ({
        navigation: performance.getEntriesByName('minimed:navigation-ready').length,
        search: performance.getEntriesByName('minimed:search-ready').length,
      }));
      expect(marks).toEqual({ navigation: 1, search: 0 });
      await page.screenshot({ path: testInfo.outputPath('search-pending.png') });
    } finally {
      releaseShell();
      release?.();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
