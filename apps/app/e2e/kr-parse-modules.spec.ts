import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, type Page, test } from '@playwright/test';
import { LOCAL_DATA_ROOT } from './local-data';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
// Local copy of the KR-PARSE republish (2026-10-25, docs/data-ledger.json): the exact published bytes.
const DIRECTORY = 'output/module-zstd-json-2026-10-25';

interface ParsedModule {
  readonly officialId: string;
  readonly pointer: string;
  readonly check: (page: Page) => Promise<void>;
}

const paperText = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('main')?.textContent ?? '');

const MODULES: readonly ParsedModule[] = [
  {
    // Footnote superscripts no longer glue onto the dose: «500¹-1000²», not «5001-10002».
    officialId: '309_2',
    pointer: 'core.catalog.pointer.clinical.kr.rf.309_2-c30512232309202b',
    check: async (page) => {
      const text = await paperText(page);
      expect(text).toContain('внутрь 500¹-1000² мг 3 раза в сутки');
      expect(text).not.toContain('5001-10002');
    },
  },
  {
    // A superscript «0» before C is the degree sign: «30°C», not «300C».
    officialId: '678_2',
    pointer: 'core.catalog.pointer.clinical.kr.rf.678_2-0a6b4f4202f5f9da',
    check: async (page) => {
      const text = await paperText(page);
      expect(text).toContain('температурой ниже 30°C');
      expect(text).not.toContain('ниже 300C');
    },
  },
  {
    // Paragraphs inside one table cell stay separate lines.
    officialId: '283_2',
    pointer: 'core.catalog.pointer.clinical.kr.rf.283_2-fe4c92a4870ee8ef',
    check: async (page) => {
      const cell = page
        .locator('.document-rich-table__cell', { hasText: '40-80 мг/сутки' })
        .first();
      // Off-screen sections are not laid out, so read the text, not innerText.
      expect(await cell.evaluate((node) => node.textContent ?? '')).toMatch(
        /^40-80 мг\/сутки\n25-50 мг\/сутки/u,
      );
    },
  },
  {
    // An off-label row «# Рифампицин» is a table row, not a section of its own.
    officialId: '1028_1',
    pointer: 'core.catalog.pointer.clinical.kr.rf.1028_1-3c18c939de2499d5',
    check: async (page) => {
      await expect(
        page
          .locator('.document-overlay-outline-section-button__label')
          .filter({ hasText: 'Рифампицин' }),
      ).toHaveCount(0);
      expect(await paperText(page)).toContain('# Рифампицин**');
    },
  },
];

const route = (id: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

for (const module of MODULES) {
  test(`a KR-PARSE module (${module.officialId}) reads as the source wrote it`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const catalog = ContentModuleCatalogSchema.parse(
      JSON.parse(
        await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
      ),
    );
    const artifact = catalog.modules
      .find((entry) => entry.id === `minimed.clinical.recommendation.${module.officialId}`)
      ?.artifacts.find((item) => item.kind === 'index');
    if (!artifact?.url) throw new Error(`Missing ${module.officialId} artifact`);
    const fileName = new URL(artifact.url).pathname.split('/').at(-1) ?? '';
    const localPath = resolve(LOCAL_DATA_ROOT, DIRECTORY, fileName);
    test.skip(!existsSync(localPath), `The module file ${fileName} is local-only.`);
    const bytes = await readFile(localPath);
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
    await page.route(
      (url) => url.pathname.endsWith(`/${fileName}`),
      (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
    );
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await waitForSearchEditable(page);
    await page.goto(route(module.pointer));
    await page.locator('.document-module-pointer__action').click();
    await expect(page).toHaveURL(route(`kr.rf.${module.officialId}`), { timeout: 90_000 });
    await page.locator('.document-overlay-section__title').first().waitFor();
    await expect(page.locator('.document-overlay-paper__pending')).toHaveCount(0, {
      timeout: 90_000,
    });
    await module.check(page);
  });
}
