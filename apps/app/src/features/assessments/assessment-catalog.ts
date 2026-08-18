import { AssessmentDefinitionSchema, type ToolDefinitionRecord } from '@localmed/contracts';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

export type AssessmentCategory = AssessmentDefinition['category'];

export type AssessmentCatalogEntry = Pick<
  AssessmentDefinition,
  | 'id'
  | 'slug'
  | 'title'
  | 'shortTitle'
  | 'aliases'
  | 'bankId'
  | 'bankLabel'
  | 'category'
  | 'description'
  | 'estimatedMinutes'
  | 'audience'
>;

export interface AssessmentSpecialty {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const ASSESSMENT_SPECIALTIES: readonly AssessmentSpecialty[] = [
  {
    id: 'psychology',
    title: 'Психология и психодиагностика',
    description: 'Опросники для саморефлексии, рабочего стиля и командных ролей.',
  },
  {
    id: 'psychiatry',
    title: 'Психиатрия',
    description: 'Скрининговые шкалы и опросники психиатрического профиля.',
  },
  {
    id: 'obstetrics',
    title: 'Акушерство и гинекология',
    description: 'Опросники и шкалы для акушерско-гинекологической практики.',
  },
  {
    id: 'pediatrics',
    title: 'Педиатрия',
    description: 'Возрастные шкалы развития и скрининговые опросники для детей.',
  },
  {
    id: 'gastroenterology',
    title: 'Гастроэнтерология',
    description: 'Опросники симптомов и качества жизни при заболеваниях ЖКТ.',
  },
  {
    id: 'neonatology',
    title: 'Неонатология',
    description: 'Шкалы наблюдения и оценки состояния новорождённых.',
  },
  {
    id: 'emergency',
    title: 'Неотложная помощь',
    description: 'Краткие шкалы для первичной оценки в неотложных состояниях.',
  },
];

export function findAssessmentSpecialty(id: string): AssessmentSpecialty | undefined {
  return ASSESSMENT_SPECIALTIES.find((specialty) => specialty.id === id);
}

export function assessmentsInSpecialty(
  specialtyId: string,
  definitions: readonly AssessmentCatalogEntry[],
): readonly AssessmentCatalogEntry[] {
  return definitions.filter((definition) => definition.bankId === specialtyId);
}

export function visibleAssessmentSpecialties(
  query: string,
  catalog: readonly AssessmentCatalogEntry[],
  matches: readonly AssessmentCatalogEntry[],
): readonly AssessmentSpecialty[] {
  const trimmed = query.trim();
  if (!trimmed) return ASSESSMENT_SPECIALTIES;
  return ASSESSMENT_SPECIALTIES.filter((specialty) => {
    const specialtyCatalog = assessmentsInSpecialty(specialty.id, catalog);
    if (specialtyCatalog.length === 0) return false;
    const specialtyMatches = assessmentsInSpecialty(specialty.id, matches);
    if (specialtyMatches.length > 0) return true;
    return matchesFuzzyQuery(trimmed, [specialty.title, specialty.description]);
  });
}

export const ASSESSMENT_CATALOG: readonly AssessmentCatalogEntry[] = [];

const definitionPromises = new Map<string, Promise<AssessmentDefinition>>();
const downloadedAssessments = new Map<string, AssessmentDefinition>();

export function clearDownloadedAssessments(): void {
  downloadedAssessments.clear();
  definitionPromises.clear();
}

export function getAssessmentCatalog(): readonly AssessmentCatalogEntry[] {
  return [...downloadedAssessments.values()].map((definition) => ({
    id: definition.id,
    slug: definition.slug,
    title: definition.title,
    shortTitle: definition.shortTitle,
    aliases: definition.aliases,
    bankId: definition.bankId,
    bankLabel: definition.bankLabel,
    category: definition.category,
    description: definition.description,
    estimatedMinutes: definition.estimatedMinutes,
    audience: definition.audience,
  }));
}

export function registerDownloadedAssessment(record: ToolDefinitionRecord): void {
  if (record.kind !== 'assessment') return;
  const parsed = AssessmentDefinitionSchema.parse(record.definition);
  if (parsed.id !== record.id) throw new Error(`Assessment payload does not match ${record.id}.`);
  const { interpretations, license, questions, ...rest } = parsed;
  const definition: AssessmentDefinition = {
    ...rest,
    license: {
      kind: license.kind,
      notice: license.notice,
      ...(license.sourceUrl ? { sourceUrl: license.sourceUrl } : {}),
    },
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      scaleId: question.scaleId,
      ...(question.reverse === true ? { reverse: true as const } : {}),
      ...(question.responseOptions ? { responseOptions: question.responseOptions } : {}),
    })),
    ...(interpretations
      ? {
          interpretations: interpretations.map((band) => ({
            minScore: band.minScore,
            maxScore: band.maxScore,
            headline: band.headline,
            message: band.message,
            ...(band.scaleId ? { scaleId: band.scaleId } : {}),
          })),
        }
      : {}),
    sourceLinks: record.sources,
  };
  downloadedAssessments.set(record.id, definition);
  definitionPromises.delete(record.id);
}

export function findAssessmentById(id: string): AssessmentCatalogEntry | undefined {
  return getAssessmentCatalog().find((assessment) => assessment.id === id);
}

export function findAssessmentBySlug(slug: string): AssessmentCatalogEntry | undefined {
  return getAssessmentCatalog().find((assessment) => assessment.slug === slug);
}

function normalized(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function validateLoadedDefinition(
  entry: AssessmentCatalogEntry,
  definition: AssessmentDefinition,
): AssessmentDefinition {
  if (
    definition.id !== entry.id ||
    definition.slug !== entry.slug ||
    definition.category !== entry.category
  ) {
    throw new Error(`Assessment payload does not match catalog entry: ${entry.id}.`);
  }
  return definition;
}

export function loadAssessmentDefinition(idOrSlug: string): Promise<AssessmentDefinition> {
  const entry = findAssessmentById(idOrSlug) ?? findAssessmentBySlug(idOrSlug);
  if (!entry) return Promise.reject(new Error(`Unknown assessment: ${idOrSlug}.`));
  const existing = definitionPromises.get(entry.id);
  if (existing) return existing;
  const downloaded = downloadedAssessments.get(entry.id);
  if (!downloaded) {
    return Promise.reject(new Error(`Assessment payload is unavailable: ${entry.id}.`));
  }
  const promise = Promise.resolve(validateLoadedDefinition(entry, downloaded));
  definitionPromises.set(entry.id, promise);
  return promise;
}

export async function preloadAssessmentDefinitions(ids: readonly string[]): Promise<void> {
  await Promise.all([...new Set(ids)].map((id) => loadAssessmentDefinition(id)));
}

export function searchAssessments(query: string): readonly AssessmentCatalogEntry[] {
  const needle = normalized(query);
  const catalog = getAssessmentCatalog();
  if (!needle) return catalog;
  const tokens = needle.split(/\s+/u).filter((token) => token.length >= 2);
  return catalog.filter((assessment) => {
    const haystack = normalized(
      [assessment.title, assessment.shortTitle, assessment.description, ...assessment.aliases].join(
        ' ',
      ),
    );
    return haystack.includes(needle) || tokens.every((token) => haystack.includes(token));
  });
}
