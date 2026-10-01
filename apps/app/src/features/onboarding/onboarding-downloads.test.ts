import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import {
  drugDownloadPlan,
  drugModules,
  formatDownloadSize,
  mriAttribution,
  parseMriManifest,
} from './onboarding-downloads';

function entry(
  id: string,
  kind: ContentModuleCatalogEntry['kind'],
  downloadBytes: number | null,
): ContentModuleCatalogEntry {
  return {
    id,
    kind,
    sizes: { downloadBytes, installedBytes: downloadBytes, precision: 'exact' },
  } as unknown as ContentModuleCatalogEntry;
}

const MIB = 1024 * 1024;
const catalog = {
  modules: [
    entry('a', 'medication', 100 * MIB),
    entry('b', 'medication', 50 * MIB),
    entry('c', 'clinical', 10 * MIB),
    entry('d', 'medication', null),
  ],
} as unknown as ContentModuleCatalog;

describe('drug download plan', () => {
  it('takes released medication packages only', () => {
    const modules = drugModules(catalog, (module) => module.id !== 'd');
    expect(modules.map((module) => module.id)).toEqual(['a', 'b']);
  });

  it('sums what is still to download', () => {
    const modules = drugModules(catalog, (module) => module.id !== 'd');
    const plan = drugDownloadPlan(modules, (module) => module.id === 'a');
    expect(plan.pending.map((module) => module.id)).toEqual(['b']);
    expect(plan.bytes).toBe(50 * MIB);
    expect(plan.complete).toBe(false);
  });

  it('does not guess a size when a package declares none', () => {
    const modules = drugModules(catalog, () => true);
    expect(drugDownloadPlan(modules, () => false).bytes).toBeNull();
  });

  it('is complete only when something exists and all of it is installed', () => {
    const modules = drugModules(catalog, (module) => module.id === 'a');
    expect(drugDownloadPlan(modules, () => true).complete).toBe(true);
    expect(drugDownloadPlan([], () => true).complete).toBe(false);
  });
});

describe('formatDownloadSize', () => {
  it('uses gigabytes and megabytes with a decimal comma', () => {
    expect(formatDownloadSize(1.94 * 1024 * MIB)).toBe('1,9 ГБ');
    expect(formatDownloadSize(286 * MIB)).toBe('286 МБ');
    expect(formatDownloadSize(4.8 * MIB)).toBe('4,8 МБ');
  });
});

describe('MRI manifest', () => {
  const manifest = {
    modality: 'MRI',
    region: 'head',
    sequence: 'T1-weighted',
    plane: 'axial',
    slices: ['slice-1.webp', 'slice-2.webp'],
    source: {
      title:
        'Balloon Analog Risk-taking Task (OpenNeuro ds000001 v1.0.0), sub-01/anat/sub-01_T1w.nii.gz',
      url: 'https://openneuro.org/datasets/ds000001/versions/1.0.0',
      author: 'Tom Schonberg, Christopher Trepel',
      license: 'CC0 1.0 (Public Domain Dedication)',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
  };

  it('accepts the shipped shape and rejects anything else', () => {
    expect(parseMriManifest(manifest)).toBeDefined();
    expect(parseMriManifest({ ...manifest, slices: [] })).toBeUndefined();
    expect(parseMriManifest({ ...manifest, slices: ['../x.png'] })).toBeUndefined();
    expect(parseMriManifest(null)).toBeUndefined();
  });

  it('builds a short attribution line', () => {
    const parsed = parseMriManifest(manifest);
    if (!parsed) throw new Error('manifest rejected');
    expect(mriAttribution(parsed)).toBe(
      'Balloon Analog Risk-taking Task · OpenNeuro ds000001 v1.0.0 · CC0 1.0 · Tom Schonberg и др.',
    );
  });
});
