import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Locator, type Page, test } from '@playwright/test';

import { contrastFindings } from './contrast';
import { createDoctorCard } from './diary-fixtures';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// Owner report 2026-11-13 (FORMDIARY-UI1): a note template («бланк», Files → «Ваши шаблоны»)
// showed on the bare desk, its edit mode was a small note box with a doubled, misaligned title,
// the full-screen toolbar hung below the header with a gap; «Выдать дневник» had almost no styles;
// the patient avatar was dark letters on the dark header band.
//
// FDUI_CAPTURE_DIR=<dir> FDUI_LABEL=before|after saves each step at the test's width in both
// colour schemes before its assertions, so the same spec photographs a build without the fixes.

const CAPTURE_DIR = process.env['FDUI_CAPTURE_DIR'];
const LABEL = process.env['FDUI_LABEL'] ?? 'after';

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'wide', width: 1280, height: 800 },
] as const;

async function capture(page: Page, width: string, name: string): Promise<void> {
  if (!CAPTURE_DIR) return;
  const directory = resolve(CAPTURE_DIR);
  mkdirSync(directory, { recursive: true });
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) toast.remove();
  });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${directory}/${name}-${width}-${scheme}-${LABEL}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (!found) throw new Error('element has no box');
  return found;
}

/** Files → «Ваши шаблоны» → the example «Осмотр на дому»: its editable copy opens in the reader. */
async function openExampleTemplate(page: Page): Promise<void> {
  await page.goto(`${E2E_ASSET_ORIGIN}/#/notes/templates`);
  await page.getByText('Осмотр на дому', { exact: true }).first().click();
  await expect(page.locator('.user-document-reader__markdown')).toBeVisible({ timeout: 60_000 });
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('a note template is a sheet of paper and is edited as a full page', async ({ page }) => {
      test.setTimeout(180_000);
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      await openExampleTemplate(page);
      await page.waitForTimeout(400);
      await capture(page, viewport.name, 'template-view');

      // 1. The text sits on paper: an opaque sheet with its own margins, not the desk.
      const paper = page.locator('.user-document-reader__paper');
      const sheet = await paper.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          background: style.backgroundColor,
          padding: Number.parseFloat(style.paddingLeft),
        };
      });
      expect(sheet.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(sheet.padding).toBeGreaterThan(8);
      // The title is shown once: the text opens with it as its own heading.
      await expect(page.getByRole('heading', { name: 'Осмотр на дому', exact: true })).toHaveCount(
        1,
      );

      // 2. Edit mode is a full page, not a box inside the card; the title is one heading.
      await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
      const editor = page.locator('.note-markdown-editor--fullscreen');
      await expect(editor).toBeVisible();
      await page.waitForTimeout(500);
      await capture(page, viewport.name, 'template-edit');
      const page_ = await box(editor);
      expect(page_.width).toBeGreaterThanOrEqual(viewport.width - 1);
      await expect(
        editor.getByRole('heading', { name: 'Осмотр на дому', exact: true }),
      ).toHaveCount(1);
      // Headings and text start on the same line as the sheet's own margin.
      const firstHeading = await box(editor.locator('.note-markdown-wysiwyg__surface h1').first());
      const nextHeading = await box(editor.locator('.note-markdown-wysiwyg__surface h2').first());
      const bar = await box(editor.locator('.user-document-reader__draft-bar'));
      expect(Math.abs(firstHeading.x - nextHeading.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(firstHeading.x - bar.x)).toBeLessThanOrEqual(1);

      // 3. The toolbar is pinned flush under the header, before and after the page scrolls.
      const header = editor.locator('.document-page__chrome');
      const tools = editor.locator('.note-markdown-editor__chrome-tools');
      const flush = async (): Promise<number> =>
        Math.abs((await box(tools)).y - ((await box(header)).y + (await box(header)).height));
      expect(await flush()).toBeLessThanOrEqual(1);
      await editor.evaluate((node) => node.scrollBy(0, 600));
      await page.waitForTimeout(300);
      expect(await flush()).toBeLessThanOrEqual(1);
      await capture(page, viewport.name, 'template-edit-scrolled');

      // ‹ closes the editor; with typed text it asks first, over the editor.
      await editor.locator('.note-markdown-wysiwyg__surface').click();
      await page.keyboard.type(' проверка');
      await expect(page.getByText('Черновик · не сохранён')).toBeVisible();
      await header.getByRole('button', { name: 'Закрыть редактор' }).click();
      const ask = page.getByRole('dialog', { name: 'Несохранённый черновик' });
      await expect(ask).toBeVisible();
      await ask.getByRole('button', { name: 'Не сохранять' }).click();
      await expect(editor).toHaveCount(0);
      await expect(page).not.toHaveURL(/fullscreen=1/u);
      await expect(page.locator('.user-document-reader__markdown')).not.toContainText('проверка');
    });

    test('«Выдать дневник» is laid out as the numbered steps of «Новый пациент»', async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      await createDoctorCard(page, 'Анна Тестова', true);
      await page.getByRole('button', { name: 'Выдать дневник', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Выдать дневник' });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(500);
      await capture(page, viewport.name, 'diary-issue-care');

      const numbers = (): Promise<string[]> => dialog.locator('.form-step__number').allInnerTexts();
      const chosen = dialog.locator('.ui-choice-group__option--checked');
      await expect(dialog.locator('.form-step').first()).toContainText('Какой дневник');
      await expect(chosen).toHaveCount(1);
      await expect(chosen).toContainText('Дневник лечения');
      expect(await numbers()).toEqual(['1', '2', '3', '4', '5']);

      await dialog.getByText('Дневник приёма препаратов', { exact: true }).click();
      await expect(chosen).toContainText('Дневник приёма препаратов');
      expect(await numbers()).toEqual(['1', '2', '3']);
      await dialog.locator('.form-step').nth(1).scrollIntoViewIfNeeded();
      await capture(page, viewport.name, 'diary-issue-medication');

      await dialog.getByText('Свой дневник', { exact: true }).click();
      expect(await numbers()).toEqual(['1', '2', '3']);
      await expect(dialog.locator('.patient-diary__field-row')).toHaveCount(1);
      await dialog.locator('.form-step').nth(1).scrollIntoViewIfNeeded();
      await capture(page, viewport.name, 'diary-issue-custom');

      // The actions are one row pinned to the bottom of the sheet, inside the window.
      const footer = dialog.locator('.patient-diary__footer');
      const print = footer.getByRole('button', { name: 'Распечатать бланк' });
      const submit = footer.getByRole('button', { name: 'Создать QR-код' });
      await expect(print).toBeVisible();
      await expect(submit).toBeVisible();
      expect(Math.abs((await box(print)).y - (await box(submit)).y)).toBeLessThanOrEqual(4);
      const bottom = (await box(footer)).y + (await box(footer)).height;
      expect(bottom).toBeLessThanOrEqual(viewport.height + 1);
      // Nothing of the form shows under it: it is the sheet's bottom edge.
      const sheet = await box(dialog);
      expect(Math.abs(sheet.y + sheet.height - bottom)).toBeLessThanOrEqual(2);
    });

    test('the patient avatar is readable on every surface, in both themes', async ({ page }) => {
      test.setTimeout(180_000);
      await mountBuiltApp(page, { skipLargeCompanionPacks: true });
      await createDoctorCard(page, 'Анна Тестова', true);
      const header = page.locator('.patient-avatar-picker__avatar').first();
      await expect(header).toContainText('АТ');
      await capture(page, viewport.name, 'avatar-patient-header');
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(300);
        expect(
          await contrastFindings(page, { scope: '.patient-avatar-picker__avatar', opacity: true }),
          `patient header avatar, ${scheme}`,
        ).toEqual([]);
      }

      // The same avatar in the patient row of a form.
      await page.emulateMedia({ colorScheme: 'light' });
      const patientId = /#\/notes\/patients\/([^/?]+)/u.exec(page.url())?.[1];
      expect(patientId).toBeTruthy();
      await page.evaluate((id) => {
        window.location.hash = `#/notes/forms/ru.minzdrav.274n.070u?patient=${id}`;
      }, patientId ?? '');
      const row = page.locator('.patient-picker-row__avatar').first();
      await expect(row).toContainText('АТ');
      await capture(page, viewport.name, 'avatar-form-row');
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(300);
        expect(
          await contrastFindings(page, { scope: '.patient-picker-row__avatar', opacity: true }),
          `form patient row avatar, ${scheme}`,
        ).toEqual([]);
      }
    });
  });
}
