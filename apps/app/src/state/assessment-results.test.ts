import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDownloadedAssessments,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { AssessmentAnswers } from '@/features/assessments/assessment-types';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';
import {
  ASSESSMENT_RESULTS_KEY,
  createCompletedAssessmentRecord,
  loadAssessmentRecords,
  saveIncompleteAssessmentRecord,
} from '@/state/assessment-results';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    dispatchEvent: vi.fn(),
  });
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

afterEach(() => {
  clearDownloadedAssessments();
});

describe('assessment result persistence', () => {
  it('restores an incomplete attempt and replaces it with the completed record', async () => {
    const definition = await loadAssessmentDefinition('personal-egogram');
    const draft = saveIncompleteAssessmentRecord({
      assessmentId: definition.id,
      subjectLabel: 'Тестовый пациент',
      answers: { [definition.questions[0]?.id ?? 'missing']: 0 },
      totalQuestions: definition.questions.length,
    });

    expect(loadAssessmentRecords()).toEqual([draft]);
    const answers = Object.fromEntries(
      definition.questions.map((question) => [question.id, 3]),
    ) as AssessmentAnswers;
    const scored = scoreAssessment(definition, answers);
    if (!scored.ok) throw new Error(scored.error);
    createCompletedAssessmentRecord({
      id: draft.id,
      assessmentId: definition.id,
      subjectLabel: draft.subjectLabel,
      answers,
      result: scored.value,
    });

    const records = loadAssessmentRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe('completed');
    expect(storage.has(ASSESSMENT_RESULTS_KEY)).toBe(true);
  });
});
