import { describe, expect, it } from 'vitest';

import {
  getAssessmentCatalog,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { resolveDeclaredAssessmentDependencies } from '@/features/assessments/assessment-module-manifest';
import { assessmentIdsInSection } from '@/features/assessments/assessment-packs';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

function psychologyCatalog() {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
  return getAssessmentCatalog();
}

describe('declared questionnaire dependencies', () => {
  it('returns null when a module has no dependency declaration', () => {
    expect(
      resolveDeclaredAssessmentDependencies(['clinical', 'pediatrics'], psychologyCatalog()),
    ).toBeNull();
  });

  it('combines exact questionnaire and section declarations deterministically', () => {
    const catalog = psychologyCatalog();
    const exactId = catalog[0]?.id ?? '';
    const sectionIds = assessmentIdsInSection('team-role', catalog);

    expect(
      resolveDeclaredAssessmentDependencies(
        [`assessment-section:team-role`, `assessment:${exactId}`, `assessment:${exactId}`],
        catalog,
      ),
    ).toEqual([...new Set([exactId, ...sectionIds])].toSorted());
  });

  it('supports an explicit declaration that no questionnaires are required', () => {
    expect(
      resolveDeclaredAssessmentDependencies(['assessment-dependencies:none'], psychologyCatalog()),
    ).toEqual([]);
  });

  it('rejects unknown questionnaire IDs and sections', () => {
    const catalog = psychologyCatalog();
    expect(() =>
      resolveDeclaredAssessmentDependencies(['assessment:minimed.assessment.missing'], catalog),
    ).toThrow('unknown questionnaire ID');
    expect(() =>
      resolveDeclaredAssessmentDependencies(['assessment-section:missing'], catalog),
    ).toThrow('unknown questionnaire section');
  });

  it('rejects conflicting none and positive declarations', () => {
    const catalog = psychologyCatalog();
    const exactId = catalog[0]?.id ?? '';
    expect(() =>
      resolveDeclaredAssessmentDependencies(
        ['assessment-dependencies:none', `assessment:${exactId}`],
        catalog,
      ),
    ).toThrow('cannot be combined');
  });
});
