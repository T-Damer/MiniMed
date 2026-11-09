import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { openSettings, testInvitation, testInvitationLink } from './diary-fixtures';
import { E2E_ASSET_ORIGIN } from './mount-built-app';

// Medicines taken before (MEDHIST1, owner 2026-11-09): the patient enters and edits them in the
// diary, they print with the diary; the doctor sees them on the patient page (allergies named), is
// warned when prescribing the same medicine or its ATC group, and moves a medicine taken off the
// plan into the history. Screenshots go to the test output for the owner.

const ROOT = resolve(import.meta.dirname, '../../..');

/** The HTML the last print sent to its hidden frame. */
async function printedHtml(page: Page): Promise<string> {
  await expect(page.locator('iframe[srcdoc]').last()).toBeAttached();
  return page
    .locator('iframe[srcdoc]')
    .last()
    .evaluate((frame) => frame.getAttribute('srcdoc') ?? '');
}

async function shootPrint(page: Page, html: string, path: string): Promise<void> {
  const paper = await page.context().newPage();
  await paper.setViewportSize({ width: 1123, height: 794 });
  await paper.setContent(html);
  // The top of the sheet: the plan and the medicines; the entries table runs on below.
  await paper.screenshot({ path, clip: { x: 0, y: 0, width: 1123, height: 794 } });
  await paper.close();
}

test.describe('patient: medicines taken before', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('are entered, edited, kept and printed', async ({ page }, testInfo) => {
    // Printing opens no dialog in the test.
    await page.addInitScript(() => {
      window.print = () => undefined;
      HTMLIFrameElement.prototype.focus = () => undefined;
    });
    await page.goto(await testInvitationLink(testInvitation({ doctor: 'Иванова А. А.' })));
    await openSettings(page);
    const row = page.getByRole('button', { name: /^Лекарства раньше/u });
    await expect(row).toBeVisible();
    await row.click();
    const sheet = page.getByTestId('med-history');
    await expect(sheet).toContainText('Какие лекарства вы принимали раньше?');
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('patient-empty.png') });

    await sheet.getByTestId('med-history-add').click();
    const name = sheet.getByRole('combobox', { name: 'Препарат' });
    await name.fill('Амоксициллин');
    await name.press('Tab');
    await sheet.getByTestId('med-history-from').fill('2020');
    await sheet.getByTestId('med-history-to').fill('2020');
    await sheet.getByTestId('med-history-duration').fill('3 дня');
    await sheet
      .getByTestId('med-history-stop')
      .getByRole('button', { name: 'Непереносимость' })
      .click();
    await sheet.getByTestId('med-history-reaction').fill('Крапивница на второй день');
    await sheet
      .getByTestId('med-history-severity')
      .getByRole('button', { name: 'Средняя' })
      .click();
    await sheet.getByTestId('med-history-allergy').getByRole('button', { name: 'Да' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('patient-editor.png') });

    // The «?» of a field explains it in the patient's words.
    await sheet.getByRole('button', { name: 'Пояснение: Тяжесть реакции' }).click();
    await expect(page.getByText('Средняя — мешала обычным делам.', { exact: false })).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('patient-help.png') });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeVisible();

    await sheet.getByTestId('med-history-save').click();
    const list = sheet.getByTestId('med-history-list');
    await expect(list).toContainText('Амоксициллин');
    await expect(list).toContainText('Аллергия');
    await expect(list).toContainText('2020, 3 дня');

    // A date that is not a date is refused with the reason.
    await sheet.getByTestId('med-history-add').click();
    await sheet.getByRole('combobox', { name: 'Препарат' }).fill('Флуоксетин');
    await sheet.getByRole('combobox', { name: 'Препарат' }).press('Tab');
    await sheet.getByTestId('med-history-from').fill('весной');
    await sheet.getByTestId('med-history-save').click();
    await expect(sheet.getByTestId('med-history-error')).toContainText('Начало');
    await sheet.getByTestId('med-history-from').fill('03.2023');
    await sheet.getByTestId('med-history-duration').fill('около года');
    await sheet.getByTestId('med-history-stop').getByRole('button', { name: 'Не помогал' }).click();
    await sheet.getByTestId('med-history-effect').getByRole('button', { name: 'Не помог' }).click();
    await sheet.getByTestId('med-history-save').click();
    await expect(list.locator('.med-history__item')).toHaveCount(2);
    await expect(list).toContainText('с марта 2023, около года');

    // Edited in place.
    await list.getByRole('button', { name: 'Флуоксетин: изменить' }).click();
    await sheet.getByLabel('Доза').fill('20 мг');
    await sheet.getByTestId('med-history-save').click();
    await expect(list).toContainText('20 мг');
    await page.waitForTimeout(300);
    await page.screenshot({ path: testInfo.outputPath('patient-list.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: testInfo.outputPath('patient-list-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    // Kept on the phone: back after a reload.
    await page.reload();
    await openSettings(page);
    await expect(page.getByRole('button', { name: /^Лекарства раньше/u })).toContainText('2');

    await page.getByRole('button', { name: /^Распечатать/u }).click();
    const html = await printedHtml(page);
    expect(html).toContain('<h2>Лекарства раньше</h2>');
    expect(html.indexOf('Амоксициллин')).toBeLessThan(html.indexOf('Флуоксетин'));
    await shootPrint(page, html, testInfo.outputPath('patient-print.png'));
  });
});

