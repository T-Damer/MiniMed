import type { MedicalDocumentSummary } from '@localmed/contracts';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { specialtyLabel } from '@/i18n/labels';

const medicationModules = MODULE_CATALOG.modules.filter((module) => module.kind === 'medication');
const modulesByDocument = new Map<string, string[]>();
for (const module of medicationModules) {
  for (const document of module.documents) {
    const ids = modulesByDocument.get(document.documentId) ?? [];
    ids.push(`module:${module.id}`);
    modulesByDocument.set(document.documentId, ids);
  }
}

/** Only source classifications and exact manifest membership; never infer indications from names. */
export function medicationDocumentGroups(document: MedicalDocumentSummary): readonly string[] {
  const target = document.metadata?.['targetDocumentId'];
  const pharmacology = document.metadata?.['pharmacotherapeuticGroups'];
  return [
    ...new Set([
      ...(modulesByDocument.get(typeof target === 'string' ? target : document.id) ?? []),
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
    return `АТХ: ${medicationModules.find((module) => module.id === id.slice(7))?.title ?? id.slice(7)}`;
  return specialtyLabel(id);
}
