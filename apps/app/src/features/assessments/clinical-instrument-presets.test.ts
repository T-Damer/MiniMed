import { afterEach, describe, expect, it, vi } from 'vitest';

import { scoreAssessment } from '@/features/assessments/assessment-engine';
import { printAssessmentRecord, printBlankAssessment } from '@/features/assessments/assessment-print';
import {
  assessmentQuestionInstructions,
  assessmentSourceNote,
} from '@/features/assessments/assessment-print-context';
import {
  CLINICAL_INSTRUMENT_PRESETS,
  createClinicalInstrumentQuestionnaire,
  searchClinicalInstrumentPresets,
} from '@/features/assessments/clinical-instrument-presets';
import { PrintManager } from '@/features/printing/print-manager';
import type { UserLibraryDocument } from '@/state/user-library';
import {
  parseUserQuestionnaire,
  type UserQuestionnaire,
  userQuestionnaireReadinessError,
  userQuestionnaireToAssessmentDefinition,
} from '@/state/user-questionnaires';

const STAMP = '2026-09-17T00:00:00.000Z';

function definitionFor(questionnaire: UserQuestionnaire) {
  // The conversion reads only file id/title; no personal store or patient vault is opened.
  const file = { id: 'source-form-test', title: questionnaire.title } as UserLibraryDocument;
  return userQuestionnaireToAssessmentDefinition({ file, questionnaire });
}

function answersAt(questionnaire: UserQuestionnaire, maximum: boolean): Record<string, number> {
  return Object.fromEntries(questionnaire.questions.map((question) => {
    const values = question.options.map((option) => option.weight ?? Number.NaN);
    return [question.id, maximum ? Math.max(...values) : Math.min(...values)];
  }));
}

afterEach(() => vi.restoreAllMocks());

