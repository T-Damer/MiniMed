import { describe, expect, it } from 'vitest';

import type {
  AssessmentDefinition,
  CompletedAssessmentRecord,
  ManualAssessmentRecord,
} from '@/features/assessments/assessment-types';
import type { StoredCalculationResult } from '@/features/calculators/clinical-calculations';
import {
  assessmentNoteCaption,
  calculatorNoteCaption,
  snapshotAssessmentForNote,
  snapshotCalculationForNote,
} from '@/features/notes/note-attached-results';
import type { CalculationRecord } from '@/state/calculation-history';

const definition: AssessmentDefinition = {
  id: 'assessment-demo',
  slug: 'demo-scale',
  title: 'Демо-опросник',
  shortTitle: 'Демо',
  aliases: [],
  bankId: 'psychiatry',
  bankLabel: 'Психиатрия',
  category: 'screening',
  description: 'Тестовый опросник',
  estimatedMinutes: 5,
  audience: 'adult',
  responseOptions: [{ value: 0, label: 'Нет' }],
  scales: [{ id: 'total', label: 'Сумма', shortLabel: 'Σ', description: '' }],
  questions: [{ id: 'q1', prompt: 'Вопрос 1', scaleId: 'total' }],
  disclaimer: 'Не является диагнозом.',
  evidenceNote: '',
  license: { kind: 'project-original', notice: 'MiniMed' },
};

const completedRecord: CompletedAssessmentRecord = {
  id: 'assessment-record-1',
  assessmentId: definition.id,
  subjectLabel: 'Пациент',
  createdAt: '2026-08-18T10:00:00.000Z',
  kind: 'completed',
  answers: { q1: 1 },
  result: {
    assessmentId: definition.id,
    completedAt: '2026-08-18T10:00:00.000Z',
    scores: [
      {
        scaleId: 'total',
        label: 'Сумма',
        shortLabel: 'Σ',
        rawScore: 4,
        minimumScore: 0,
        maximumScore: 10,
        percent: 40,
      },
    ],
    primaryScaleIds: ['total'],
    headline: 'Умеренный риск',
    summary: 'Рекомендуется наблюдение.',
    disclaimer: 'Не является диагнозом.',
  },
};

const manualRecord: ManualAssessmentRecord = {
  id: 'assessment-record-2',
  assessmentId: definition.id,
  subjectLabel: 'Пациент',
  createdAt: '2026-08-18T10:00:00.000Z',
  kind: 'manual',
  text: 'Балл 7 по внешнему бланку.',
};

function calculationRecord(result: StoredCalculationResult): CalculationRecord {
  return {
    id: 'calc-record-1',
    calculatorId: 'bsa',
    subjectLabel: 'Пациент',
    createdAt: '2026-08-18T10:00:00.000Z',
    inputSummary: 'Рост 170 см, масса 70 кг',
    result,
  };
}

describe('note attached result snapshots', () => {
  it('snapshots a completed assessment with scores and disclaimer', () => {
    const snapshot = snapshotAssessmentForNote(definition, completedRecord);
    expect(snapshot).toMatchObject({
      kind: 'assessment',
      recordId: completedRecord.id,
      title: definition.title,
      headline: 'Умеренный риск',
      summary: 'Рекомендуется наблюдение.',
      disclaimer: 'Не является диагнозом.',
      scores: [{ label: 'Сумма', rawScore: 4, maximumScore: 10, percent: 40 }],
    });
    expect(assessmentNoteCaption(definition, completedRecord)).toBe(
      'Демо-опросник — Умеренный риск',
    );
  });

  it('snapshots a manual assessment with manual text only', () => {
    const snapshot = snapshotAssessmentForNote(definition, manualRecord);
    expect(snapshot.headline).toBe('');
    expect(snapshot.manualText).toBe(manualRecord.text);
    expect(snapshot.scores).toEqual([]);
    expect(assessmentNoteCaption(definition, manualRecord)).toBe(definition.title);
  });

  it('snapshots numeric and text calculator outputs', () => {
    const numericRecord = calculationRecord({
      ok: true,
      calculatorId: 'bsa',
      formula: 'Дюбуа',
      trace: [],
      warnings: [],
      value: 1.82,
      unit: 'м²',
      displayPrecision: 2,
    });
    const numeric = snapshotCalculationForNote(numericRecord);
    expect(numeric.outputs).toEqual([{ label: 'Результат', display: '1,82 м²' }]);

    const textual = snapshotCalculationForNote(
      calculationRecord({
        ok: true,
        calculatorId: 'edd',
        formula: 'Негеле',
        trace: [],
        warnings: [{ code: 'demo', message: 'Проверьте дату УЗИ.' }],
        textValues: [{ label: 'ПДР', text: '5 февраля 2027 г.' }],
      }),
    );
    expect(textual.outputs).toEqual([{ label: 'ПДР', display: '5 февраля 2027 г.' }]);
    expect(textual.warnings).toEqual(['Проверьте дату УЗИ.']);
    expect(calculatorNoteCaption(numericRecord)).toBe('bsa');
  });
});
