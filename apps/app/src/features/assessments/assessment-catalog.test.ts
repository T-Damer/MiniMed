import { describe, expect, it } from 'vitest';

import { ASSESSMENT_CATALOG, searchAssessments } from '@/features/assessments/assessment-catalog';

describe('assessment catalog', () => {
  it('contains five complete, uniquely identified assessments', () => {
    expect(ASSESSMENT_CATALOG).toHaveLength(5);
    expect(new Set(ASSESSMENT_CATALOG.map((item) => item.id)).size).toBe(5);
    expect(new Set(ASSESSMENT_CATALOG.map((item) => item.slug)).size).toBe(5);
    expect(ASSESSMENT_CATALOG.every((item) => item.questions.length >= 20)).toBe(true);
  });

  it('keeps question and scale identifiers valid inside each assessment', () => {
    for (const assessment of ASSESSMENT_CATALOG) {
      const scaleIds = new Set(assessment.scales.map((scale) => scale.id));
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
