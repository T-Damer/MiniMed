import {
  PersistentInstalledModuleRegistry,
  WebStorageInstalledModuleRegistryPersistence,
} from '@localmed/storage';

import { RELEASE_VERSION } from '../../../../release';

/**
 * The data version of a search: everything the result of a query depends on besides its text.
 * Saved results (`search-result-cache.ts`) are keyed by it, so a copy made before an install, a
 * removal, a core update or a change of the semantic model is never shown again.
 *
 * `app:<build>|core:<version>|modules:<count>.<digest>|semantic:<on|off>`
 *
 * - The module part is read from the installed-module registry when a core is built, and published
 *   with that core ({@link publishCoreDataVersion}): a registry that changed but whose core has not
 *   been swapped yet must not label results the old core produced.
 * - The semantic part is live: the query model is looked up at search time, not at core build.
 */

const CORE_MODULE_ID = 'minimed.core.ru';

export interface InstalledModuleVersion {
  readonly moduleId: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly state: string;
  readonly activeSourceSetDigest: string | null;
}

/** 53-bit string hash (cyrb53): a short stable digest, not a security measure. */
function digest(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** The core's version and a digest of every installed module with its version and state. */
export function installedDataVersion(modules: readonly InstalledModuleVersion[]): string {
  const core = modules.find((module) => module.moduleId === CORE_MODULE_ID);
  const rest = modules
    .filter((module) => module.moduleId !== CORE_MODULE_ID)
    .map(
      (module) =>
        `${module.moduleId}@${module.version}:${module.state}:${module.enabled ? 1 : 0}:${module.activeSourceSetDigest ?? ''}`,
    )
    .toSorted();
  const coreVersion = core ? `${core.version}:${core.activeSourceSetDigest ?? ''}` : 'none';
  return `core:${coreVersion}|modules:${rest.length}.${digest(rest.join('\n'))}`;
}

let unreadableReads = 0;

/** The installed set as the registry (localStorage) holds it right now. */
export function readInstalledDataVersion(): string {
  try {
    const registry = new PersistentInstalledModuleRegistry(
      new WebStorageInstalledModuleRegistryPersistence(window.localStorage),
    );
    return installedDataVersion(registry.list());
  } catch (cause) {
    console.warn('The installed-module registry could not be read for the search cache.', cause);
    // Unique per read: nothing saved under it is ever found again, which is the safe direction.
    unreadableReads += 1;
    return `unreadable:${Date.now()}.${unreadableReads}`;
  }
}

let coreDataVersion: string | undefined;

/** The installed-set version of the core the search now runs on; set when a core is published. */
export function publishCoreDataVersion(version: string): void {
  coreDataVersion = version;
}

let semanticState: Promise<boolean> | undefined;

/** The query model was installed or removed. */
export function invalidateSemanticState(): void {
  semanticState = undefined;
}

function semanticModelInstalled(): Promise<boolean> {
  semanticState ??= import('@/features/semantic/e5-model-cache')
    .then((cache) => cache.isE5ModelInstalled())
    .catch((cause: unknown) => {
      console.warn('The semantic model state could not be read for the search cache.', cause);
      // Not cached: the next search asks again.
      semanticState = undefined;
      return false;
    });
  return semanticState;
}

/** The data version a search started now would run against. */
export async function searchDataVersion(): Promise<string> {
  const installed = coreDataVersion ?? readInstalledDataVersion();
  const semantic = (await semanticModelInstalled()) ? 'on' : 'off';
  return `app:${RELEASE_VERSION}|${installed}|semantic:${semantic}`;
}
