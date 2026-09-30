import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  CoreIdentityHit,
  InstalledContentModule,
} from '@localmed/contracts';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { catalogContainsIdentityDocumentTarget } from '@/features/modules/module-pointer-install';

export function coreIdentityModule(
  hit: CoreIdentityHit,
  catalog: ContentModuleCatalog,
  installed: readonly InstalledContentModule[],
): ContentModuleCatalogEntry | undefined {
  const target = hit.target;
  const module = catalog.modules.find(
    (entry) => entry.id === target.moduleId && entry.version === target.moduleVersion,
  );
  if (!module) return undefined;
  if (target.type === 'document') {
    return catalogContainsIdentityDocumentTarget(target, catalog, installed) ? module : undefined;
  }
  const ready = installed.some(
    (entry) =>
      entry.moduleId === module.id &&
      entry.version === module.version &&
      entry.enabled &&
      entry.activeSourceSetDigest === module.sourceSetDigest,
  );
  return (isModuleReleased(module) || ready) &&
    module.definitionReference?.editionId === target.editionId &&
    module.artifacts.some(
      (artifact) =>
        artifact.kind === 'index' && artifact.required && artifact.url && artifact.sha256,
    )
    ? module
    : undefined;
}
