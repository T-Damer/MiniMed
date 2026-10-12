import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import {
  describeModuleImportFailure,
  ModuleFileImportError,
  openModuleBundle,
} from '@/features/modules/module-file-import';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';

export interface ModuleFileInstallProgress {
  readonly title: string;
  readonly state: ContentModuleDownloadTask['state'];
  /** 0-1, or null while the size is not known. */
  readonly fraction: number | null;
}

/**
 * Installs the module in a `.minimed-module.zip` the owner picked. Resolves with the installed
 * entry, rejects with {@link ModuleFileImportError} (short Russian message) when the file is not
 * acceptable or the installation fails; the caller reconnects the search core afterwards.
 */
export async function installModuleFromFile(
  file: File,
  onProgress: (progress: ModuleFileInstallProgress) => void,
): Promise<ContentModuleCatalogEntry> {
  const bundle = await openModuleBundle(file, file.name);
  const runtime = peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
  const task = runtime.installFromBundle(bundle);
  const title = bundle.entry.title;
  const report = (next: ContentModuleDownloadTask): void => {
    onProgress({
      title,
      state: next.state,
      fraction: next.totalBytes ? Math.min(1, next.downloadedBytes / next.totalBytes) : null,
    });
  };
  const unsubscribe = runtime.subscribe((next) => {
    if (next.id === task.id) report(next);
  });
  try {
    report(task);
    const finished = await runtime.wait(task.id);
    if (finished.state === 'failed') {
      throw new ModuleFileImportError(describeModuleImportFailure(finished.errorMessage));
    }
    if (finished.state === 'cancelled') throw new ModuleFileImportError('Установка отменена.');
    return bundle.entry;
  } finally {
    unsubscribe();
  }
}
