import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  medicationDownloadDisabled,
  medicationDownloadIsLarge,
  medicationDownloadLabel,
} from '@/features/medications/medication-download-state';
import type { DrugDownloadState } from '@/features/medications/use-drug-download';
import { totalDownloadBytes } from '@/features/onboarding/onboarding-downloads';

const MIB = 1024 * 1024;

function entry(id: string, downloadBytes: number | null): ContentModuleCatalogEntry {
  return {
    id,
    kind: 'medication',
    sizes: { downloadBytes, installedBytes: downloadBytes, precision: 'exact' },
  } as unknown as ContentModuleCatalogEntry;
}

function state(overrides: Partial<DrugDownloadState> = {}): DrugDownloadState {
  const modules = [entry('a', 200 * MIB), entry('b', 86 * MIB)];
  return {
    modules,
    plan: { pending: modules, bytes: 286 * MIB, complete: false },
    totalBytes: 286 * MIB,
    progress: {
      publishedCount: 2,
      installedCount: 0,
      activeTaskCount: 0,
      installedFraction: 0,
      byteProgress: null,
    },
    ...overrides,
  };
}

const idle = { failed: false, problem: false, active: false } as const;

describe('medication download state', () => {
  it('sums declared sizes and gives null when one is missing', () => {
    expect(totalDownloadBytes([entry('a', 10), entry('b', 5)])).toBe(15);
    expect(totalDownloadBytes([entry('a', 10), entry('b', null)])).toBeNull();
  });

  it('labels the button with the whole download size in the module formatter', () => {
    expect(medicationDownloadLabel({ ...idle, state: state() })).toBe('Скачать препараты · 286 МБ');
    expect(medicationDownloadLabel({ ...idle, state: state({ totalBytes: null }) })).toBe(
      'Скачать препараты',
    );
    expect(medicationDownloadLabel({ ...idle, problem: true, state: state() })).toBe(
      'Повторить · 286 МБ',
    );
  });

  it('shows the shared progress while the modules download', () => {
    const progress = { ...state().progress, activeTaskCount: 2, byteProgress: 0.426 };
    expect(medicationDownloadLabel({ ...idle, active: true, state: state({ progress }) })).toBe(
      'Скачиваем препараты · 42 %',
    );
    expect(medicationDownloadLabel({ ...idle, active: true, state: state() })).toBe(
      'Скачиваем препараты…',
    );
  });

  it('says why nothing can be downloaded', () => {
    expect(medicationDownloadLabel({ ...idle, state: undefined })).toBe('Считаем размер…');
    expect(medicationDownloadLabel({ ...idle, failed: true, state: undefined })).toBe(
      'Список пакетов не загрузился',
    );
    expect(medicationDownloadLabel({ ...idle, state: state({ modules: [] }) })).toBe(
      'Пока недоступно',
    );
  });

  it('disables the button without packages, while downloading and when all are installed', () => {
    expect(medicationDownloadDisabled({ active: false, state: state() })).toBe(false);
    expect(medicationDownloadDisabled({ active: true, state: state() })).toBe(true);
    expect(medicationDownloadDisabled({ active: false, state: undefined })).toBe(true);
    expect(medicationDownloadDisabled({ active: false, state: state({ modules: [] }) })).toBe(true);
    const complete = state({ plan: { pending: [], bytes: 0, complete: true } });
    expect(medicationDownloadDisabled({ active: false, state: complete })).toBe(true);
  });

  it('flags a download over 500 MB for the Wi-Fi hint', () => {
    expect(medicationDownloadIsLarge(state())).toBe(false);
    expect(
      medicationDownloadIsLarge(
        state({ plan: { pending: [], bytes: 600 * MIB, complete: false } }),
      ),
    ).toBe(true);
  });
});