test.describe('doctor: medicines taken before', () => {
  let server: ChildProcess | undefined;
  let directory = '';
  let service = '';

  test.beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'minimed-diary-medhist-'));
    const port = 8_950 + test.info().workerIndex;
    service = `http://127.0.0.1:${port}`;
    server = spawn('bun', ['apps/diary-server/src/main.ts'], {
      cwd: ROOT,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        DIARY_SIGNUP: 'open',
        DIARY_DB: join(directory, 'diary.db'),
        DIARY_PORT: String(port),
      },
      stdio: 'ignore',
    });
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${service}/api/health`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });

  test.afterAll(() => {
    server?.kill();
    rmSync(directory, { recursive: true, force: true });
  });

  for (const width of [390, 1024] as const) {
    test(`sees, is warned and moves a medicine off the plan (${width} px)`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await page.addInitScript(() => {
        window.print = () => undefined;
        HTMLIFrameElement.prototype.focus = () => undefined;
      });
      await page.route(`${E2E_ASSET_ORIGIN}/api/**`, (route) =>
        route.continue({ url: route.request().url().replace(E2E_ASSET_ORIGIN, service) }),
      );
      await page.goto(`${E2E_ASSET_ORIGIN}/?profile=diaries#/notes/diaries`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByRole('button', { name: 'Демо — без регистрации' }).click();
      const rows = page.locator('.diary-dash-row');
      await expect(rows).toHaveCount(4, { timeout: 150_000 });
      await rows.filter({ hasText: 'Лиса' }).locator('.diary-dash-row__open').click();

      // The patient page names the allergy before anything else.
      const card = page.getByTestId('med-history-card');
      await expect(card).toContainText('Аллергия: амоксициллин', { timeout: 30_000 });
      await expect(card).toContainText('2 препарата');
      await page.waitForTimeout(400);
      await page.screenshot({ path: testInfo.outputPath(`doctor-page-${width}.png`) });
      await card.click();
      const panel = page.getByTestId('med-history');
      await expect(panel.getByTestId('med-history-list')).toContainText('внёс пациент');
      await expect(panel.getByTestId('med-history-list')).toContainText('внёс врач');
      await page.waitForTimeout(400);
      await page.screenshot({ path: testInfo.outputPath(`doctor-list-${width}.png`) });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(300);
      await page.screenshot({ path: testInfo.outputPath(`doctor-list-${width}-dark.png`) });
      await page.emulateMedia({ colorScheme: 'light' });

      // The doctor's «?» carries the definitions and the sources, the disagreement named.
      await panel.getByRole('button', { name: 'Амоксициллин: изменить' }).click();
      await panel.getByRole('button', { name: 'Пояснение: Почему перестали' }).click();
      await expect(page.getByText('данные противоречивы', { exact: false })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: testInfo.outputPath(`doctor-help-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByText('данные противоречивы', { exact: false })).toBeHidden();
      await expect(panel.getByTestId('med-history-editor')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();

      // Prescribing a medicine of the same ATC group as the allergy: a note, not a block.
      await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
      const drug = page.getByRole('button', { name: /^Изменить: Гидроксизин/u }).first();
      await expect(drug).toBeVisible({ timeout: 30_000 });
      await drug.click();
      const name = page.getByRole('combobox', { name: 'Препарат' });
      await name.fill('Ампициллин');
      await page
        .getByRole('option', { name: /^Ампициллин/u })
        .first()
        .click();
      const warning = page.getByTestId('med-history-warning');
      await expect(warning).toContainText('Амоксициллин');
      await expect(warning).toContainText('та же группа АТХ J01CA');
      await page.waitForTimeout(400);
      await page.screenshot({ path: testInfo.outputPath(`doctor-warning-${width}.png`) });
      // Not this change: take Гидроксизин off the plan instead.
      await name.fill('Гидроксизин');
      await name.press('Tab');
      await page.getByRole('button', { name: /^Удалить раздел Гидроксизин/u }).click();
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();

      // Back on the patient page: «перенести в историю?», filled in from the plan.
      const offer = page.getByTestId('med-history-offer');
      await expect(offer).toContainText('Гидроксизин', { timeout: 30_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: testInfo.outputPath(`doctor-offer-${width}.png`) });
      await offer.getByTestId('med-history-offer-move').click();
      const editor = page.getByTestId('med-history-editor');
      await expect(editor.getByRole('combobox', { name: 'Препарат' })).toHaveValue('Гидроксизин');
      await editor
        .getByTestId('med-history-stop')
        .getByRole('button', { name: 'Другая причина' })
        .click();
      await editor.getByPlaceholder('Какая причина').fill('Курс окончен');
      await editor
        .getByTestId('med-history-effect')
        .getByRole('button', { name: 'Помог', exact: true })
        .click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: testInfo.outputPath(`doctor-move-${width}.png`) });
      await editor.getByTestId('med-history-save').click();
      await expect(page.getByTestId('med-history')).toBeHidden();
      await expect(offer).toHaveCount(0);
      await expect(card).toContainText('3 препарата');

      // On a phone the header folds «Распечатать» into «⋯».
      const print = page.getByRole('button', { name: 'Распечатать', exact: true });
      if (await print.isVisible()) await print.click();
      else {
        await page.getByRole('button', { name: 'Ещё', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Распечатать' }).click();
      }
      const html = await printedHtml(page);
      expect(html).toContain('Пациент: Демо · Лиса');
      for (const medicine of ['Амоксициллин', 'Пароксетин', 'Гидроксизин', 'Курс окончен']) {
        expect(html).toContain(medicine);
      }
      if (width === 1024) await shootPrint(page, html, testInfo.outputPath('doctor-print.png'));
    });
  }
});
