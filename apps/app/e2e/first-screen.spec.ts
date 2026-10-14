import { expect, type Page, test } from '@playwright/test';

import { installClinicalModule, routeClinicalModule } from './clinical-module-fixture';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

// Owner 2026-10-14: «You open a doc — you see some info about the topic as well as the text; you
// shouldn't scroll much to see actual info.» At 375×812 the first line of a document's own text
// must stand above the bottom navigation, with one meta line under the title and no stacked
// notices in between. The bound is generous (the nav top is ~752 px); a card that grows past it,
// or a floating counter that lies over the text, fails here.
const PHONE = { width: 375, height: 812 } as const;
/** Pointer cards (the text lives in a download) keep their offer, so they get a little less room. */
const FIRST_SCREEN_TEXT_LIMIT = 520;

test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

const documentRoute = (id: string): string =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

interface FirstScreen {
  readonly navTop: number;
  /** Top of the first rendered line of the document's own text. */
  readonly textTop: number | null;
}

/** The top of the first text line inside the first element matching `selector` that shows text. */
async function firstScreen(page: Page, selector: string): Promise<FirstScreen> {
  return page.evaluate((textSelector) => {
    const nav = document.querySelector('.app-bottom-nav');
    const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    for (const element of document.querySelectorAll(textSelector)) {
      if (element.getBoundingClientRect().height === 0) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node.textContent ?? '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getClientRects()[0];
        if (rect) return { navTop, textTop: rect.top };
      }
    }
    return { navTop, textTop: null };
  }, selector);
}

async function expectTextOnFirstScreen(page: Page, selector: string, limit: number): Promise<void> {
  await expect
    .poll(async () => (await firstScreen(page, selector)).textTop, { timeout: 60_000 })
    .not.toBeNull();
  const { navTop, textTop } = await firstScreen(page, selector);
  expect(textTop ?? Number.POSITIVE_INFINITY).toBeLessThan(Math.min(navTop, limit));
}

test('an opened clinical recommendation starts its text on the first screen under one meta line', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeClinicalModule(page);
  await mountBuiltApp(page);
  await installClinicalModule(page);
  await page.locator('.document-overlay-section__title').first().waitFor();

  await expectTextOnFirstScreen(page, '.document-text-chunk', 300);
  // Kind, edition and audience on one line; never the internal edition id.
  const meta = page.locator('.document-overlay-paper__meta');
  await expect(meta).toHaveText(/^Клинические рекомендации · ред\. \d+/u);
  await expect(meta).not.toContainText('1006_1');
  expect(await meta.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(30);

  // The page counter is not on the page at the top, and once the reader scrolls it sits in the
  // opaque section-path bar — never a floating pill over the text.
  await expect(page.locator('[data-reader-page-dock]')).toHaveCount(0);
  await expect(page.locator('.reader-section-path__line--shown')).toHaveCount(0);
  for (let step = 0; step < 6; step += 1) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(120);
  }
  const bubble = page.locator(
    '.reader-section-path__line--shown [data-reader-page-bubble="summary"]',
  );
  await expect(bubble).toBeVisible();
  await expect(page.locator('[data-reader-page-dock]')).toHaveCount(0);
  const box = await bubble.boundingBox();
  // At the top edge, on the bar, in the right half of the line.
  expect(box?.y ?? 999).toBeLessThan(80);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(PHONE.width * 0.8);
});

