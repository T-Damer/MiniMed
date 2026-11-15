import type { ContentModuleCatalog } from '@localmed/contracts';
import { createSignal } from 'solid-js';

const [loadedCatalog, setLoadedCatalog] = createSignal<ContentModuleCatalog>();
let pending: Promise<ContentModuleCatalog> | undefined;

/**
 * The bundled release catalog (~10 MB with document membership and terminology) stays out of the
 * startup bundle. Module features load it on demand; reactive readers update once it arrives.
 */
/** The next task: lets the browser draw and take input between two heavy steps. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function loadModuleCatalog(): Promise<ContentModuleCatalog> {
  // Three steps, each in a task of its own: parsing the catalog, the screens that react to it, and
  // whatever the caller builds from it (the module runtime). Chained in one task they held the
  // main thread for half a second at phone speed.
  pending ??= import('@/features/modules/module-catalog').then(async ({ MODULE_CATALOG }) => {
    await nextTask();
    setLoadedCatalog(() => MODULE_CATALOG);
    await nextTask();
    return MODULE_CATALOG;
  });
  return pending;
}

/** Tracked accessor: `undefined` until {@link loadModuleCatalog} resolves. */
export const loadedModuleCatalog = loadedCatalog;
