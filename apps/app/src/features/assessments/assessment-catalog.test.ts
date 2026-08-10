import { describe, expect, it } from 'vitest';

import {
  ASSESSMENT_CATALOG,
  loadAssessmentDefinition,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';

const CATALOG_SIZE = 9;
// Clinical scoring instruments (Apgar, EPDS, Ferriman-Gallwey, Whooley) are much shorter than the
// project's original Likert-style personality batteries, so the question-count floor only applies
// to the latter.
const LIKERT_BATTERY_SLUGS = new Set([
  'braverman-behavioral-profile',
  'personal-egogram',
  'paei-work-style',
  'team-role-profile',
  'temperament-profile',
]);

describe('assessment catalog', () => {
  it('contains lightweight, uniquely identified catalog entries', () => {
    expect(ASSESSMENT_CATALOG).toHaveLength(CATALOG_SIZE);
    expect(new Set(ASSESSMENT_CATALOG.map((item) => item.id)).size).toBe(CATALOG_SIZE);
    expect(new Set(ASSESSMENT_CATALOG.map((item) => item.slug)).size).toBe(CATALOG_SIZE);
    expect(ASSESSMENT_CATALOG.every((item) => item.aliases.length > 0)).toBe(true);
  });

  it('loads complete definitions lazily and validates their identifiers', async () => {
    const definitions = await Promise.all(
      ASSESSMENT_CATALOG.map((entry) => loadAssessmentDefinition(entry.id)),
    );

    for (const assessment of definitions) {
      const scaleIds = new Set(assessment.scales.map((scale) => scale.id));
      if (LIKERT_BATTERY_SLUGS.has(assessment.slug)) {
        expect(assessment.questions.length).toBeGreaterThanOrEqual(20);
      } else {
        expect(assessment.questions.length).toBeGreaterThanOrEqual(2);
      }
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

  it('attributes established instruments without branding them as MiniMed inventions', async () => {
    const definitions = await Promise.all(
      ASSESSMENT_CATALOG.map((entry) => loadAssessmentDefinition(entry.id)),
    );
    const egogram = definitions.find((definition) => definition.slug === 'personal-egogram');
    expect(egogram?.description).not.toContain('Авторский');
    expect(egogram?.license.notice).not.toContain('Правовой статус:');
    expect(egogram?.license.notice).not.toContain('Авторская формулировка MiniMed');
    expect(
      definitions.every((definition) => definition.scales.every((scale) => scale.description)),
    ).toBe(true);
  });
});
