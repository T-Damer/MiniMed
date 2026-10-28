import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import {
  addReading,
  DIARY_PAGE,
  IPHONE_MESSENGER,
  IPHONE_SAFARI,
  localInput,
  openPasteSheet,
  openRecords,
  openRestoreSheet,
  openSettings,
  testInvitation,
  testInvitationLink,
} from './diary-fixtures';

// Every screen of the patient diary at phone and desktop width, light and dark, is checked for what
// an older patient needs: touch targets of at least 48px, readable text, contrast, no sideways
// scrolling. Review screenshots are written only when asked for:
//   DIARY_SCREENSHOTS=1 bunx playwright test diary-screens
const OUTPUT = resolve(import.meta.dirname, '../../../output/diary4-screens/after');
const SCREENSHOTS = Boolean(process.env['DIARY_SCREENSHOTS']);

interface Finding {
  readonly kind: string;
  readonly what: string;
}

/** Runs in the page: collects everything that breaks the reading and tapping rules. */
function findProblems(scope: string | undefined): Finding[] {
  const root = (scope ? document.querySelector(scope) : null) ?? document.body;
  const found: Finding[] = [];
  const describe = (element: Element): string =>
    `${element.tagName.toLowerCase()}.${String(element.getAttribute('class') ?? '').split(' ')[0]} «${(element.textContent ?? '').trim().slice(0, 40)}»`;
  const shown = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
    );
  };

  // Touch targets: a control, or the label row around a checkbox, at least 48px each way.
  const controls = root.querySelectorAll(
    'button, a[href], summary, textarea, select, input:not([type="hidden"]):not([type="file"]), label.ui-file-button',
  );
  for (const element of controls) {
    if (!shown(element)) continue;
    const target =
      element instanceof HTMLInputElement && element.type === 'checkbox'
        ? (element.closest('label') ?? element)
        : element;
    const box = target.getBoundingClientRect();
    const quiet = element.classList.contains('diary-screen__back');
    // The round icon buttons of the main app's chrome keep the main app's size (owner 2026-10-28):
    // the page header (back, «?», header actions), a sheet's and a dialog's close button (≈40px).
    // Every other control keeps the diary's 48px.
    const mainChrome =
      element.closest('header.page, .diary-sheet__header') !== null ||
      element.classList.contains('overlay-dialog__close-button');
    const minimum = mainChrome ? 39.5 : 47.5;
    if (box.height < minimum || (box.width < minimum && !quiet)) {
      found.push({
        kind: 'target',
        what: `${describe(element)} is ${Math.round(box.width)}x${Math.round(box.height)}`,
      });
    }
  }

  // Text: body 17px, nothing below 15px (the small badges).
  const page = document.querySelector('.diary-page');
  if (page && Number.parseFloat(getComputedStyle(page).fontSize) < 17) {
    found.push({ kind: 'font', what: 'page text is smaller than 17px' });
  }
  const parse = (css: string): [number, number, number, number] => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [0, 0, 0, 1];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const luminance = ([r, g, b]: readonly number[]): number => {
    const channel = (value: number): number => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
  };
  const background = (element: Element): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 0.999) break;
    }
    let [r, g, b] = [255, 255, 255];
    for (const [lr, lg, lb, la] of layers.toReversed()) {
      r = lr * la + r * (1 - la);
      g = lg * la + g * (1 - la);
      b = lb * la + b * (1 - la);
    }
    return [r, g, b];
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    const element = node.parentElement;
    // The install guide's miniature of the browser is a picture (hidden from readers); the steps
    // under it, which are checked, carry the words.
    if (
      !text ||
      !element ||
      !shown(element) ||
      element.closest('script, style, noscript, .install-scene')
    ) {
      continue;
    }
    const style = getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize);
    if (size < 15) found.push({ kind: 'font', what: `${describe(element)} is ${size}px` });
    if (element.closest('button:disabled, .diary-share__code')) continue;
    const [fr = 0, fg = 0, fb = 0, fa = 1] = parse(style.color);
    const [br = 0, bg = 0, bb = 0] = background(element);
    const foreground = [fr * fa + br * (1 - fa), fg * fa + bg * (1 - fa), fb * fa + bb * (1 - fa)];
    const light = Math.max(luminance(foreground), luminance([br, bg, bb]));
    const dark = Math.min(luminance(foreground), luminance([br, bg, bb]));
    const ratio = (light + 0.05) / (dark + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      found.push({
        kind: 'contrast',
        what: `${describe(element)} has ${ratio.toFixed(2)}:1 (${style.color} on rgb(${Math.round(br)}, ${Math.round(bg)}, ${Math.round(bb)}))`,
      });
    }
  }

  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    found.push({
      kind: 'overflow',
      what: `page is ${document.documentElement.scrollWidth}px wide in ${window.innerWidth}px`,
    });
  }
  return found;
}

