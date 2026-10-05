import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';

import type { ClinicalGlyphName } from '@/components/ClinicalGlyph';
import { pluralRu } from '@/i18n/labels';
import type { SectionManifest } from './section-manifest-source';

/**
 * Sections for the «скачать по разделам» download: a clinical collection of the catalog, its
 * single-recommendation modules, and the drug packages its recommendations name. Pure: the
 * catalog, the manifest and the release test come in, a list of sections goes out.
 */

/** Section glyphs. Only a visual hint: an unknown collection falls back to a neutral glyph. */
const SECTION_GLYPHS: Readonly<Record<string, ClinicalGlyphName>> = {
  'minimed.clinical.cardiology-vascular.ru': 'heart',
  'minimed.clinical.dentistry-maxillofacial.ru': 'overview',
  'minimed.clinical.dermatology.ru': 'overview',
  'minimed.clinical.emergency-critical.ru': 'alert',
  'minimed.clinical.endocrinology-metabolic.ru': 'flask',
  'minimed.clinical.ent.ru': 'airway',
  'minimed.clinical.gastro-hepatology.ru': 'stomach',
  'minimed.clinical.hematology-oncology.ru': 'flask',
  'minimed.clinical.infectious.ru': 'infection',
  'minimed.clinical.neonatology.ru': 'baby-carriage',
  'minimed.clinical.nephrology-urology.ru': 'kidney',
  'minimed.clinical.neurology-neurosurgery.ru': 'brain',
  'minimed.clinical.obstetrics-gynecology.ru': 'female',
  'minimed.clinical.ophthalmology.ru': 'eye',
  'minimed.clinical.pediatrics-general.ru': 'baby',
  'minimed.clinical.psychiatry-addiction.ru': 'brain',
  'minimed.clinical.rehabilitation-palliative.ru': 'route',
  'minimed.clinical.respiratory-allergy.ru': 'lungs',
  'minimed.clinical.rheumatology-immunology.ru': 'bone',
  'minimed.clinical.surgery-trauma.ru': 'bone',
};

export function sectionGlyph(sectionId: string): ClinicalGlyphName {
  return SECTION_GLYPHS[sectionId] ?? 'overview';
}

export interface SectionDrugGroup {
  readonly id: string;
  /** The group's name as the ЕСКЛП module of the catalog titles it. */
  readonly title: string;
  /** Distinct active substances (МНН) of the section's recommendations that fall in this group. */
  readonly medicationCount: number;
  /** The ЕСКЛП registry package and the ГРЛС instructions package, those that are released. */
  readonly modules: readonly ContentModuleCatalogEntry[];
}

export interface Section {
  /** The clinical collection id. */
  readonly id: string;
  readonly title: string;
  readonly clinical: readonly ContentModuleCatalogEntry[];
  readonly drugGroups: readonly SectionDrugGroup[];
  /** Recommendations of the section that name at least one drug. */
  readonly recommendationsWithDrugs: number;
}

export type ModuleRelease = (module: ContentModuleCatalogEntry) => boolean;

