import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { ANDROID_CORE_DOWNLOAD } from '@/composition/core-download';
import { fullDownloadLabel, fullDownloadPlan, isImagePackModule } from './full-download';

const MIB = 1024 * 1024;

function entry(
  id: string,
  kind: ContentModuleCatalogEntry['kind'],
  downloadBytes: number | null,
  sourceAssetsDownloadBytes: number | null = null,
): ContentModuleCatalogEntry {
  return {
    id,
    kind,
    sizes: { downloadBytes, installedBytes: downloadBytes, sourceAssetsDownloadBytes },
    artifacts:
      sourceAssetsDownloadBytes === null
        ? [{ kind: 'index' }]
        : [{ kind: 'index' }, { kind: 'source-assets' }],
  } as unknown as ContentModuleCatalogEntry;
}

const catalog = {
  modules: [
    entry('minimed.core.ru', 'core', 76 * MIB),
    entry('kr.1', 'clinical', 10 * MIB),
    entry('kr.2', 'clinical', 20 * MIB),
    entry('med.a', 'medication', 100 * MIB),
    entry('tool.a', 'tool', 2 * MIB),
    entry('regulatory.a', 'regulatory', 5 * MIB),
    entry('kr.planned', 'clinical', 50 * MIB),
    entry('photos', 'reference', 281 * MIB, 280 * MIB),
  ],
} as unknown as ContentModuleCatalog;

const released = (module: ContentModuleCatalogEntry) => module.id !== 'kr.planned';
const base = {
  catalog,
  released,
  installed: () => false,
  coreInstalled: false,
  modelInstalled: false,
  modelBytes: 130 * MIB,
};

describe('image packs', () => {
  it('are the modules whose download is almost entirely source assets', () => {
    expect(isImagePackModule(entry('photos', 'reference', 281 * MIB, 280 * MIB))).toBe(true);
    expect(isImagePackModule(entry('kr', 'clinical', 10 * MIB))).toBe(false);
    // A text module that merely ships a few source files is not an image pack.
    expect(isImagePackModule(entry('mixed', 'reference', 100 * MIB, 20 * MIB))).toBe(false);
  });
});

describe('fullDownloadPlan', () => {
  it('takes every released content module and leaves out the core and the image packs', () => {
    const plan = fullDownloadPlan(base);
    expect(plan.modules.map((module) => module.id)).toEqual([
      'kr.1',
      'kr.2',
      'med.a',
      'tool.a',
      'regulatory.a',
    ]);
    expect(plan.imagePackBytes).toBe(281 * MIB);
  });

  it('adds the meaning-search model and the main database to the module bytes', () => {
    const plan = fullDownloadPlan(base);
    expect(plan.moduleBytes).toBe(137 * MIB);
    expect(plan.modelBytes).toBe(130 * MIB);
    expect(plan.coreBytes).toBe(ANDROID_CORE_DOWNLOAD.transferSizeBytes);
    expect(plan.totalBytes).toBe(137 * MIB + 130 * MIB + ANDROID_CORE_DOWNLOAD.transferSizeBytes);
  });

  it('counts only what is still missing', () => {
    const plan = fullDownloadPlan({
      ...base,
      installed: (module) => module.id === 'med.a',
      coreInstalled: true,
      modelInstalled: true,
    });
    expect(plan.pending.map((module) => module.id)).toEqual([
      'kr.1',
      'kr.2',
      'tool.a',
      'regulatory.a',
    ]);
    expect(plan.totalBytes).toBe(37 * MIB);
  });

  it('has no total while a module has no declared size', () => {
    const unknown = {
      modules: [...catalog.modules, entry('kr.x', 'clinical', null)],
    } as unknown as ContentModuleCatalog;
    expect(fullDownloadPlan({ ...base, catalog: unknown }).totalBytes).toBeNull();
  });

  it('includes a new downloadable module without special-casing it', () => {
    const withNew = {
      modules: [...catalog.modules, entry('regulatory.323', 'regulatory', 3 * MIB)],
    } as unknown as ContentModuleCatalog;
    expect(
      fullDownloadPlan({ ...base, catalog: withNew }).modules.map((module) => module.id),
    ).toContain('regulatory.323');
  });
});

describe('fullDownloadLabel', () => {
  it('shows the total with the existing size formatter', () => {
    const plan = fullDownloadPlan({ ...base, coreInstalled: true, modelInstalled: true });
    expect(fullDownloadLabel(plan, false)).toBe('Скачать всё · 137 МБ');
  });

  it('says what is going on instead of the size', () => {
    const plan = fullDownloadPlan(base);
    expect(fullDownloadLabel(undefined, false)).toBe('Считаем размер…');
    expect(fullDownloadLabel(plan, true)).toBe('Скачиваем…');
    const done = fullDownloadPlan({
      ...base,
      installed: () => true,
      coreInstalled: true,
      modelInstalled: true,
    });
    expect(fullDownloadLabel(done, false)).toBe('Всё скачано');
  });
});
