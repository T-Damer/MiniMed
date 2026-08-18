import { beforeAll, describe, expect, it } from 'vitest';

import { registerDownloadedAssessment } from '@/features/assessments/assessment-catalog';
import {
  assessmentCatalogCrumbs,
  assessmentHomePath,
  assessmentParentHash,
  assessmentPath,
  assessmentWorkspaceCrumbs,
  readAssessmentRoute,
  sectionPath,
  specialtyPath,
} from '@/features/assessments/assessment-routing';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

beforeAll(() => {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

describe('assessment routing', () => {
  it('reads specialty, section, and nested questionnaire hashes', () => {
    expect(readAssessmentRoute('#/assessments')).toEqual({ kind: 'index' });
    expect(readAssessmentRoute('#/assessments/psychology')).toEqual({
      kind: 'specialty',
      specialtyId: 'psychology',
    });
    expect(readAssessmentRoute('#/assessments/psychology/self-reflection')).toEqual({
      kind: 'section',
      specialtyId: 'psychology',
      sectionId: 'self-reflection',
    });
    expect(readAssessmentRoute('#/assessments/psychology/braverman-behavioral-profile')).toEqual({
      kind: 'assessment',
      specialtyId: 'psychology',
      slug: 'braverman-behavioral-profile',
    });
  });

  it('keeps legacy questionnaire hashes working', () => {
    expect(readAssessmentRoute('#/assessments/braverman-behavioral-profile')).toEqual({
      kind: 'assessment',
      specialtyId: 'psychology',
      slug: 'braverman-behavioral-profile',
    });
  });

  it('returns the owning section from a questionnaire', () => {
    expect(assessmentHomePath('braverman-behavioral-profile')).toBe(
      '#/assessments/psychology/self-reflection',
    );
    expect(assessmentParentHash('assessments/psychology/braverman-behavioral-profile')).toBe(
      '#/assessments/psychology/self-reflection',
    );
    expect(assessmentParentHash('assessments/psychology/self-reflection')).toBe(
      specialtyPath('psychology'),
    );
    expect(assessmentPath('psychology', 'braverman-behavioral-profile')).toBe(
      '#/assessments/psychology/braverman-behavioral-profile',
    );
    expect(sectionPath('psychology', 'self-reflection')).toBe(
      '#/assessments/psychology/self-reflection',
    );
  });

  it('builds catalog and questionnaire breadcrumbs', () => {
    expect(assessmentCatalogCrumbs('Психология и психодиагностика', 'psychology')).toEqual([
      { label: 'Тесты', href: '#/assessments' },
      { label: 'Психология и психодиагностика' },
    ]);
    expect(
      assessmentCatalogCrumbs(
        'Психология и психодиагностика',
        'psychology',
        'Самооценка и личностный профиль',
      ),
    ).toEqual([
      { label: 'Тесты', href: '#/assessments' },
      { label: 'Психология и психодиагностика', href: specialtyPath('psychology') },
      { label: 'Самооценка и личностный профиль' },
    ]);
    expect(
      assessmentWorkspaceCrumbs({
        title: 'Поведенческий профиль Бравермана',
        bankId: 'psychology',
        bankLabel: 'Психология и психодиагностика',
        category: 'self-reflection',
      }),
    ).toEqual([
      { label: 'Тесты', href: '#/assessments' },
      { label: 'Психология и психодиагностика', href: specialtyPath('psychology') },
      {
        label: 'Самооценка и личностный профиль',
        href: sectionPath('psychology', 'self-reflection'),
      },
      { label: 'Поведенческий профиль Бравермана' },
    ]);
  });
});
