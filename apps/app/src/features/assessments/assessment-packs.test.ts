import { afterEach, describe, expect, it, vi } from 'vitest';

import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
import {
  assessmentIdsInSection,
  groupAssessmentsBySection,
  installAssessmentSection,
  loadInstalledAssessmentIds,
  removeAssessmentIds,
} from '@/features/assessments/assessment-packs';

function installStorage(): void {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
  vi.stubGlobal('window', { localStorage, dispatchEvent: vi.fn() });
}

afterEach(() => vi.unstubAllGlobals());

describe('questionnaire packs', () => {
  it('groups the catalog into named sections', () => {
    const groups = groupAssessmentsBySection(ASSESSMENT_CATALOG);

    expect(groups.flatMap((group) => group.assessments)).toHaveLength(ASSESSMENT_CATALOG.length);
    expect(groups.map((group) => group.section.id)).toEqual(
      expect.arrayContaining(['self-reflection', 'work-style', 'team-role', 'temperament']),
    );
  });

  it('removes one questionnaire and restores its section without touching other sections', () => {
    installStorage();
    const target = ASSESSMENT_CATALOG.find((definition) => definition.category === 'team-role');
    expect(target).toBeDefined();

    const afterRemove = removeAssessmentIds([target?.id ?? ''], ASSESSMENT_CATALOG);
    expect(afterRemove.has(target?.id ?? '')).toBe(false);

    const restored = installAssessmentSection('team-role', ASSESSMENT_CATALOG);
    expect(restored.has(target?.id ?? '')).toBe(true);
    expect(
      assessmentIdsInSection('work-style', ASSESSMENT_CATALOG).every((id) => restored.has(id)),
    ).toBe(true);
    expect(loadInstalledAssessmentIds(ASSESSMENT_CATALOG)).toEqual(restored);
  });
});
