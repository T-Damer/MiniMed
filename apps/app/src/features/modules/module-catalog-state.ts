import type { ContentModuleCatalog } from '@localmed/contracts';
import { createSignal } from 'solid-js';

const [loadedCatalog, setLoadedCatalog] = createSignal<ContentModuleCatalog>();
let pending: Promise<ContentModuleCatalog> | undefined;

/**
 * The bundled release catalog (~10 MB with document membership and terminology) stays out of the
 * startup bundle. Module features load it on demand; reactive readers update once it arrives.
 */
export function loadModuleCatalog(): Promise<ContentModuleCatalog> {
  pending ??= import('@/features/modules/module-catalog').then(({ MODULE_CATALOG }) => {
    setLoadedCatalog(() => MODULE_CATALOG);
    return MODULE_CATALOG;
  });
  return pending;
}

/** Tracked accessor: `undefined` until {@link loadModuleCatalog} resolves. */
export const loadedModuleCatalog = loadedCatalog;