test('a legal act opens on its text, names its kind on one line and shows no raw address', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page);
  await page.goto(documentRoute('regulatory.rf.minzdrav.1122n-2021'));
  await page.locator('.document-overlay-paper__title').waitFor({ timeout: 90_000 });

  await expectTextOnFirstScreen(page, '.document-text-chunk', 300);
  await expect(page.locator('.document-overlay-paper__meta')).toContainText('Приказ');
  expect(
    await page
      .locator('.document-overlay-paper__meta')
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBeLessThan(30);

  // The official address in the source section is a link named by its site, not the long URL.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const source = page.locator('a.document-inline-link[href*="publication.pravo.gov.ru"]').first();
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(source).toBeAttached({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(source).toContainText('publication.pravo.gov.ru');
  await expect(source).not.toContainText('https://');
});

test('a short ICD-10 card keeps its text and offer on the first screen with one-line rows', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountBuiltApp(page);
  await page.goto(
    documentRoute('core.catalog.pointer.reference.rls.mkb.node.c74-345c5cb6f8b1122e'),
  );
  await page.locator('.document-overlay-paper__title').waitFor({ timeout: 90_000 });
  await expect(page.locator('.document-module-pointer__action')).toBeVisible();
  await expectTextOnFirstScreen(page, '.document-text-chunk', FIRST_SCREEN_TEXT_LIMIT);
  // The ICD-11 mapping is a flat one-line row, not a card with a wrapped title.
  const row = page.locator('.icd10-to-icd11 .ui-disclosure__header');
  await expect(row).toBeVisible();
  expect(await row.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(52);
});

test('a calculator shows its first input on the first screen', async ({ page }) => {
  await mountBuiltApp(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/calculators/unit-conversion`);
  const input = page.locator('.calculator-form select, .calculator-form input').first();
  await expect(input).toBeVisible({ timeout: 60_000 });
  const { navTop } = await firstScreen(page, '.calculator-form');
  const top = await input.evaluate((node) => node.getBoundingClientRect().top);
  expect(top).toBeLessThan(Math.min(navTop, 300));
});

test('a user document opens on its text with no stripe above it and no pager over the text', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/user`);
  await page.locator('.user-library-page__file-input').waitFor({ state: 'attached' });
  const paragraphs = Array.from(
    { length: 40 },
    (_, index) =>
      `Абзац ${String(index + 1)}. Достаточно длинный текст врача для проверки переноса строк на узком экране телефона и положения счётчика страниц.`,
  );
  await page.locator('.user-library-page__file-input').setInputFiles({
    name: 'doctor-notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      `# Заметки врача\n\n## Первый раздел\n\n${paragraphs.slice(0, 20).join('\n\n')}\n\n## Второй раздел\n\n${paragraphs.slice(20).join('\n\n')}\n`,
    ),
  });
  await page.locator('.user-library-card').filter({ hasText: 'doctor-notes' }).click();
  await expect(page.locator('.document-overlay-paper__title')).toBeVisible({ timeout: 60_000 });
  await expectTextOnFirstScreen(
    page,
    '.user-document-reader__document-surface p, .document-overlay-section__paragraph, .safe-markdown p',
    330,
  );
  // The edit action is an icon button with a name, in a header that takes one short row.
  const edit = page.getByRole('button', { name: 'Редактировать', exact: true });
  await expect(edit).toBeVisible();
  expect(await edit.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(48);
  await expect(page.locator('[data-reader-page-dock]')).toHaveCount(0);
});

test('a damaged document link says «Документ не найден» and has a way back', async ({ page }) => {
  await mountBuiltApp(page);
  await page.goto(`${E2E_ASSET_ORIGIN}/#/modules/documents/d/%%%`);
  const notFound = page.getByRole('heading', { name: 'Документ не найден' });
  await expect(notFound).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Назад' })).toBeVisible();
  await page.getByRole('button', { name: 'Искать в базе' }).click();
  await expect(page).toHaveURL(/#\/search/u);
  await expect(notFound).toHaveCount(0);
});

test('an address no source knows shows «Документ не найден» inside the reader', async ({
  page,
}) => {
  await mountBuiltApp(page);
  await page.goto(documentRoute('no.such.document'));
  await expect(page.locator('.document-page__error')).toContainText('Документ не найден', {
    timeout: 90_000,
  });
  await expect(page.locator('.document-page__error')).not.toContainText('Подождите завершения');
  await expect(page.getByRole('button', { name: 'Назад' })).toBeVisible();
});
