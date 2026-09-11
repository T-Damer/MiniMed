import type { MedicalDocumentSummary } from '@localmed/contracts';
import type { AppGlyphName } from '@/components/AppGlyph';
import {
  ASSESSMENT_SPECIALTIES,
  getAssessmentCatalog,
} from '@/features/assessments/assessment-catalog';
import {
  assessmentPath,
  userQuestionnaireNewPath,
} from '@/features/assessments/assessment-routing';
import { CALCULATOR_SECTIONS } from '@/features/calculators/calculator-packs';
import { getCalculatorRegistry } from '@/features/calculators/calculator-registry';
import {
  medicationDocumentGroups,
  medicationGroupLabel,
} from '@/features/medications/medicationGroups';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  documentMatchesConditionGroup,
  documentMatchesSearchScope,
  type SearchResultDocumentKind,
  type SearchScope,
  searchResultDocumentKind,
} from '@/features/search/ScopedMedicalCore';
import { specialtyLabel } from '@/i18n/labels';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

export const SEARCH_SECTIONS: readonly { id: SearchScope; label: string; icon: AppGlyphName }[] = [
  { id: 'all', label: 'Все источники', icon: 'books' },
  { id: 'conditions', label: 'МКБ, симптомы и состояния', icon: 'notes' },
  { id: 'guidelines', label: 'Клинические рекомендации', icon: 'book-open' },
  { id: 'medications', label: 'Препараты', icon: 'prescription' },
  { id: 'legal', label: 'Нормативные документы', icon: 'scales' },
  { id: 'assessments', label: 'Опросники', icon: 'list-checks' },
  { id: 'calculators', label: 'Калькуляторы', icon: 'calculator' },
  { id: 'diagnosis', label: 'Клинический разбор', icon: 'brain' },
];

export const CONDITION_GROUPS = [
  { id: 'kind:icd', label: 'Коды и рубрики МКБ' },
  { id: 'kind:symptom', label: 'Симптомы' },
  { id: 'kind:condition', label: 'Состояния' },
  { id: 'kind:syndrome', label: 'Синдромы' },
  { id: 'kind:disease', label: 'Заболевания' },
] as const;

export interface SearchCatalogTool {
  readonly id: string;
  readonly icon: AppGlyphName;
  readonly scope: 'assessments' | 'calculators';
  readonly title: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly group: string;
  readonly href: string;
}
export function searchCatalogTools(): readonly SearchCatalogTool[] {
  return [
    ...getAssessmentCatalog().map(
      (entry): SearchCatalogTool => ({
        id: entry.id,
        scope: 'assessments',
        icon: 'list-checks',
        title: entry.title,
        description: entry.description,
        aliases: entry.aliases,
        group: entry.bankId,
        href: assessmentPath(entry.bankId, entry.slug),
      }),
    ),
    ...getCalculatorRegistry().flatMap((entry): SearchCatalogTool[] =>
      entry.state === 'available'
        ? [
            {
              id: entry.id,
              scope: 'calculators',
              icon: 'calculator',
              title: entry.title,
              description: entry.summary,
              aliases: entry.aliases,
              group: entry.category,
              href: `#/calculators/${encodeURIComponent(entry.slug)}`,
            },
          ]
        : [],
    ),
  ];
}
export const CUSTOM_QUESTIONNAIRE: SearchCatalogTool = {
  id: 'create-custom-questionnaire',
  icon: 'plus',
  scope: 'assessments',
  title: 'Создать свой опросник',
  description: 'Составьте собственный опросник с вопросами и вариантами ответов.',
  aliases: ['создать свое', 'мой опросник', 'новый', 'конструктор'],
  group: '',
  href: userQuestionnaireNewPath(),
};
// The source catalog combines obstetrics and gynecology under one specialty.
export function unifiedSearchSpecialty(group: string): string {
  return group === 'obstetrics' ? 'gynecology' : group;
}

function toolGroupLabel(entry: SearchCatalogTool): string {
  const sections = entry.scope === 'assessments' ? ASSESSMENT_SPECIALTIES : CALCULATOR_SECTIONS;
  return (
    sections.find((section) => section.id === entry.group)?.title ?? specialtyLabel(entry.group)
  );
}

