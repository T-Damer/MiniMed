import { afterEach, describe, expect, it } from 'vitest';

import {
  ASSESSMENT_CATALOG,
  clearDownloadedAssessments,
  getAssessmentCatalog,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

const LIKERT_BATTERY_SLUGS = new Set([
  'braverman-behavioral-profile',
  'personal-egogram',
  'paei-work-style',
  'team-role-profile',
  'temperament-profile',
]);

function registerPsychologyAssessments(): void {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
}

afterEach(() => {
  clearDownloadedAssessments();
});

describe('assessment catalog', () => {
  it('starts empty and fills from downloaded tool modules', () => {
    expect(ASSESSMENT_CATALOG).toHaveLength(0);
    registerPsychologyAssessments();
    const catalog = getAssessmentCatalog();
    expect(catalog).toHaveLength(5);
    expect(new Set(catalog.map((item) => item.id)).size).toBe(5);
    expect(catalog.every((item) => item.aliases.length > 0)).toBe(true);
  });

  it('loads complete definitions from downloaded modules and validates identifiers', async () => {
    registerPsychologyAssessments();
    const catalog = getAssessmentCatalog();
    const definitions = await Promise.all(
      catalog.map((entry) => loadAssessmentDefinition(entry.id)),
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
    registerPsychologyAssessments();
    expect(searchAssessments('Белбин')[0]?.slug).toBe('team-role-profile');
    expect(searchAssessments('нейромедиаторный профиль')[0]?.slug).toBe(
      'braverman-behavioral-profile',
    );
    expect(searchAssessments('Родитель Взрослый Ребёнок')[0]?.slug).toBe('personal-egogram');
  });

  it('attributes established instruments without branding them as MiniMed inventions', async () => {
    registerPsychologyAssessments();
    const definitions = await Promise.all(
      getAssessmentCatalog().map((entry) => loadAssessmentDefinition(entry.id)),
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
