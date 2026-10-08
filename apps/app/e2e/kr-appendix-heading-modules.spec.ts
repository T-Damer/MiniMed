import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
// Local copy of the KR4 rebuild (docs/data-ledger.json): the tests serve exactly the published bytes.
const REBUILT_DIRECTORY = 'output/module-zstd-json-2026-10-08';

interface RebuiltModule {
  readonly officialId: string;
  readonly pointer: string;
  /** Sections the reader shows (sections without any text below them are hidden) after the rebuild. */
  readonly visibleSections: number;
  /** The same count for the module as published before the rebuild: the rest are appendix titles. */
  readonly visibleSectionsBefore: number;
  readonly headings: readonly RegExp[];
}

const MODULES: readonly RebuiltModule[] = [
  {
    officialId: '655_2',
    pointer: 'core.catalog.pointer.clinical.kr.rf.655_2-f32e4acf942e2fef',
    visibleSections: 35,
    visibleSectionsBefore: 33,
    headings: [/^Приложение Б1\.\s+Схема диагностики хронического бронхита/u],
  },
  {
    officialId: '283_2',
    pointer: 'core.catalog.pointer.clinical.kr.rf.283_2-fe4c92a4870ee8ef',
    visibleSections: 70,
    visibleSectionsBefore: 57,
    headings: [
      /^Приложение Б3\.\s+Алгоритм фармакотерапии обструктивной ГКМП/u,
      /^Приложение Б6\.\s+Алгоритм выбора метода редукции МЖП/u,
    ],
  },
  {
    officialId: '739_2',
    pointer: 'core.catalog.pointer.clinical.kr.rf.739_2-b8e9c7fcfc624cc3',
    visibleSections: 68,
    visibleSectionsBefore: 67,
    headings: [
      /^Приложение Г1\s+Расширенная Шкала Статуса Инвалидизации/u,
      /^Приложение Г2\.\s+Шкала баланса Берг/u,
    ],
  },
];

const route = (id: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

for (const module of MODULES) {
  test(`a rebuilt recommendation (${module.officialId}) installs and opens its appendix titles as headings`, async ({
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
    const localPath = resolve(ROOT, REBUILT_DIRECTORY, fileName);
    test.skip(!existsSync(localPath), `The rebuilt module file ${fileName} is local-only.`);
    const bytes = await readFile(localPath);
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(artifact.sha256);
    await page.route(
      (url) => url.pathname.endsWith(`/${fileName}`),
      (request) => request.fulfill({ body: bytes, contentType: 'application/zstd' }),
    );
    await mountBuiltApp(page, { skipLargeCompanionPacks: true });
    await expect(page.getByTestId('search-input')).toHaveAttribute('data-search-ready', 'true', {
      timeout: 60_000,
    });
    await page.goto(route(module.pointer));
    await page.locator('.document-module-pointer__action').click();
    await expect(page).toHaveURL(route(`kr.rf.${module.officialId}`), { timeout: 90_000 });
    await page.locator('.document-overlay-section__title').first().waitFor();
    await expect(page.locator('.document-overlay-paper__pending')).toHaveCount(0, {
      timeout: 90_000,
    });

    // Every shown section is one outline entry and one rendered section; the appendix titles are
    // the sections the rebuild added, each once in the outline and once as a title, never as body text.
    expect(module.visibleSections).toBeGreaterThan(module.visibleSectionsBefore);
    const outline = await page.locator('.document-overlay-outline-section-button').count();
    expect(outline).toBeGreaterThanOrEqual(module.visibleSections);
    await expect(page.locator('.document-overlay-section')).toHaveCount(outline);

    for (const heading of module.headings) {
      await expect(
        page
          .locator('.document-overlay-outline-section-button__label')
          .filter({ hasText: heading }),
      ).toHaveCount(1);
      await expect(
        page.locator('.document-overlay-section__title').filter({ hasText: heading }),
      ).toHaveCount(1);
      const asParagraph = await page
        .locator('.document-overlay-section__paragraph')
        .evaluateAll(
          (nodes, source) =>
            nodes.filter((node) => new RegExp(source, 'u').test(node.textContent ?? '')).length,
          heading.source,
        );
      expect(asParagraph, `${heading} is not repeated as body text`).toBe(0);
    }
  });
}
