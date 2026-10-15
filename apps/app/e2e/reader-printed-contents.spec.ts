import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

import { E2E_ASSET_ORIGIN, mountBuiltApp, waitForSearchEditable } from './mount-built-app';

// UI-FIX1 (QA 0.6.60, item 9): «Внебольничная пневмония у детей» of the shipped «Педиатрия:
// дыхание и аллергология» module opened on its printed table of contents («Оглавление Список
// сокращений ……… 4 …»), 29 «sections» of leader dots. The reader keeps that text in one collapsed
// block and starts on the document itself.
const MODULE_DATABASE = resolve(
  import.meta.dirname,
  '../public/content/modules/minimed-respiratory-pediatrics-full-0.3.4-preview.1.db',
);
const FIXTURE_BUNDLE = resolve(import.meta.dirname, 'fixtures/e2e-local.minimed-module.zip');
const DOCUMENTS = [
  ['kr.rf.360_3.bronchiolitis.full', '360_3-2025-full', 'Острый бронхиолит у детей'],
  ['kr.rf.381_3.bronchitis.full', '381_3-2024-full', 'Бронхит у детей'],
  ['kr.rf.714_2.pneumonia.full', '714_2-2025-full', 'Внебольничная пневмония у детей'],
] as const;

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The committed module database wrapped as a module file, installed from Settings → Загрузки. */
async function legacyModuleFile(): Promise<Buffer> {
  const raw = readFileSync(MODULE_DATABASE);
  const packed = gzipSync(raw);
  const template = await JSZip.loadAsync(readFileSync(FIXTURE_BUNDLE));
  const manifest = JSON.parse(await (template.file('module.json')?.async('string') ?? '{}')) as {
    [key: string]: unknown;
    artifacts: Array<Record<string, unknown>>;
    sizes: Record<string, unknown>;
  };
  const artifactId = 'minimed.reference.e2e-legacy-respiratory-index-2026.10.15';
  const artifact = manifest.artifacts[0];
  if (!artifact) throw new Error('The module file fixture has no artifact.');
  Object.assign(artifact, {
    id: artifactId,
    url: 'minimed-local:artifacts/legacy.2026.10.15.db.gz',
    sha256: sha256(packed),
    sizeBytes: packed.byteLength,
    decodedSha256: sha256(raw),
    decodedSizeBytes: raw.byteLength,
  });
  Object.assign(manifest.sizes, {
    downloadBytes: packed.byteLength,
    installedBytes: raw.byteLength,
  });
  Object.assign(manifest, {
    id: 'minimed.reference.e2e-legacy-respiratory',
    version: '2026.10.15',
    title: 'E2E легаси-модуль',
    documents: DOCUMENTS.map(([id, version, title]) => ({
      documentId: id,
      documentVersionId: `${id}@${version}`,
      sourceChecksum: sha256(Buffer.from(id)),
      status: 'active',
      title,
      indexArtifactId: artifactId,
      sourceAssetArtifactId: null,
    })),
    previewDocumentCount: DOCUMENTS.length,
  });
  const bundle = new JSZip();
  bundle.file('module.json', JSON.stringify(manifest));
  bundle.file('artifacts/legacy.2026.10.15.db.gz', packed);
  return bundle.generateAsync({ type: 'nodebuffer' });
}

test('a guideline whose PDF starts with a printed contents opens on its text, the contents collapsed', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/settings/downloads`);
  await page.locator('.module-file-import__input').setInputFiles({
    name: 'legacy.minimed-module.zip',
    mimeType: 'application/zip',
    buffer: await legacyModuleFile(),
  });
  await expect(page.getByText('Установлен «E2E легаси-модуль».')).toBeVisible({ timeout: 90_000 });

  await page.goto(
    `${E2E_ASSET_ORIGIN}/#/modules/documents/d/${Buffer.from('kr.rf.714_2.pneumonia.full').toString('base64url')}`,
  );
  await page.locator('.document-overlay-section__title').first().waitFor({ timeout: 90_000 });

  // The first section on the page is the document's own, not a contents line with leader dots.
  const firstTitle = await page.locator('.document-overlay-section__title').first().innerText();
  expect(firstTitle).not.toMatch(/\.{4,}/u);

  // The printed contents are there, closed, and keep their text when opened.
  const block = page.locator('.printed-contents');
  await expect(block).toHaveCount(1);
  const toggle = block.getByRole('button', { name: /Оглавление печатной версии/u });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: `${process.env['SHOT_DIR'] ?? 'playwright'}/kr-closed.png` });
  await toggle.click();
  await expect(block.locator('.printed-contents__line').first()).toBeVisible();
  await expect(block).toContainText('Термины и определения');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: `${process.env['SHOT_DIR'] ?? 'playwright'}/kr-open.png` });
});

// UI-FIX1 (QA 0.6.60, item 9): a document opened from a search result opens at the fragment that was
// found (the card's header and «Открыть полный документ» both carry its anchor), not at the top.
test('a guideline opened from its search card jumps to the found fragment', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await mountBuiltApp(page, { skipLargeCompanionPacks: true });
  await page.goto(`${E2E_ASSET_ORIGIN}/#/settings/downloads`);
  await page.locator('.module-file-import__input').setInputFiles({
    name: 'legacy.minimed-module.zip',
    mimeType: 'application/zip',
    buffer: await legacyModuleFile(),
  });
  await expect(page.getByText('Установлен «E2E легаси-модуль».')).toBeVisible({ timeout: 90_000 });

  await page.goto(`${E2E_ASSET_ORIGIN}/#/search`);
  await waitForSearchEditable(page);
  await page.getByTestId('search-input').fill('азитромицин амоксициллин при пневмонии у детей');
  const card = page.locator('.result-group[data-document-id="kr.rf.714_2.pneumonia.full"]');
  await expect(card).toBeVisible({ timeout: 90_000 });
  await card.locator('.result-group-header').click();

  const target = page.locator('.document-initial-anchor');
  await expect(target).toHaveCount(1, { timeout: 60_000 });
  await expect
    .poll(async () =>
      target.evaluate((node) => node.getBoundingClientRect().top < window.innerHeight),
    )
    .toBe(true);
  // The printed contents did not take the first screen.
  await expect(page.locator('.printed-contents')).toHaveCount(1);
  await page.screenshot({ path: `${process.env['SHOT_DIR'] ?? 'playwright'}/kr-from-search.png` });
});
