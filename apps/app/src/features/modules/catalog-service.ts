import {
  type ContentModuleCatalogCache,
  type ContentModuleCatalogCacheRecord,
  type LoadedContentModuleCatalog,
  loadContentModuleCatalog,
} from '@localmed/core';

import { MODULE_CATALOG, REMOTE_MODULE_CATALOG_URL } from './module-catalog';

const CACHE_KEY = 'minimed.content-module-catalog.preview.v1';

class BrowserContentModuleCatalogCache implements ContentModuleCatalogCache {
  public async read(): Promise<unknown | null> {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      window.localStorage.removeItem(CACHE_KEY);
      return null;
    }
  }

  public async write(record: ContentModuleCatalogCacheRecord): Promise<void> {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(record));
  }
}

export function refreshContentModuleCatalog(): Promise<LoadedContentModuleCatalog> {
  const configuredUrl = import.meta.env.VITE_MODULE_CATALOG_URL?.trim();
  return loadContentModuleCatalog({
    bundledCatalog: MODULE_CATALOG,
    remoteUrl: configuredUrl || REMOTE_MODULE_CATALOG_URL,
    cache: new BrowserContentModuleCatalogCache(),
  });
}