/** Sections that have at least one released recommendation module, sorted by title. */
export function buildSections(
  catalog: ContentModuleCatalog,
  manifest: SectionManifest,
  released: ModuleRelease,
): readonly Section[] {
  const moduleById = new Map(catalog.modules.map((module) => [module.id, module]));
  const groupById = new Map(manifest.drugGroups.map((group) => [group.id, group]));
  const manifestSection = new Map(
    manifest.sections.map((section) => [section.collection, section]),
  );
  const sections: Section[] = [];
  for (const category of catalog.categories) {
    const clinical = catalog.modules.filter(
      (module) =>
        module.kind === 'clinical' && module.collection === category.id && released(module),
    );
    if (clinical.length === 0) continue;
    const described = manifestSection.get(category.id);
    const drugGroups: SectionDrugGroup[] = [];
    for (const drug of described?.drugs ?? []) {
      const group = groupById.get(drug.groupId);
      const esklp = group ? moduleById.get(group.esklpModuleId) : undefined;
      if (!group || !esklp) continue;
      const instruction = group.instructionModuleId
        ? moduleById.get(group.instructionModuleId)
        : undefined;
      const modules = [esklp, ...(instruction ? [instruction] : [])].filter(released);
      if (modules.length === 0) continue;
      drugGroups.push({
        id: group.id,
        title: esklp.title,
        medicationCount: drug.medicationCount,
        modules,
      });
    }
    // The biggest groups first: they are what the section's recommendations name most.
    drugGroups.sort((a, b) => b.medicationCount - a.medicationCount || a.id.localeCompare(b.id));
    sections.push({
      id: category.id,
      title: category.title,
      clinical,
      drugGroups,
      recommendationsWithDrugs: described?.recommendationsWithDrugs ?? 0,
    });
  }
  return sections.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

/** Which sections the user ticked and which drug groups of them were switched off. */
export interface SectionSelection {
  readonly sectionIds: ReadonlySet<string>;
  /** `skippedGroupKey(section, group)` of every drug group left out of a ticked section. */
  readonly skippedGroups: ReadonlySet<string>;
}

export function skippedGroupKey(sectionId: string, groupId: string): string {
  return `${sectionId}\u0000${groupId}`;
}

/** The drug groups of a section that its selection still includes. */
export function includedDrugGroups(
  section: Section,
  skipped: ReadonlySet<string>,
): readonly SectionDrugGroup[] {
  return section.drugGroups.filter((group) => !skipped.has(skippedGroupKey(section.id, group.id)));
}

/** The packages of one section under the selection's group switches, each once. */
export function sectionModules(
  section: Section,
  skipped: ReadonlySet<string>,
): readonly ContentModuleCatalogEntry[] {
  return uniqueModules([
    ...section.clinical,
    ...includedDrugGroups(section, skipped).flatMap((group) => group.modules),
  ]);
}

/** The packages of every ticked section; a drug group shared by two sections counts once. */
export function selectedModules(
  sections: readonly Section[],
  selection: SectionSelection,
): readonly ContentModuleCatalogEntry[] {
  return uniqueModules(
    sections
      .filter((section) => selection.sectionIds.has(section.id))
      .flatMap((section) => sectionModules(section, selection.skippedGroups)),
  );
}

function uniqueModules(
  modules: readonly ContentModuleCatalogEntry[],
): readonly ContentModuleCatalogEntry[] {
  const seen = new Map<string, ContentModuleCatalogEntry>();
  for (const module of modules) if (!seen.has(module.id)) seen.set(module.id, module);
  return [...seen.values()];
}

export type SectionInstallState = 'none' | 'partial' | 'complete';

export function installState(
  modules: readonly ContentModuleCatalogEntry[],
  installed: (module: ContentModuleCatalogEntry) => boolean,
): SectionInstallState {
  const done = modules.filter(installed).length;
  if (modules.length > 0 && done === modules.length) return 'complete';
  return done > 0 ? 'partial' : 'none';
}

const RECOMMENDATION_FORMS = [
  'клиническая рекомендация',
  'клинические рекомендации',
  'клинических рекомендаций',
] as const;
const GROUP_FORMS = ['группа', 'группы', 'групп'] as const;
const SUBSTANCE_FORMS = ['вещество', 'вещества', 'веществ'] as const;

export function recommendationsLabel(count: number): string {
  return `${count} ${pluralRu(count, ...RECOMMENDATION_FORMS)}`;
}

export function drugGroupsLabel(count: number): string {
  return `${count} ${pluralRu(count, ...GROUP_FORMS)}`;
}

export function substancesLabel(count: number): string {
  return `${count} ${pluralRu(count, ...SUBSTANCE_FORMS)}`;
}

/**
 * «35 клинических рекомендаций · препараты: 3 группы» — what the section holds, with the groups
 * the selection keeps; the size is added by the caller because it depends on what is installed.
 */
export function sectionContentsLabel(section: Section, skipped: ReadonlySet<string>): string {
  const groups = includedDrugGroups(section, skipped).length;
  return [
    recommendationsLabel(section.clinical.length),
    groups > 0 ? `препараты: ${drugGroupsLabel(groups)}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}
