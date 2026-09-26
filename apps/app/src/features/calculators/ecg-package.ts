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

export interface EcgComponentUpdate {
  readonly name: string;
  readonly installedVersion: string;
  readonly catalogVersion: string;
  readonly downloadBytes: number;
}

export type EcgPackageState = 'missing' | 'partial' | 'outdated' | 'installed';

export interface EcgPackageStatus {
  readonly state: EcgPackageState;
  /** Installed components whose checksum differs from the catalog; they keep working meanwhile. */
  readonly updates: readonly EcgComponentUpdate[];
}

interface InstalledComponent {
  readonly checksum: string;
  readonly version: string;
}

export function summarizeEcgPackage(
  components: readonly {
    readonly installed: InstalledComponent | null;
    readonly candidate: (typeof ECG_PACKAGE_COMPONENTS)[number] | undefined;
  }[],
): EcgPackageStatus {
  const updates: EcgComponentUpdate[] = [];
  let current = 0;
  let missing = 0;
  for (const { installed, candidate } of components) {
    if (!installed || !candidate) missing += 1;
    else if (installed.checksum === candidate.bundleSha256) current += 1;
    else
      updates.push({
        name: candidate.name,
        installedVersion: installed.version,
        catalogVersion: candidate.version,
        downloadBytes: candidate.downloadBytes,
      });
  }
  const state: EcgPackageState = updates.length
    ? 'outdated'
    : missing === 0
      ? 'installed'
      : current > 0
        ? 'partial'
        : 'missing';
  return { state, updates };
}

export function ecgPackageStatus(): EcgPackageStatus {
  return summarizeEcgPackage([
    { installed: readEcgModelDescriptor(), candidate: ECG_MODEL_CATALOG[0] },
    { installed: readEcgDiagnosticModelDescriptor(), candidate: ECG_DIAGNOSTIC_MODEL_CATALOG[0] },
  ]);
}

export function isEcgPackageInstalled(): boolean {
  return ecgPackageStatus().state === 'installed';
}

/** Human wording for one update: a same-version replacement is a corrected build, not a release. */
export function describeEcgComponentUpdate(update: EcgComponentUpdate): string {
  return update.installedVersion === update.catalogVersion
    ? `${update.name}: исправленная сборка ${update.catalogVersion}`
    : `${update.name}: ${update.installedVersion} → ${update.catalogVersion}`;
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
