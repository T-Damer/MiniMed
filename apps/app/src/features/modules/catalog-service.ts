import type { ContentModuleCatalog } from '@localmed/contracts';
import { type LoadedContentModuleCatalog, loadContentModuleCatalog } from '@localmed/core';
import {
  IndexedDbContentModuleCatalogCache,
  removeLegacyCatalogRecord,
} from '@/features/modules/catalog-cache';
import { createCatalogFetcher } from '@/features/modules/catalog-fetcher';
import {
  BASE_MODULE_CATALOG,
  MODULE_CATALOG,
  REMOTE_MODULE_CATALOG_URL,
  withBundledTerminology,
} from '@/features/modules/module-catalog';
import { coreAutoDownloadAllowed, currentNetworkConnection } from '@/features/setup/setup-state';
import { RELEASE_VERSION } from '../../../../../release';

let activeCatalog: ContentModuleCatalog = MODULE_CATALOG;
let inFlight: {
  readonly promise: Promise<LoadedContentModuleCatalog>;
  readonly mayDownload: boolean;
} | null = null;
let legacyRecordRemoved = false;

export function getActiveContentModuleCatalog(): ContentModuleCatalog {
  return activeCatalog;
}

function removeLegacyRecordOnce(): void {
  if (legacyRecordRemoved) return;
  legacyRecordRemoved = true;
  try {
    removeLegacyCatalogRecord(window.localStorage);
  } catch (cause) {
    console.warn('The retired module catalog record could not be removed.', cause);
  }
}

async function loadCatalog(allowFullDownload: boolean): Promise<LoadedContentModuleCatalog> {
  removeLegacyRecordOnce();
  const configuredUrl = (
    import.meta.env as { readonly VITE_MODULE_CATALOG_URL?: string }
  ).VITE_MODULE_CATALOG_URL?.trim();
  const loaded = await loadContentModuleCatalog({
    // Terminology is merged below; validating it again inside the loader only delays startup.
    bundledCatalog: BASE_MODULE_CATALOG,
    remoteUrl: configuredUrl || REMOTE_MODULE_CATALOG_URL,
    cache: new IndexedDbContentModuleCatalogCache(),
    appVersion: RELEASE_VERSION,
    fetcher: createCatalogFetcher(),
    // On a metered or data-saving connection the app refreshes by itself only with validators, so
    // an unchanged catalog costs a 304; a tap on «Обновить» is the user's consent to a download.
    allowFullDownload,
    onCacheFailure: (stage, cause) => {
      console.warn(
        `The module catalog cache could not be ${stage === 'read' ? 'read' : 'saved'}.`,
        cause,
      );
    },
  });
  activeCatalog = withBundledTerminology(loaded.catalog);
  return { ...loaded, catalog: activeCatalog };
}

/**
 * Resolves the newest of the bundled, cached and remote catalogs. A refresh already running is
 * shared, unless it was started by the app on a metered connection (it may skip the download) and
 * the user is now asking for the catalog: that call runs its own.
 */
export function refreshContentModuleCatalog(
  options: { readonly userInitiated?: boolean } = {},
): Promise<LoadedContentModuleCatalog> {
  const userInitiated = options.userInitiated ?? false;
  const mayDownload = userInitiated || coreAutoDownloadAllowed(currentNetworkConnection());
  if (inFlight && (inFlight.mayDownload || !mayDownload)) return inFlight.promise;
  const promise = loadCatalog(mayDownload).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { promise, mayDownload };
  return promise;
}
