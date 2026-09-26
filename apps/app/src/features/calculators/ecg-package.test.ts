import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/calculators/ecg-model', () => ({
  ECG_MODEL_CATALOG: [
    { bundleSha256: 'digitizer', downloadBytes: 90, name: 'Оцифровщик', version: '2026.1' },
  ],
  readEcgModelDescriptor: vi.fn(),
  installEcgModelFromCatalog: vi.fn(async (_candidate, options) => options.onProgress(90, 90)),
  removeEcgModel: vi.fn(),
}));
vi.mock('@/features/calculators/ecg-numeric-diagnostic', () => ({
  ECG_DIAGNOSTIC_MODEL_CATALOG: [
    { bundleSha256: 'numeric', downloadBytes: 10, name: 'Числовая модель', version: '2026.2' },
  ],
  readEcgDiagnosticModelDescriptor: vi.fn(),
  installEcgDiagnosticModelFromCatalog: vi.fn(),
  removeEcgDiagnosticModel: vi.fn(),
}));

import {
  ECG_MODEL_CATALOG,
  installEcgModelFromCatalog,
  readEcgModelDescriptor,
} from '@/features/calculators/ecg-model';
import {
  ECG_DIAGNOSTIC_MODEL_CATALOG,
  installEcgDiagnosticModelFromCatalog,
} from '@/features/calculators/ecg-numeric-diagnostic';
import {
  describeEcgComponentUpdate,
  installEcgPackage,
  summarizeEcgPackage,
} from '@/features/calculators/ecg-package';

beforeEach(() => vi.clearAllMocks());

it('downloads both verified components with one action and resumes a partial installation', async () => {
  const signal = new AbortController().signal;
  const progress = vi.fn();
  vi.mocked(installEcgDiagnosticModelFromCatalog).mockRejectedValueOnce(new Error('HTTP 404'));
  await expect(installEcgPackage(signal, progress)).rejects.toThrow('HTTP 404');
  expect(progress).toHaveBeenCalledWith(0.9);
  vi.mocked(readEcgModelDescriptor).mockReturnValue({ checksum: 'digitizer' } as ReturnType<
    typeof readEcgModelDescriptor
  >);
  await installEcgPackage(signal, progress);
  expect(installEcgModelFromCatalog).toHaveBeenCalledTimes(1);
  expect(installEcgDiagnosticModelFromCatalog).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenLastCalledWith(1);
});

describe('ECG package status', () => {
  const digitizer = ECG_MODEL_CATALOG[0];
  const numeric = ECG_DIAGNOSTIC_MODEL_CATALOG[0];
  const current = (candidate: typeof digitizer) =>
    candidate ? { checksum: candidate.bundleSha256, version: candidate.version } : null;

  it('separates an outdated install from a partial download', () => {
    expect(
      summarizeEcgPackage([
        { installed: current(digitizer), candidate: digitizer },
        { installed: current(numeric), candidate: numeric },
      ]),
    ).toEqual({ state: 'installed', updates: [] });
    expect(
      summarizeEcgPackage([
        { installed: current(digitizer), candidate: digitizer },
        { installed: null, candidate: numeric },
      ]).state,
    ).toBe('partial');
    expect(
      summarizeEcgPackage([
        { installed: null, candidate: digitizer },
        { installed: null, candidate: numeric },
      ]).state,
    ).toBe('missing');
    const outdated = summarizeEcgPackage([
      { installed: { checksum: 'older', version: '2025.9' }, candidate: digitizer },
      { installed: null, candidate: numeric },
    ]);
    expect(outdated.state).toBe('outdated');
    expect(outdated.updates).toEqual([
      {
        name: 'Оцифровщик',
        installedVersion: '2025.9',
        catalogVersion: '2026.1',
        downloadBytes: 90,
      },
    ]);
  });

  it('words a same-version replacement as a corrected build', () => {
    const update = {
      name: 'Оцифровщик',
      installedVersion: '2026.1',
      catalogVersion: '2026.1',
      downloadBytes: 1,
    };
    expect(describeEcgComponentUpdate(update)).toBe('Оцифровщик: исправленная сборка 2026.1');
    expect(describeEcgComponentUpdate({ ...update, installedVersion: '2025.9' })).toBe(
      'Оцифровщик: 2025.9 → 2026.1',
    );
  });
});
