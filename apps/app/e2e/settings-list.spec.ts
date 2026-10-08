import { mountBuiltApp } from '@localmed/app/e2e/mount-built-app';
import { expect, type Page, test } from '@playwright/test';
import { openSettingsPage } from './settings-nav';

const ROWS = [
  'Основные',
  'Врач и организация',
  'Загрузки и разделы',
  'Функции ИИ',
  'Изображения и дополнительно',
  'Внешний вид',
  'Пациенты и данные',
] as const;

async function openSettings(page: Page): Promise<void> {
  await page
    .locator('.app-bottom-nav')
    .getByRole('button', { name: /^Настройки/u })
    .click();
}

test.describe('settings list on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('rows open sub-pages and back returns to the list', async ({ page }) => {
    await mountBuiltApp(page);
    await openSettings(page);
    for (const title of ROWS) {
      await expect(page.getByRole('link', { name: new RegExp(`^${title}`, 'u') })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();

    await openSettingsPage(page, 'Внешний вид');
    await expect(page).toHaveURL(/#\/settings\/appearance$/u);
    await expect(page.getByRole('heading', { name: 'Внешний вид', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Основные/u })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Отдельные вкладки разделов' })).toBeVisible();

    // The arrow in the page and the browser back both lead to the list.
    await page.getByRole('button', { name: 'К настройкам' }).click();
    await expect(page).toHaveURL(/#\/settings$/u);
    await expect(page.getByRole('link', { name: /^Внешний вид/u })).toBeVisible();
    await openSettingsPage(page, 'Функции ИИ');
    await expect(page.getByRole('heading', { name: 'Поиск по смыслу' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#\/settings$/u);
    await expect(page.getByRole('link', { name: /^Функции ИИ/u })).toBeVisible();
  });

  test('each row shows a status computed from the stores', async ({ page }) => {
    await mountBuiltApp(page);
    await openSettings(page);
    await expect(page.getByTestId('settings-status-appearance')).toHaveText('Системная');
    await expect(page.getByTestId('settings-status-clinician')).toHaveText('Не заполнено');
    await expect(page.getByTestId('settings-status-ai')).toHaveText('Не скачано');
    await expect(page.getByTestId('settings-status-images')).toHaveText('Не скачано');
    await expect(page.getByTestId('settings-status-data')).toHaveText('Пусто');
    await expect(page.getByTestId('settings-status-downloads')).not.toHaveText('Проверяем…', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('settings-status-general')).toHaveText(/^Версия \d/u);

    // The status follows the data: fill one field of «Врач и организация».
    await openSettingsPage(page, 'Врач и организация');
    const organization = page.getByLabel(
      'Наименование организации (или ФИО индивидуального предпринимателя)',
    );
    await organization.fill('Поликлиника № 1');
    await organization.blur();
    await page.getByRole('button', { name: 'К настройкам' }).click();
    await expect(page.getByTestId('settings-status-clinician')).toHaveText('Заполнено 1 из 5');

    // A waiting app update turns the first row into a call to action.
    await page.evaluate(() => {
      const worker = {
        scriptURL: `${window.location.origin}/sw.js?v=0.6.29`,
        postMessage: () => {},
      };
      window.dispatchEvent(new CustomEvent('minimed:app-update-ready', { detail: { worker } }));
    });
    await expect(page.getByTestId('settings-status-general')).toHaveText('Есть обновление');
  });

  test('filter keeps only the rows that match', async ({ page }) => {
    await mountBuiltApp(page);
    await openSettings(page);
    await page.getByRole('searchbox', { name: 'Найти настройку' }).fill('экг');
    await expect(page.locator('.settings-list__row')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /^Функции ИИ/u })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Найти настройку' }).fill('такого нет');
    await expect(page.getByText('Ничего не нашлось')).toBeVisible();
  });

  test('reference images page shows bundled examples before the download', async ({ page }) => {
    await mountBuiltApp(page);
    await openSettings(page);
    await openSettingsPage(page, 'Изображения и дополнительно');
    await page.getByRole('link', { name: /^Справочные изображения/u }).click();
    await expect(page).toHaveURL(/#\/settings\/images\/reference$/u);
    const examples = page.getByTestId('reference-image-examples');
    await expect(examples.getByTestId('reference-image-contents')).toHaveText(
      /иллюстраци.* к .*стат.* · \d+ МБ/u,
    );
    const images = examples.locator('.reference-image-examples__image');
    await expect(images).toHaveCount(6);
    await expect
      .poll(() =>
        images.evaluateAll(
          (elements) =>
            elements.filter((element) => (element as HTMLImageElement).naturalWidth > 0).length,
        ),
      )
      .toBe(6);
    await expect(examples.getByTestId('reference-image-examples-note')).toContainText(
      'встроены в приложение',
    );
    // The download card of the existing feature sits below the examples.
    await expect(page.getByRole('button', { name: 'Скачать все' })).toBeVisible();
    await page.getByRole('button', { name: /^К разделу «Изображения/u }).click();
    await expect(page).toHaveURL(/#\/settings\/images$/u);
  });

  test('a direct link opens the sub-page', async ({ page }) => {
    await mountBuiltApp(page);
    await page.evaluate(() => {
      window.location.hash = '#/settings/data';
    });
    await expect(
      page.getByRole('heading', { name: 'Пациенты и данные', exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('patient-storage-description')).toBeVisible();
  });
});

test.describe('settings master–detail on a wide screen', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the list stays on the left while the page opens on the right', async ({ page }) => {
    await mountBuiltApp(page);
    await openSettings(page);
    const list = page.locator('.settings-shell__list');
    const detail = page.locator('.settings-shell__detail');
    await expect(list).toBeVisible();
    await expect(detail).toHaveAttribute('data-settings-detail', 'general');
    const listBox = await list.boundingBox();
    const detailBox = await detail.boundingBox();
    expect(listBox && detailBox && listBox.x + listBox.width <= detailBox.x).toBe(true);

    await openSettingsPage(page, 'Внешний вид');
    await expect(page).toHaveURL(/#\/settings\/appearance$/u);
    await expect(detail).toHaveAttribute('data-settings-detail', 'appearance');
    await expect(list).toBeVisible();
    await expect(page.getByRole('link', { name: /^Внешний вид/u })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The list is the way back here: no arrow on a first-level page.
    await expect(page.getByRole('button', { name: 'К настройкам' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Внешний вид', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    ).toBe(false);
  });
});
