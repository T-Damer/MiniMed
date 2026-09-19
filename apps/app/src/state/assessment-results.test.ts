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
  createExternalAssessmentRecord,
  latestIncompleteAssessmentRecord,
  loadAssessmentRecords,
  removeAssessmentRecord,
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

  it('picks the newest incomplete draft for an assessment', () => {
    const older = saveIncompleteAssessmentRecord({
      assessmentId: 'personal-egogram',
      subjectLabel: 'Старый черновик',
      answers: { q1: 1 },
      totalQuestions: 10,
    });
    const newer = saveIncompleteAssessmentRecord({
      assessmentId: 'personal-egogram',
      subjectLabel: 'Новый черновик',
      answers: { q1: 2 },
      totalQuestions: 10,
    });
    saveIncompleteAssessmentRecord({
      assessmentId: 'other-assessment',
      subjectLabel: 'Другой тест',
      answers: { q1: 0 },
      totalQuestions: 5,
    });

    const records = loadAssessmentRecords();
    expect(latestIncompleteAssessmentRecord(records, 'personal-egogram')?.id).toBe(newer.id);
    expect(latestIncompleteAssessmentRecord(records, 'personal-egogram')?.subjectLabel).toBe(
      'Новый черновик',
    );
    expect(latestIncompleteAssessmentRecord(records, 'other-assessment')?.subjectLabel).toBe(
      'Другой тест',
    );
    expect(latestIncompleteAssessmentRecord(records, 'missing-assessment')).toBeUndefined();
    expect(older.id).not.toBe(newer.id);
  });

  it('preserves signed weighted answers from a local questionnaire', () => {
    const draft = saveIncompleteAssessmentRecord({
      assessmentId: 'user-questionnaire:file-1',
      subjectLabel: '',
      answers: { mood: -1, energy: 10 },
      totalQuestions: 2,
    });

    expect(loadAssessmentRecords()).toEqual([draft]);
  });

  it('removes an ordinary draft when a questionnaire crosses into the patient vault', () => {
    const draft = saveIncompleteAssessmentRecord({
      assessmentId: 'personal-egogram',
      subjectLabel: 'До привязки',
      answers: { mood: 1 },
      totalQuestions: 2,
    });

    removeAssessmentRecord(draft.id);

    expect(loadAssessmentRecords()).toEqual([]);
    expect(JSON.parse(storage.get(ASSESSMENT_RESULTS_KEY) ?? 'null')).toEqual([]);
  });

  it('persists a structured external assessment result', () => {
    const record = createExternalAssessmentRecord({
      assessmentId: 'minimed.assessment.mmse',
      subjectLabel: 'Пациент',
      variantId: 'mmse',
      values: {
        total_score: 27,
        edition: 'Русский бланк',
        notes: 'Исследование выполнено очно.',
      },
      definitionVersion: '1.0.0',
    });

    expect(loadAssessmentRecords()).toEqual([record]);
    expect(record).toMatchObject({
      kind: 'external',
      assessmentId: 'minimed.assessment.mmse',
      variantId: 'mmse',
      values: { total_score: 27 },
      definitionVersion: '1.0.0',
    });
    expect(storage.has(ASSESSMENT_RESULTS_KEY)).toBe(true);
  });

  it('keeps patient-bound external results out of ordinary local storage', () => {
    const record = createExternalAssessmentRecord({
      id: 'patient-mmse',
      assessmentId: 'minimed.assessment.mmse',
      subjectLabel: 'Пациент',
      patientId: 'patient-1',
      episodeId: 'episode-1',
      variantId: 'mmse',
      values: { total_score: 27 },
      definitionVersion: '1.0.0',
      persist: false,
    });

    expect(record).toMatchObject({
      kind: 'external',
      patientId: 'patient-1',
      episodeId: 'episode-1',
      values: { total_score: 27 },
    });
    expect(storage.has(ASSESSMENT_RESULTS_KEY)).toBe(false);
    expect(loadAssessmentRecords()).toEqual([]);
  });

  it('ignores malformed external values loaded from storage', () => {
    storage.set(
      ASSESSMENT_RESULTS_KEY,
      JSON.stringify([
        {
          id: 'bad-external',
          assessmentId: 'minimed.assessment.mmse',
          subjectLabel: '',
          createdAt: '2026-09-18T00:00:00Z',
          kind: 'external',
          variantId: 'mmse',
          values: { total_score: Number.POSITIVE_INFINITY },
        },
      ]),
    );

    expect(loadAssessmentRecords()).toEqual([]);
  });


  it('rejects invalid external records before persistence', () => {
    expect(() =>
      createExternalAssessmentRecord({
        assessmentId: 'minimed.assessment.mmse',
        subjectLabel: '',
        variantId: '   ',
        values: { total_score: 27 },
      }),
    ).toThrow('External assessment variant is required.');

    expect(() =>
      createExternalAssessmentRecord({
        assessmentId: 'minimed.assessment.mmse',
        subjectLabel: '',
        variantId: 'mmse',
        values: { notes: 'x'.repeat(4_001) },
      }),
    ).toThrow('External assessment values are invalid.');

    expect(storage.has(ASSESSMENT_RESULTS_KEY)).toBe(false);
  });

});
