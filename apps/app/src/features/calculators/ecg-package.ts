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
import type { DownloadContext } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';

export const ECG_PACKAGE_COMPONENTS = [...ECG_MODEL_CATALOG, ...ECG_DIAGNOSTIC_MODEL_CATALOG];

export const ECG_DOWNLOAD_ID = 'ecg:recognition-package';
export const ECG_DOWNLOAD_VERSION = ECG_PACKAGE_COMPONENTS.map((item) => item.bundleSha256).join(
  ':',
);

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
  await getDownloadQueue().run(
    {
      id: ECG_DOWNLOAD_ID,
      kind: 'ecg',
      title: 'Распознавание ЭКГ',
      totalBytes: ECG_PACKAGE_COMPONENTS.reduce((sum, item) => sum + item.downloadBytes, 0),
      resume: { kind: 'ecg-package', id: ECG_DOWNLOAD_ID, version: ECG_DOWNLOAD_VERSION },
    },
    (context) => installComponents(context, onProgress),
    {
      signal,
      retry: () => installEcgPackage(new AbortController().signal, () => undefined),
    },
  );
  onProgress(1);
}

async function installComponents(
  context: DownloadContext,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const { signal } = context;
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
      context.phase('queued');
      await install(candidate, {
        signal,
        downloadContext: context,
        onProgress: (bytes) => {
          context.progress(completed + bytes, total);
          onProgress(Math.min(0.99, (completed + bytes) / total));
        },
      });
    }
    completed += candidate.downloadBytes;
    context.progress(completed, total);
    onProgress(Math.min(0.99, completed / total));
  }
}

export async function removeEcgPackage(): Promise<void> {
  await getDownloadQueue().cancel(ECG_DOWNLOAD_ID);
  await removeEcgModel();
  await removeEcgDiagnosticModel();
}
