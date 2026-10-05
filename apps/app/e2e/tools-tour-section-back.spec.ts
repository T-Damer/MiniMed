import { expect, type Page, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';
import { openHomeSection } from './select-search-section';

/** A short NIfTI-looking file: the library stores it as a study without opening it. */
const NIFTI_FILE = {
  name: 'head-scan.nii',
  mimeType: 'application/x-nifti',
  buffer: Buffer.alloc(352, 1),
};

async function openToolsSheet(page: Page) {
  await page.getByRole('button', { name: 'Все инструменты', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet).toBeVisible();
  return sheet;
}

for (const width of [390, 1280]) {
  test(`«Все инструменты» lists only the app's real features at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const sheet = await openToolsSheet(page);
    const titles = await sheet.locator('.quick-tool-row__title').allTextContents();
    for (const title of [
      'Запись беседы',
      'ЭКГ по фото',
      'Формы',
      'Заметки',
      'Просмотр снимков',
      'Калькуляторы',
    ]) {
      expect(titles).toContain(title);
    }
    // One calculators entry, not every calculator.
    expect(titles.filter((title) => /ИМТ|СКФ|Апгар/u.test(title))).toHaveLength(0);
    await sheet
      .getByRole('button', { name: /ЭКГ по фото/u })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/calculators\/ecg-photo-caliper$/u);
  });
}

test('«Просмотр снимков» opens an empty state: library list, new file picker and a drop target', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  let sheet = await openToolsSheet(page);
  await sheet.locator('.quick-tool-row__open', { hasText: 'Просмотр снимков' }).click();
  const entry = page.getByTestId('imaging-entry');
  await expect(page.getByRole('dialog', { name: 'Просмотр снимков' })).toBeVisible();
  await expect(entry.getByText('В «Моих файлах» пока нет снимков')).toBeVisible();
  await expect(entry.getByText('Открыть новый файл')).toBeVisible();
  await expect(entry.getByRole('heading', { name: 'Открыть из моих файлов' })).toBeVisible();

  // A wrong file is refused with the reason.
  await page.getByTestId('imaging-file-input').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await expect(entry.getByRole('alert')).toContainText('DICOM');

  // A new file imports through the library and opens in the viewer.
  await page.getByTestId('imaging-file-input').setInputFiles(NIFTI_FILE);
  await expect(page).toHaveURL(/#\/modules\/documents\/user\//u);
  await expect(page.getByRole('dialog', { name: 'Просмотр снимков' })).toHaveCount(0);

  // The imported study is now listed and opens from «Открыть из моих файлов».
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await expect(page.getByTestId('search-input')).toBeVisible();
  sheet = await openToolsSheet(page);
  await sheet.locator('.quick-tool-row__open', { hasText: 'Просмотр снимков' }).click();
  await page.getByRole('button', { name: /head-scan/u }).click();
  await expect(page).toHaveURL(/#\/modules\/documents\/user\//u);
});

test('a file dropped on the «Просмотр снимков» tool row is imported and opened', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await openToolsSheet(page);
  await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.quick-tool-row')].find((element) =>
      element.textContent?.includes('Просмотр снимков'),
    );
    if (!row) throw new Error('imaging row missing');
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(352).fill(1)], 'dropped.nii'));
    row.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
    row.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });
  await expect(page).toHaveURL(/#\/modules\/documents\/user\//u);
});

for (const width of [360, 390, 768, 1280]) {
  test(`the feature tour keeps every slide inside its dialog and leads to real pages at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await page.getByRole('button', { name: 'Справка', exact: true }).click();
    await page.getByRole('button', { name: 'Что умеет MiniMed' }).click();
    const dialog = page.getByRole('dialog', { name: 'Что умеет MiniMed' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Скачать пример МРТ')).toHaveCount(0);

    const slideTitles = [
      'Поиск без интернета',
      'Пациенты и визиты',
      'Диктофон приёма',
      'Заметки и холст',
      'Снимки КТ и МРТ',
      'Шкалы и калькуляторы',
    ];
    for (const title of slideTitles) {
      await dialog.getByRole('button', { name: title, exact: true }).click();
      const slide = dialog.locator('.feature-tour__slide--active');
      await expect(slide.getByRole('heading', { name: title })).toBeVisible();
      await expect
        .poll(async () => {
          const box = await dialog.boundingBox();
          const copy = await slide.locator('.feature-tour__copy').boundingBox();
          return Boolean(
            box &&
              copy &&
              box.x >= -0.5 &&
              box.x + box.width <= width + 0.5 &&
              copy.x >= box.x - 0.5,
          );
        })
        .toBe(true);
    }

    await dialog.getByRole('button', { name: 'Снимки КТ и МРТ', exact: true }).click();
    await dialog
      .locator('.feature-tour__slide--active')
      .getByRole('button', { name: 'Исследования' })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/folder=user-folder-research/u);
  });
}

test('the tour leads from the patients slide to the patients page', async ({ page }) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.getByRole('button', { name: 'Справка', exact: true }).click();
  await page.getByRole('button', { name: 'Что умеет MiniMed' }).click();
  const dialog = page.getByRole('dialog', { name: 'Что умеет MiniMed' });
  await dialog.getByRole('button', { name: 'Пациенты и визиты', exact: true }).click();
  await dialog.getByRole('button', { name: 'Открыть пациентов' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/notes\/patients$/u);
});

for (const width of [390, 1280]) {
  test(`an open section has a back arrow in the history position at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    const history = page.getByRole('button', { name: 'Показать историю поиска' });
    await expect(history).toBeVisible();
    const before = await history.boundingBox();

    await openHomeSection(page, 'Клинические рекомендации');
    const back = page.getByRole('button', { name: 'Назад к разделам' });
    await expect(back).toBeVisible();
    await expect(page.getByRole('button', { name: 'Показать историю поиска' })).toHaveCount(0);
    const after = await back.boundingBox();
    expect(
      after && before && Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1,
    ).toBe(true);

    await back.click();
    await expect(page.locator('.search-sections__row').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Показать историю поиска' })).toBeVisible();

    // Escape does the same.
    await openHomeSection(page, 'Клинические рекомендации');
    await expect(page.getByRole('button', { name: 'Назад к разделам' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Показать историю поиска' })).toBeVisible();
  });
}

test('hovering a button edge never moves it, so the hover and its sound stay at one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  for (const selector of [
    '.search-quick-access__all',
    '.home-feature__action:not(.home-feature__action--secondary)',
  ]) {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    // Wait until the page stops shifting (the core status note comes and goes).
    await expect
      .poll(async () => {
        const first = await target.boundingBox();
        await page.waitForTimeout(300);
        const second = await target.boundingBox();
        return Boolean(first && second && first.y === second.y);
      })
      .toBe(true);
    const box = await target.boundingBox();
    if (!box) throw new Error(`${selector} has no box`);
    await target.evaluate((element) => {
      const counts = { enter: 0, over: 0 };
      (window as unknown as { __hover: typeof counts }).__hover = counts;
      element.addEventListener('pointerenter', () => {
        counts.enter += 1;
      });
      element.addEventListener('pointerover', () => {
        counts.over += 1;
      });
    });
    const y = box.y + box.height - 2;
    await page.mouse.move(box.x - 10, y);
    for (let step = 0; step <= 30; step += 1) {
      await page.mouse.move(box.x + 8 + step * ((box.width - 16) / 30), y);
    }
    await page.waitForTimeout(200);
    const after = await target.boundingBox();
    expect(
      after && Math.abs(after.y - box.y) < 0.01 && Math.abs(after.height - box.height) < 0.01,
    ).toBe(true);
    const counts = await page.evaluate(
      () => (window as unknown as { __hover: { enter: number } }).__hover,
    );
    expect(counts.enter, selector).toBe(1);
    await page.mouse.move(2, 2);
  }
});

test('calculators and questionnaires carry a star that puts them in the quick row', async ({
  page,
}) => {
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/calculators`);
  await page
    .getByRole('button', { name: /^Открыть раздел/u })
    .first()
    .click();
  const star = page.locator('.calculator-card__pins .tool-pin__star').first();
  await expect(star).toBeVisible({ timeout: 30_000 });
  const label = (await star.getAttribute('aria-label')) ?? '';
  const title = /«(.+)»/u.exec(label)?.[1] ?? '';
  expect(title).not.toBe('');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await expect(
    page.locator('.search-quick-access').getByRole('button', { name: title }),
  ).toBeVisible();
  // The star survives a reload.
  await page.reload();
  await expect(
    page.locator('.search-quick-access').getByRole('button', { name: title }),
  ).toBeVisible();
});
