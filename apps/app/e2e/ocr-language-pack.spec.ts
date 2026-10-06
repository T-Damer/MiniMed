import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { routeOcrLanguagePack } from './ocr-language-pack-fixture';
import { openSettingsPage } from './settings-nav';
import { syntheticPdf } from './synthetic-pdf';

// The language files are not in the build: OCR asks for them the first time, then works offline.
test.describe.configure({ timeout: 180_000 });

const PROMPT = 'Для распознавания текста нужен языковой пакет';

async function openLibrary(page: Page): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
}

async function addScan(page: Page, name: string): Promise<void> {
  await page.locator('.user-library-page__file-input').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: syntheticPdf({
      pages: 1,
      lines: () => ['Arterial hypertension in adults', 'Hypertension was reviewed again'],
    }),
  });
  const card = page.locator('.user-library-card').filter({ hasText: name.replace('.pdf', '') });
  await expect(card).toBeVisible();
  await expect(card.locator('.user-library-card__progress-bar')).toHaveCount(0, {
    timeout: 30_000,
  });
}

async function chooseOcr(page: Page, name: string): Promise<void> {
  const card = page.locator('.user-library-card').filter({ hasText: name.replace('.pdf', '') });
  await card.click({ button: 'right' });
  // Keyboard activation: the menu re-renders while documents settle, which makes a pointer click
  // on a moving item flaky.
  await page.getByRole('menuitem', { name: 'Распознать текст', exact: true }).press('Enter');
  await page.getByRole('menuitem', { name: 'Быстро', exact: true }).press('Enter');
}

/** The recognised text of every page of every document, read from the library database. */
function recognisedText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('minimed-user-library-v1');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('pages').objectStore('pages').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            open.result.close();
            const pages = request.result as { kind: string; text: string }[];
            resolve(
              pages
                .filter((item) => item.kind === 'ocr')
                .map((item) => item.text)
                .join(' '),
            );
          };
        };
      }),
  );
}

test('no pack: OCR asks, downloads with consent, runs, then works offline from the stored pack', async ({
  page,
}) => {
  const pack = await routeOcrLanguagePack(page);
  const appRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(E2E_ASSET_ORIGIN)) appRequests.push(request.url());
  });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await openLibrary(page);
  await addScan(page, 'first-scan.pdf');

  await chooseOcr(page, 'first-scan.pdf');
  const prompt = page.getByTestId('ocr-pack-prompt');
  await expect(prompt).toContainText(PROMPT);
  await expect(prompt).toContainText('19,6 МБ');
  // Nothing was fetched before the consent.
  expect(pack.requests).toEqual([]);

  await page.getByRole('button', { name: 'Скачать' }).click();
  await expect(prompt).toBeHidden({ timeout: 60_000 });
  expect(pack.requests.toSorted()).toEqual(['eng', 'rus']);

  // OCR starts by itself once the pack is stored.
  await expect.poll(() => recognisedText(page), { timeout: 120_000 }).toMatch(/hypertension/iu);
  await expect(page.locator('.user-library-card__progress-bar')).toHaveCount(0, {
    timeout: 60_000,
  });
  const firstDocumentMatches = (await recognisedText(page)).match(/hypertension/giu)?.length ?? 0;
  expect(firstDocumentMatches).toBeGreaterThan(0);

  // Offline from here: the pack is on the device, no language file is requested again, and the
  // app never looks for the former bundled `tessdata/` folder either.
  pack.failWith(404);
  await page.reload();
  await openLibrary(page);
  await addScan(page, 'second-scan.pdf');
  const before = pack.requests.length;
  await chooseOcr(page, 'second-scan.pdf');
  await expect(page.getByTestId('ocr-pack-prompt')).toHaveCount(0);
  await expect
    .poll(async () => (await recognisedText(page)).match(/hypertension/giu)?.length ?? 0, {
      timeout: 120_000,
    })
    .toBeGreaterThan(firstDocumentMatches);
  expect(pack.requests.length).toBe(before);
  expect(appRequests.filter((url) => url.includes('tessdata'))).toEqual([]);
});

test('a failed download says so, keeps the request, and «Повторить» finishes it', async ({
  page,
}) => {
  const pack = await routeOcrLanguagePack(page);
  pack.failWith(404);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await openLibrary(page);
  await addScan(page, 'retry-scan.pdf');
  await chooseOcr(page, 'retry-scan.pdf');

  const prompt = page.getByTestId('ocr-pack-prompt');
  await expect(prompt).toContainText(PROMPT);
  await page.getByRole('button', { name: 'Скачать' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось скачать или проверить');
  expect(await recognisedText(page)).toBe('');

  pack.failWith(null);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(prompt).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => recognisedText(page), { timeout: 120_000 }).toMatch(/hypertension/iu);
});

test('Settings lists the pack with its size, downloads it and removes it', async ({ page }) => {
  const pack = await routeOcrLanguagePack(page);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/settings`);
  await openSettingsPage(page, 'Функции ИИ');

  const card = page.locator('.ocr-settings');
  await expect(card).toContainText('Распознавание текста (OCR)');
  await expect(card).toContainText('Не скачано · 19,6 МБ');
  await card.getByRole('button', { name: 'Скачать' }).click();
  await expect(card).toContainText('Готово к работе', { timeout: 60_000 });
  expect(pack.requests.toSorted()).toEqual(['eng', 'rus']);

  await card.getByRole('button', { name: 'Удалить' }).click();
  await expect(card).toContainText('Не скачано · 19,6 МБ');
  await page.reload();
  await openSettingsPage(page, 'Функции ИИ');
  await expect(page.locator('.ocr-settings')).toContainText('Не скачано · 19,6 МБ');
});