/**
 * `scope` narrows the scan to one element: a sheet or panel open over a page is checked on its
 * own, so the page behind it is not reported again. `lint: false` only takes the screenshots (the
 * care diary's day page has its own dense layout, a heatmap of small cells, that these older-patient
 * rules were never written for).
 */
async function check(
  page: Page,
  name: string,
  tag: string,
  scope?: string,
  lint = true,
): Promise<void> {
  // Soft: one screen's findings must not hide the problems of the screens after it.
  if (lint) expect.soft(await page.evaluate(findProblems, scope), name).toEqual([]);
  if (SCREENSHOTS) {
    mkdirSync(OUTPUT, { recursive: true });
    const engine = test.info().project.name === 'webkit-ios' ? '-webkit' : '';
    tag = `${tag}${engine}`;
    await page.screenshot({ path: `${OUTPUT}/${name}-${tag}.png`, fullPage: true });
    // What fits on the phone's first screen, without scrolling.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUTPUT}/${name}-first-screen-${tag}.png` });
  }
}

for (const width of [390, 1024]) {
  for (const scheme of ['light', 'dark'] as const) {
    const tag = `${width}-${scheme}`;

    test(`patient diary screens at ${width}px, ${scheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'canShare', { value: undefined });
      });

      // The empty list of a device that has no diary yet: paste the doctor's link.
      await page.goto(DIARY_PAGE);
      await expect(page.getByRole('region', { name: 'Вставьте ссылку от врача' })).toBeVisible();
      await check(page, '0-empty-list', tag);

      const pressure = testInvitation({
        doctor: 'Иванова А. А.',
        note: 'Утром и вечером, сидя, после 5 минут отдыха',
      });
      await page.goto(await testInvitationLink(pressure));
      await expect(page.locator('.diary-notice')).toBeVisible();
      await check(page, '1-home-new', tag);

      await page.getByRole('button', { name: 'Записать показания', exact: true }).click();
      await expect(page.getByLabel(/^Верхнее/u)).toBeVisible();
      await check(page, '2-entry-form', tag);
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.locator('.diary-form__error')).toBeVisible();
      await check(page, '3-entry-form-errors', tag);
      await page.getByLabel(/^Верхнее/u).fill('138');
      await page.getByLabel(/^Нижнее/u).fill('88');
      await page.getByRole('button', { name: 'Изменить время' }).click();
      await page.getByLabel('Дата и время').fill(localInput(0, 7, 55));
      await check(page, '4-entry-form-filled', tag);
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.locator('.diary-saved')).toBeVisible();
      await check(page, '5-home-saved', tag);

      await addReading(page, { systolic: 150, diastolic: 95, pulse: 80, at: localInput(2, 8, 10) });
      await openSettings(page);
      await check(page, '8-settings', tag);
      await openRestoreSheet(page);
      await check(page, '8a-settings-restore-sheet', tag, '[role="dialog"]');
      await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();
      await openPasteSheet(page);
      await check(page, '8b-settings-paste-sheet', tag, '[role="dialog"]');
      await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();
      await page.getByRole('button', { name: 'Как пользоваться дневником' }).click();
      await check(page, '8c-settings-help', tag, '[role="dialog"]');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'На главную', exact: true }).click();

      await openRecords(page);
      await check(page, '6-records', tag);
      await page
        .locator('.diary-record')
        .first()
        .getByRole('button', { name: /^Удалить/u })
        .click();
      await check(page, '7-records-delete', tag);
      await page.getByRole('button', { name: 'Нет, оставить' }).click();

      await page.getByRole('button', { name: 'Отправить врачу', exact: true }).click();
      await check(page, '9-send', tag);
      await page.getByRole('button', { name: 'Показать врачу на экране', exact: true }).click();
      await expect(page.locator('.diary-share__code')).toBeVisible();
      await check(page, 'a-send-codes', tag);
      await page.getByRole('button', { name: 'Да, врач получил' }).click();
      await check(page, 'b-send-done', tag);
      await page.getByRole('button', { name: 'На главную', exact: true }).click();
      await check(page, 'c-home-sent', tag);

      await page.goto(await testInvitationLink(testInvitation({ template: 'glucose' })));
      await page.goto(DIARY_PAGE);
      await expect(page.locator('.diary-list__item')).toHaveCount(2);
      await check(page, 'd-list', tag);

      const child = testInvitation({ template: 'child', doctor: 'Петрова Е. В.' });
      await page.goto(await testInvitationLink(child));
      await page.getByRole('button', { name: 'Записать показания', exact: true }).click();
      await expect(page.getByLabel('Был стул')).toBeVisible();
      await check(page, 'e-entry-form-long', tag);

      // The care diary: the day page with the tab bar, then its other tabs.
      const care = testInvitation({
        template: 'care',
        doctor: 'Иванова А. А.',
        plan: [{ id: 'p1', name: 'Эналаприл', dose: '5 мг', times: [{ time: '08:00' }] }],
        contacts: [{ kind: 'phone', value: '+7 900 000-00-00', label: 'Регистратура' }],
      });
      await page.goto(await testInvitationLink(care));
      const tabs = page.getByRole('navigation', { name: 'Дневник' });
      await expect(tabs).toBeVisible();
      await check(page, 'h-care-today', tag, undefined, false);
      await tabs.getByRole('button', { name: 'Записи', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Записи', exact: true }),
      ).toBeVisible();
      await check(page, 'i-care-records', tag, undefined, false);
      await tabs.getByRole('button', { name: 'Врачу', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Отправить врачу' })).toBeVisible();
      await check(page, 'j-care-send', tag, undefined, false);
      await tabs.getByRole('button', { name: 'Настройки', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
      await check(page, 'k-care-settings', tag, undefined, false);
    });

    test(`patient diary on an iPhone, ${scheme}, ${width}px`, async ({ browser }) => {
      const link = await testInvitationLink(testInvitation({ doctor: 'Иванова А. А.' }));
      for (const [name, userAgent] of [
        ['f-iphone-install-tip', IPHONE_SAFARI],
        ['g-messenger-warning', IPHONE_MESSENGER],
      ] as const) {
        const context = await browser.newContext({
          userAgent,
          colorScheme: scheme,
          viewport: { width, height: width === 390 ? 844 : 768 },
        });
        const page = await context.newPage();
        await page.goto(link);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await check(page, name, tag);
        // The warning row opens the animated guide for this browser in a sheet.
        await page
          .getByRole('button', { name: /Добавьте дневник на экран|Откройте дневник в браузере/u })
          .click();
        await expect(page.locator('.install-guide__label').first()).toBeVisible();
        await check(page, `${name}-guide`, tag, '[role="dialog"]');
        await context.close();
      }
    });
  }
}
