import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import { BRAVERMAN_ASSESSMENT } from '@/features/assessments/braverman-assessment';
import { EGOGRAM_ASSESSMENT } from '@/features/assessments/egogram-assessment';
import { PAEI_ASSESSMENT } from '@/features/assessments/paei-assessment';
import { TEAM_ROLES_ASSESSMENT } from '@/features/assessments/team-roles-assessment';
import { TEMPERAMENT_ASSESSMENT } from '@/features/assessments/temperament-assessment';

export const ASSESSMENT_CATALOG: readonly AssessmentDefinition[] = [
  BRAVERMAN_ASSESSMENT,
  EGOGRAM_ASSESSMENT,
  PAEI_ASSESSMENT,
  TEAM_ROLES_ASSESSMENT,
  TEMPERAMENT_ASSESSMENT,
];

export function findAssessmentById(id: string): AssessmentDefinition | undefined {
  return ASSESSMENT_CATALOG.find((assessment) => assessment.id === id);
}

export function findAssessmentBySlug(slug: string): AssessmentDefinition | undefined {
  return ASSESSMENT_CATALOG.find((assessment) => assessment.slug === slug);
}

function normalized(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

export function searchAssessments(query: string): readonly AssessmentDefinition[] {
  const needle = normalized(query);
  if (!needle) return ASSESSMENT_CATALOG;
  const tokens = needle.split(/\s+/u).filter((token) => token.length >= 2);
  return ASSESSMENT_CATALOG.filter((assessment) => {
    const haystack = normalized(
      [assessment.title, assessment.shortTitle, assessment.description, ...assessment.aliases].join(
        ' ',
      ),
    );
    return haystack.includes(needle) || tokens.every((token) => haystack.includes(token));
  });
}
