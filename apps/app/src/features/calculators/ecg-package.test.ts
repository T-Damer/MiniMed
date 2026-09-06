import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/features/calculators/ecg-model', () => ({
  ECG_MODEL_CATALOG: [{ bundleSha256: 'digitizer', downloadBytes: 90 }],
  readEcgModelDescriptor: vi.fn(),
  installEcgModelFromCatalog: vi.fn(async (_candidate, options) => options.onProgress(90, 90)),
  removeEcgModel: vi.fn(),
}));
vi.mock('@/features/calculators/ecg-numeric-diagnostic', () => ({
  ECG_DIAGNOSTIC_MODEL_CATALOG: [{ bundleSha256: 'numeric', downloadBytes: 10 }],
  readEcgDiagnosticModelDescriptor: vi.fn(),
  installEcgDiagnosticModelFromCatalog: vi.fn(),
  removeEcgDiagnosticModel: vi.fn(),
}));

import {
  installEcgModelFromCatalog,
  readEcgModelDescriptor,
} from '@/features/calculators/ecg-model';
import { installEcgDiagnosticModelFromCatalog } from '@/features/calculators/ecg-numeric-diagnostic';
import { installEcgPackage } from '@/features/calculators/ecg-package';

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
