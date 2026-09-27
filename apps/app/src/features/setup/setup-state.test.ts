import { ContentModuleCatalogEntrySchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import {
  coreAutoDownloadAllowed,
  downloadPercent,
  setupCoreFooterLabel,
  setupPackageGroups,
} from './setup-state';

function module(
  id: string,
  kind: 'core' | 'reference' | 'tool',
  required = false,
  releaseState = 'published',
) {
  return ContentModuleCatalogEntrySchema.parse({
    id,
    version: '1.0.0',
    kind,
    collection: 'test',
    title: id,
    description: 'Fixture',
    required,
    releaseState,
    compatibility: { minAppVersion: '0.6.39', schemaVersion: 2, coreCatalogVersion: '1' },
    sourceSetDigest: `sha256:${'a'.repeat(64)}`,
    sizes: {},
    capabilities: {
      search: true,
      fullText: true,
      structuredTables: false,
      images: false,
      originalPdf: false,
      structuredKnowledge: false,
      calculations: false,
    },
    artifacts: [
      {
        id: 'index',
        kind: 'index',
        required: true,
        url: 'https://example.invalid/fixture.db',
        sha256: `sha256:${'b'.repeat(64)}`,
        sizeBytes: 100,
        compression: 'none',
        sourceSetDigest: `sha256:${'a'.repeat(64)}`,
      },
    ],
  });
}
describe('package setup', () => {
  it('keeps the required core out of optional groups and never fabricates a missing group', () => {
    const groups = setupPackageGroups([
      module('core', 'core', true),
      module('dictionary', 'reference'),
      module('built-in', 'tool', false, 'bundled'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.modules.map((entry) => entry.id)).toEqual(['dictionary']);
  });
  it('lists experimental (preview) packages only while experimental modules are enabled', () => {
    const modules = [module('draft-dictionary', 'reference', false, 'preview')];
    expect(setupPackageGroups(modules, { experimental: false })).toEqual([]);
    expect(
      setupPackageGroups(modules, { experimental: true })[0]?.modules.map((entry) => entry.id),
    ).toEqual(['draft-dictionary']);
  });
  it('does not promote a planned package into a published download', () => {
    const groups = setupPackageGroups([module('later', 'reference', false, 'planned')]);
    expect(groups[0]?.modules[0]?.releaseState).toBe('planned');
  });
  it('uses indeterminate progress when total is not known', () => {
    expect(downloadPercent(20, null)).toBeUndefined();
    expect(downloadPercent(20, 0)).toBeUndefined();
    expect(downloadPercent(20, Number.NaN)).toBeUndefined();
    expect(downloadPercent(Number.NaN, 100)).toBeUndefined();
  });
  it('clamps finite progress without pretending verification equals download completion', () => {
    expect(downloadPercent(25, 100)).toBe(25);
    expect(downloadPercent(120, 100)).toBe(100);
    expect(downloadPercent(-20, 100)).toBe(0);
  });
});

describe('core auto-download policy', () => {
  it('starts on unknown, wifi and ethernet connections', () => {
    expect(coreAutoDownloadAllowed(undefined)).toBe(true);
    expect(coreAutoDownloadAllowed({ type: 'wifi' })).toBe(true);
    expect(coreAutoDownloadAllowed({ type: 'ethernet', saveData: false })).toBe(true);
  });

  it('waits for the user on cellular or data-saver connections', () => {
    expect(coreAutoDownloadAllowed({ type: 'cellular' })).toBe(false);
    expect(coreAutoDownloadAllowed({ type: 'wifi', saveData: true })).toBe(false);
  });
});

describe('setup core button', () => {
  it('shows a percentage only against a known total, then names the install stage', () => {
    expect(setupCoreFooterLabel({ downloading: false, progress: undefined })).toBe(
      'Готовим поиск…',
    );
    expect(
      setupCoreFooterLabel({
        downloading: true,
        progress: { loaded: 38_000_000, total: 76_000_000, phase: 'downloading' },
      }),
    ).toBe('Загружаем ядро · 50%');
    // Compressed in transit: the streamed bytes have no known total, so no false «100%».
    expect(
      setupCoreFooterLabel({
        downloading: true,
        progress: { loaded: 252_000_000, total: 0, phase: 'downloading' },
      }),
    ).toBe('Загружаем ядро…');
    expect(
      setupCoreFooterLabel({
        downloading: true,
        progress: { loaded: 252_000_000, total: 252_000_000, phase: 'installing' },
      }),
    ).toBe('Устанавливаем ядро…');
  });
});