describe('source-backed Russian forms use the existing local questionnaire engine', () => {
  for (const preset of CLINICAL_INSTRUMENT_PRESETS) {
    it(`${preset.id}: preserves wording, version, source, license and instructions`, () => {
      const form = createClinicalInstrumentQuestionnaire(preset.id, STAMP);
      expect(userQuestionnaireReadinessError(form)).toBeNull();
      expect(form.questions.map((question) => question.prompt)).toEqual(preset.questions);
      expect(form.questions[0]?.text).toContain(preset.instructions);
      expect(form.reference?.sourceUrl).toBe(preset.sourceUrl);
      expect(form.reference?.notice).toContain(preset.licenseUrl);
      expect(form.description).toContain(preset.edition);
      expect(parseUserQuestionnaire(JSON.parse(JSON.stringify(form)))).toEqual(form);
      expect(form.sample).toBeUndefined();
      const definition = definitionFor(form);
      expect(definition.bankId).toBe('mine');
      expect(definition.evaluation?.status).toBe('unavailable');
      expect(definition.observationMappings).toEqual([]);
    });

    it(`${preset.id}: scores both endpoints without inventing diagnostic verdicts`, () => {
      const form = createClinicalInstrumentQuestionnaire(preset.id, STAMP);
      const definition = definitionFor(form);
      const low = scoreAssessment(definition, answersAt(form, false), STAMP);
      const high = scoreAssessment(definition, answersAt(form, true), STAMP);
      if (!low.ok || !high.ok) throw new Error('Both complete endpoint cases must be accepted.');
      expect(low.value.scores[0]?.rawScore).toBe(0);
      const maxOption = Math.max(...preset.options.map((option) => option.weight));
      expect(high.value.scores[0]?.rawScore).toBe(preset.questions.length * maxOption);
      expect(high.value.evaluation?.status).toBe('unavailable');
      expect(high.value.evaluation?.verdict).toBeUndefined();
    });

    it(`${preset.id}: refuses missing and out-of-range answers`, () => {
      const form = createClinicalInstrumentQuestionnaire(preset.id, STAMP);
      const definition = definitionFor(form);
      const answers = answersAt(form, false);
      const first = form.questions[0];
      if (!first) throw new Error('Fixture has no first question.');
      delete answers[first.id];
      expect(scoreAssessment(definition, answers, STAMP).ok).toBe(false);
      answers[first.id] = 1000;
      expect(scoreAssessment(definition, answers, STAMP).ok).toBe(false);
    });
  }

  it('keeps WHO-5 direction and its raw-sum-to-index conversion', () => {
    const form = createClinicalInstrumentQuestionnaire('who-5-ru-1999-who-2024', STAMP);
    const answers = Object.fromEntries(form.questions.map((question, index) => [question.id, index + 1]));
    const result = scoreAssessment(definitionFor(form), answers, STAMP);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.scores[0]).toMatchObject({ rawScore: 15, maximumScore: 25, percent: 60 });
    expect(form.disclaimer).toContain('лучшее');
  });

  it('preserves the PHQ-9 item-nine safety note even for a low total', () => {
    const form = createClinicalInstrumentQuestionnaire('phq-9-ru-zolotareva-2023', STAMP);
    const answers = answersAt(form, false);
    const last = form.questions[8];
    if (!last) throw new Error('PHQ-9 must contain its ninth item.');
    answers[last.id] = 1;
    const result = scoreAssessment(definitionFor(form), answers, STAMP);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.scores[0]?.rawScore).toBe(1);
    expect(last.text).toContain('безопасность');
    expect(form.disclaimer).toContain('независимо от суммы');
    expect(result.value.evaluation?.verdict).toBeUndefined();
  });

  it('finds Cyrillic aliases and rejects unknown preset versions', () => {
    expect(searchClinicalInstrumentPresets('ГТР 7').map((item) => item.id)).toEqual(['gad-7-ru-zolotareva-2023']);
    expect(searchClinicalInstrumentPresets('ВОЗ-5').map((item) => item.id)).toEqual(['who-5-ru-1999-who-2024']);
    expect(searchClinicalInstrumentPresets('PHQ9').map((item) => item.id)).toEqual(['phq-9-ru-zolotareva-2023']);
    expect(searchClinicalInstrumentPresets('неизвестный-инструмент')).toEqual([]);
    expect(() => createClinicalInstrumentQuestionnaire('phq-9-unverified')).toThrow('Неизвестная версия');
  });

  it('creates independent copies without importing a patient or mutating source presets', () => {
    const before = JSON.stringify(CLINICAL_INSTRUMENT_PRESETS);
    const first = createClinicalInstrumentQuestionnaire('gad-7-ru-zolotareva-2023', STAMP);
    const second = createClinicalInstrumentQuestionnaire('gad-7-ru-zolotareva-2023', STAMP);
    expect(first).toEqual(second);
    expect(first.questions).not.toBe(second.questions);
    expect(JSON.stringify(CLINICAL_INSTRUMENT_PRESETS)).toBe(before);
    expect(Object.keys(first)).not.toContain('patientId');
  });

  it('prints source/version and recall instructions for blank and completed forms', () => {
    const form = createClinicalInstrumentQuestionnaire('gad-7-ru-zolotareva-2023', STAMP);
    const definition = definitionFor(form);
    const html = vi.spyOn(PrintManager, 'html').mockReturnValue(true);
    expect(assessmentQuestionInstructions(definition)).toContain('двух недель');
    expect(assessmentSourceNote(definition)).toContain('CC-BY-NC-4.0');
    expect(printBlankAssessment(definition)).toBe(true);
    const blank = html.mock.calls[0]?.[0];
    expect(blank).toContain(form.reference?.sourceUrl);
    expect(blank).toContain('двух недель');
    expect(blank).toContain('Редакция формы:');
    const answers = answersAt(form, false);
    const result = scoreAssessment(definition, answers, STAMP);
    if (!result.ok) throw new Error(result.error);
    expect(printAssessmentRecord(definition, {
      id: 'print-source-form',
      assessmentId: definition.id,
      subjectLabel: '',
      createdAt: STAMP,
      kind: 'completed',
      answers,
      result: result.value,
    }, '', true)).toBe(true);
    const completed = html.mock.calls[1]?.[0];
    expect(completed).toContain(form.reference?.sourceUrl);
    expect(completed).toContain('Источник формы:');
    expect(completed).toContain('Вопросы и ответы:');
  });
});
