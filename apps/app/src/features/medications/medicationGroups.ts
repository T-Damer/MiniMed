import type { ContentModuleCatalog, MedicalDocumentSummary } from '@localmed/contracts';
import { loadedModuleCatalog } from '@/features/modules/module-catalog-state';
import { specialtyLabel } from '@/i18n/labels';

interface MedicationModuleIndex {
  readonly catalog: ContentModuleCatalog | undefined;
  readonly modules: ContentModuleCatalog['modules'];
  readonly modulesByDocument: ReadonlyMap<string, readonly string[]>;
}

let cachedIndex: MedicationModuleIndex | undefined;

/** ATC module membership appears once the lazily loaded release catalog is available. */
function medicationModuleIndex(): MedicationModuleIndex {
  const catalog = loadedModuleCatalog();
  if (cachedIndex && cachedIndex.catalog === catalog) return cachedIndex;
  const modules = (catalog?.modules ?? []).filter((module) => module.kind === 'medication');
  const modulesByDocument = new Map<string, string[]>();
  for (const module of modules) {
    for (const document of module.documents) {
      const ids = modulesByDocument.get(document.documentId) ?? [];
      ids.push(`module:${module.id}`);
      modulesByDocument.set(document.documentId, ids);
    }
  }
  cachedIndex = { catalog, modules, modulesByDocument };
  return cachedIndex;
}

/** Only source classifications and exact manifest membership; never infer indications from names. */
export function medicationDocumentGroups(document: MedicalDocumentSummary): readonly string[] {
  const target = document.metadata?.['targetDocumentId'];
  const pharmacology = document.metadata?.['pharmacotherapeuticGroups'];
  return [
    ...new Set([
      ...(medicationModuleIndex().modulesByDocument.get(
        typeof target === 'string' ? target : document.id,
      ) ?? []),
      ...(Array.isArray(pharmacology)
        ? pharmacology.flatMap((value: unknown) =>
            typeof value === 'string' && value.trim() ? [`pharm:${value.trim()}`] : [],
          )
        : []),
      ...document.specialties.filter((id) => specialtyLabel(id) !== id),
    ]),
  ];
}

export function medicationGroupLabel(id: string): string {
  if (id.startsWith('pharm:')) return `Фармгруппа: ${id.slice(6)}`;
  if (id.startsWith('module:'))
    return `АТХ: ${medicationModuleIndex().modules.find((module) => module.id === id.slice(7))?.title ?? id.slice(7)}`;
  return specialtyLabel(id);
}
