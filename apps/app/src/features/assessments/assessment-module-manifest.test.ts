import { describe, expect, it } from 'vitest';

import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
import { resolveDeclaredAssessmentDependencies } from '@/features/assessments/assessment-module-manifest';
import { assessmentIdsInSection } from '@/features/assessments/assessment-packs';

describe('declared questionnaire dependencies', () => {
  it('returns null when a module has no dependency declaration', () => {
    expect(
      resolveDeclaredAssessmentDependencies(['clinical', 'pediatrics'], ASSESSMENT_CATALOG),
    ).toBeNull();
  });

  it('combines exact questionnaire and section declarations deterministically', () => {
    const exactId = ASSESSMENT_CATALOG[0]?.id ?? '';
    const sectionIds = assessmentIdsInSection('team-role', ASSESSMENT_CATALOG);

    expect(
      resolveDeclaredAssessmentDependencies(
        [`assessment-section:team-role`, `assessment:${exactId}`, `assessment:${exactId}`],
        ASSESSMENT_CATALOG,
      ),
    ).toEqual([...new Set([exactId, ...sectionIds])].toSorted());
  });

  it('supports an explicit declaration that no questionnaires are required', () => {
    expect(
      resolveDeclaredAssessmentDependencies(['assessment-dependencies:none'], ASSESSMENT_CATALOG),
    ).toEqual([]);
  });

  it('rejects unknown questionnaire IDs and sections', () => {
    expect(() =>
      resolveDeclaredAssessmentDependencies(
        ['assessment:minimed.assessment.missing'],
        ASSESSMENT_CATALOG,
      ),
    ).toThrow('unknown questionnaire ID');
    expect(() =>
      resolveDeclaredAssessmentDependencies(['assessment-section:missing'], ASSESSMENT_CATALOG),
    ).toThrow('unknown questionnaire section');
  });

  it('rejects conflicting none and positive declarations', () => {
    const exactId = ASSESSMENT_CATALOG[0]?.id ?? '';
    expect(() =>
      resolveDeclaredAssessmentDependencies(
        ['assessment-dependencies:none', `assessment:${exactId}`],
        ASSESSMENT_CATALOG,
      ),
    ).toThrow('cannot be combined');
  });
});
