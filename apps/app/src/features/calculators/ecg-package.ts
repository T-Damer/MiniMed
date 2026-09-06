import {
  ECG_MODEL_CATALOG,
  installEcgModelFromCatalog,
  readEcgModelDescriptor,
  removeEcgModel,
} from '@/features/calculators/ecg-model';
import {
  ECG_DIAGNOSTIC_MODEL_CATALOG,
  installEcgDiagnosticModelFromCatalog,
  readEcgDiagnosticModelDescriptor,
  removeEcgDiagnosticModel,
} from '@/features/calculators/ecg-numeric-diagnostic';

export const ECG_PACKAGE_COMPONENTS = [...ECG_MODEL_CATALOG, ...ECG_DIAGNOSTIC_MODEL_CATALOG];

export function isEcgPackageInstalled(): boolean {
  return (
    readEcgModelDescriptor()?.checksum === ECG_MODEL_CATALOG[0]?.bundleSha256 &&
    readEcgDiagnosticModelDescriptor()?.checksum === ECG_DIAGNOSTIC_MODEL_CATALOG[0]?.bundleSha256
  );
}

export async function installEcgPackage(
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const components = [
    {
      candidate: ECG_MODEL_CATALOG[0],
      read: readEcgModelDescriptor,
      install: installEcgModelFromCatalog,
    },
    {
      candidate: ECG_DIAGNOSTIC_MODEL_CATALOG[0],
      read: readEcgDiagnosticModelDescriptor,
      install: installEcgDiagnosticModelFromCatalog,
    },
  ];
  const total = ECG_PACKAGE_COMPONENTS.reduce((sum, item) => sum + item.downloadBytes, 0);
  let completed = 0;
  for (const { candidate, read, install } of components) {
    signal.throwIfAborted();
    if (!candidate) throw new Error('Пакет распознавания ЭКГ отсутствует в каталоге.');
    if (read()?.checksum !== candidate.bundleSha256) {
      await install(candidate, {
        signal,
        onProgress: (bytes) => onProgress(Math.min(1, (completed + bytes) / total)),
      });
    }
    completed += candidate.downloadBytes;
    onProgress(completed / total);
  }
}

export async function removeEcgPackage(): Promise<void> {
  await removeEcgModel();
  await removeEcgDiagnosticModel();
}
