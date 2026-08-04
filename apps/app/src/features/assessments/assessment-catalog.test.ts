import { describe, expect, it } from 'vitest';

import {
  ASSESSMENT_CATALOG,
  loadAssessmentDefinition,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';

describe('assessment catalog', () => {
  it('contains five lightweight, uniquely identified catalog entries', () => {
    expect(ASSESSMENT_CATALOG).toHaveLength(5);
    expect(new Set(ASSESSMENT_CATALOG.map((item) => item.id)).size).toBe(5);
    expect(new Set(ASSESSMENT_CATALOG.map((item) => item.slug)).size).toBe(5);
    expect(ASSESSMENT_CATALOG.every((item) => item.aliases.length > 0)).toBe(true);
  });

  it('loads complete definitions lazily and validates their identifiers', async () => {
    const definitions = await Promise.all(
      ASSESSMENT_CATALOG.map((entry) => loadAssessmentDefinition(entry.id)),
    );

    for (const assessment of definitions) {
      const scaleIds = new Set(assessment.scales.map((scale) => scale.id));
      expect(assessment.questions.length).toBeGreaterThanOrEqual(20);
      expect(new Set(assessment.questions.map((question) => question.id)).size).toBe(
        assessment.questions.length,
      );
      expect(assessment.questions.every((question) => scaleIds.has(question.scaleId))).toBe(true);
      expect(assessment.disclaimer.length).toBeGreaterThan(40);
      expect(assessment.license.notice.length).toBeGreaterThan(30);
    }
  });

  it('finds instruments by common names and aliases', () => {
    expect(searchAssessments('Белбин')[0]?.slug).toBe('team-role-profile');
    expect(searchAssessments('нейромедиаторный профиль')[0]?.slug).toBe(
      'braverman-behavioral-profile',
    );
    expect(searchAssessments('Родитель Взрослый Ребёнок')[0]?.slug).toBe('personal-egogram');
  });
});
