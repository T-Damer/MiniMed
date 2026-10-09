import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContentModuleCatalogSchema } from '@localmed/contracts';
import { expect, test } from '@playwright/test';
import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

const ROOT = resolve(import.meta.dirname, '../../..');
// Local copies of the KR3 rebuild and of the KR4 rebuild (appendix headings) that superseded 555_3
// (docs/data-ledger.json): the tests serve exactly the published bytes.
const REBUILT_DIRECTORIES = [
  'output/module-zstd-json-2026-10-08',
  'output/module-zstd-json-2026-10-07',
];

interface RebuiltModule {
  readonly officialId: string;
  readonly pointer: string;
  /** Sections the reader shows (sections without any text below them are hidden) after the rebuild. */
  readonly visibleSections: number;
  /** The same count for the module as published before the rebuild: the rest are promoted headings. */
  readonly visibleSectionsBefore: number;
  readonly headings: readonly RegExp[];
}

const MODULES: readonly RebuiltModule[] = [
  {
    officialId: '1062_1',
    pointer: 'core.catalog.pointer.clinical.kr.rf.1062_1-481e31c1c5973533',
    visibleSections: 44,
    visibleSectionsBefore: 36,
    headings: [/^2\.5\.2\s+Другие/u, /^1\.2\s+Нейросекреторная дисфункция/u],
  },
  {
    officialId: '555_3',
    pointer: 'core.catalog.pointer.clinical.kr.rf.555_3-a184a82d9d24f40d',
    // 36 in the KR3 build; the KR4 rebuild (appendix headings) added three more.
    visibleSections: 39,
    visibleSectionsBefore: 35,
    headings: [/^4\.1\.\s+Пререабилитация/u, /^4\.2\.\s+Реабилитация при хирургическом лечении/u],
  },
  {
    officialId: '960_1',
    pointer: 'core.catalog.pointer.clinical.kr.rf.960_1-86ddcd4e4dbba070',
    visibleSections: 185,
    visibleSectionsBefore: 127,
    headings: [/^3\.2\.5\.9\.\s+Антагонисты витамина К/u, /^3\.7\.3\.1\.\s+Виды ГИТ/u],
  },
];

const route = (id: string) =>
  `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from(id).toString('base64url')}`;

for (const module of MODULES) {
  test(`a rebuilt recommendation (${module.officialId}) installs, outlines its sub-headings once and shows each heading once`, async ({
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
    const localPath =
      REBUILT_DIRECTORIES.map((directory) => resolve(ROOT, directory, fileName)).find((path) =>
        existsSync(path),
      ) ?? resolve(ROOT, REBUILT_DIRECTORIES[0] ?? '', fileName);
    test.skip(!existsSync(localPath), `The rebuilt module file ${fileName} is local-only.`);
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

    // Every shown section is one outline entry and one rendered section. The stored sections are
    // all there; the reader adds only the numbered paragraphs the extractor kept as body text
    // (headings with no text of their own, which the reader would otherwise hide), never a stored one.
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
