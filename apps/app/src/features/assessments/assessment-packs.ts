import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export type AssessmentSectionId = AssessmentDefinition['category'];

export interface AssessmentSectionDefinition {
  readonly id: AssessmentSectionId;
  readonly title: string;
  readonly description: string;
}

export interface AssessmentSectionGroup {
  readonly section: AssessmentSectionDefinition;
  readonly assessments: readonly AssessmentDefinition[];
}

export const ASSESSMENT_PACKS_EVENT = 'minimed:assessment-packs-changed';
const STORAGE_KEY = 'minimed.assessment-packs.v1';

export const ASSESSMENT_SECTIONS: readonly AssessmentSectionDefinition[] = [
  {
    id: 'self-reflection',
    title: 'Самооценка и личностный профиль',
    description: 'Опросники для структурированной саморефлексии и описания личностного профиля.',
  },
  {
    id: 'work-style',
    title: 'Стиль работы и управления',
    description: 'Инструменты для разбора рабочего поведения, управления и принятия решений.',
  },
  {
    id: 'team-role',
    title: 'Командные роли',
    description: 'Опросники о распределении ролей и взаимодействии внутри команды.',
  },
  {
    id: 'temperament',
    title: 'Темперамент',
    description: 'Типологические опросники для описания устойчивых особенностей реагирования.',
  },
];

function allIds(definitions: readonly AssessmentDefinition[]): readonly string[] {
  return definitions.map((definition) => definition.id);
}

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function persist(ids: ReadonlySet<string>): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify([...ids].toSorted()));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ASSESSMENT_PACKS_EVENT));
}

export function loadInstalledAssessmentIds(
  definitions: readonly AssessmentDefinition[],
): ReadonlySet<string> {
  const availableIds = new Set(allIds(definitions));
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return availableIds;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return availableIds;
    return new Set(
      parsed.filter((value): value is string => typeof value === 'string' && availableIds.has(value)),
    );
  } catch {
    return availableIds;
  }
}

export function isAssessmentInstalled(
  definition: AssessmentDefinition,
  installedIds: ReadonlySet<string>,
): boolean {
  return installedIds.has(definition.id);
}

export function installAssessmentIds(
  ids: readonly string[],
  definitions: readonly AssessmentDefinition[],
): ReadonlySet<string> {
  const availableIds = new Set(allIds(definitions));
  const next = new Set(loadInstalledAssessmentIds(definitions));
  let changed = false;
  for (const id of ids) {
    if (!availableIds.has(id) || next.has(id)) continue;
    next.add(id);
    changed = true;
  }
  if (changed) persist(next);
  return next;
}

export function removeAssessmentIds(
  ids: readonly string[],
  definitions: readonly AssessmentDefinition[],
): ReadonlySet<string> {
  const next = new Set(loadInstalledAssessmentIds(definitions));
  let changed = false;
  for (const id of ids) {
    if (!next.delete(id)) continue;
    changed = true;
  }
  if (changed) persist(next);
  return next;
}

export function assessmentIdsInSection(
  sectionId: AssessmentSectionId,
  definitions: readonly AssessmentDefinition[],
): readonly string[] {
  return definitions
    .filter((definition) => definition.category === sectionId)
    .map((definition) => definition.id);
}

export function installAssessmentSection(
  sectionId: AssessmentSectionId,
  definitions: readonly AssessmentDefinition[],
): ReadonlySet<string> {
  return installAssessmentIds(assessmentIdsInSection(sectionId, definitions), definitions);
}

export function removeAssessmentSection(
  sectionId: AssessmentSectionId,
  definitions: readonly AssessmentDefinition[],
): ReadonlySet<string> {
  return removeAssessmentIds(assessmentIdsInSection(sectionId, definitions), definitions);
}

export function groupAssessmentsBySection(
  definitions: readonly AssessmentDefinition[],
): readonly AssessmentSectionGroup[] {
  return ASSESSMENT_SECTIONS.map((section) => ({
    section,
    assessments: definitions.filter((definition) => definition.category === section.id),
  })).filter((group) => group.assessments.length > 0);
}