export function matchingCatalogTools(
  rows: readonly SearchCatalogTool[],
  scope: SearchScope,
  group: string | undefined,
  query: string,
): readonly SearchCatalogTool[] {
  const candidates =
    scope === 'assessments' || (scope === 'all' && query.trim())
      ? [CUSTOM_QUESTIONNAIRE, ...rows]
      : rows;
  return candidates.filter(
    (entry) =>
      (scope === 'all' || entry.scope === scope) &&
      (!group ||
        !entry.group ||
        (scope === 'all' ? unifiedSearchSpecialty(entry.group) : entry.group) === group) &&
      matchesFuzzyQuery(query, [
        entry.title,
        entry.description,
        ...entry.aliases,
        toolGroupLabel(entry),
      ]),
  );
}
export function searchGroupLabel(scope: SearchScope, id: string): string {
  if (scope === 'medications') return medicationGroupLabel(id);
  if (scope === 'conditions' && id.startsWith('kind:'))
    return CONDITION_GROUPS.find((group) => group.id === id)?.label ?? id;
  const labels =
    scope === 'assessments'
      ? ASSESSMENT_SPECIALTIES
      : scope === 'calculators'
        ? CALCULATOR_SECTIONS
        : scope === 'all'
          ? [...ASSESSMENT_SPECIALTIES, ...CALCULATOR_SECTIONS]
          : [];
  return scope === 'all' && specialtyLabel(id) !== id
    ? specialtyLabel(id)
    : (labels.find((entry) => entry.id === id)?.title ?? specialtyLabel(id));
}

export interface SearchCatalogSection {
  readonly id: SearchScope;
  readonly label: string;
  readonly icon: AppGlyphName;
  readonly count?: number;
  readonly groups: readonly {
    readonly id: string;
    readonly label: string;
    readonly count: number;
    readonly documentCount: number;
    readonly kinds: readonly SearchResultDocumentKind[];
  }[];
}
export function searchCatalogSections(
  documents: readonly MedicalDocumentSummary[],
  tools: readonly SearchCatalogTool[],
): readonly SearchCatalogSection[] {
  return SEARCH_SECTIONS.map((section) => {
    if (section.id === 'diagnosis') return { ...section, groups: [] };
    const toolScope = section.id === 'assessments' || section.id === 'calculators';
    const rows = tools.filter((entry) => section.id === 'all' || entry.scope === section.id);
    const docs = toolScope
      ? []
      : documents.filter((entry) => documentMatchesSearchScope(entry, section.id));
    const counts = new Map<string, number>();
    const documentCounts = new Map<string, number>();
    const kinds = new Map<string, Set<SearchResultDocumentKind>>();
    const add = (
      groups: readonly string[],
      kind: SearchResultDocumentKind,
      document: boolean,
    ): void => {
      for (const group of new Set(groups)) {
        counts.set(group, (counts.get(group) ?? 0) + 1);
        if (document) documentCounts.set(group, (documentCounts.get(group) ?? 0) + 1);
        const present = kinds.get(group) ?? new Set<SearchResultDocumentKind>();
        present.add(kind);
        kinds.set(group, present);
      }
    };
    for (const entry of docs)
      add(
        section.id === 'medications'
          ? medicationDocumentGroups(entry)
          : section.id === 'all'
            ? entry.specialties.map(unifiedSearchSpecialty)
            : entry.specialties,
        searchResultDocumentKind(entry),
        true,
      );
    if (section.id === 'medications') {
      for (const module of MODULE_CATALOG.modules) {
        if (module.kind !== 'medication' || !isModuleReleased(module)) continue;
        const id = `module:${module.id}`;
        counts.set(id, module.documents.length);
        documentCounts.set(id, module.documents.length);
        kinds.set(id, new Set(['medication']));
      }
    }
    for (const entry of rows)
      add(
        [section.id === 'all' ? unifiedSearchSpecialty(entry.group) : entry.group],
        entry.scope === 'assessments' ? 'assessment' : 'calculator',
        false,
      );
    return {
      ...section,
      count: rows.length + docs.length,
      groups:
        section.id === 'conditions'
          ? CONDITION_GROUPS.map((group) => {
              const count = docs.filter((document) =>
                documentMatchesConditionGroup(document, group.id),
              ).length;
              return { ...group, count, documentCount: count, kinds: ['reference'] as const };
            })
          : [...counts]
              .map(([id, count]) => ({
                id,
                count,
                documentCount: documentCounts.get(id) ?? 0,
                kinds: [...(kinds.get(id) ?? [])],
                label: searchGroupLabel(section.id, id),
              }))
              .toSorted((a, b) => a.label.localeCompare(b.label, 'ru')),
    };
  });
}
