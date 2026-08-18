import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
import { calculationRecordOutputs } from '@/features/calculators/calculator-print';
import { findCalculator } from '@/features/calculators/calculator-registry';
import type { CalculationRecord } from '@/state/calculation-history';
import type {
  NoteAttachedAssessmentResult,
  NoteAttachedCalculatorResult,
} from '@/state/patient-notes';

export function snapshotAssessmentForNote(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
): NoteAttachedAssessmentResult {
  const base = {
    kind: 'assessment' as const,
    recordId: record.id,
    assessmentId: record.assessmentId,
    slug: definition.slug,
    specialtyId: definition.bankId,
    title: definition.title,
    headline: '',
    summary: '',
    scores: [] as NoteAttachedAssessmentResult['scores'],
  };

  if (record.kind === 'completed') {
    return {
      ...base,
      headline: record.result.headline,
      summary: record.result.summary,
      scores: record.result.scores.map((score) => ({
        label: score.label,
        rawScore: score.rawScore,
        maximumScore: score.maximumScore,
        percent: score.percent,
      })),
      disclaimer: record.result.disclaimer,
    };
  }

  if (record.kind === 'manual') {
    return {
      ...base,
      manualText: record.text,
    };
  }

  return {
    ...base,
    summary: `Черновик: заполнено ${Object.keys(record.answers).length} из ${record.totalQuestions}`,
  };
}

export function snapshotCalculationForNote(
  record: CalculationRecord,
): NoteAttachedCalculatorResult {
  const definition = findCalculator(record.calculatorId);
  const slug = definition?.state === 'available' ? definition.slug : record.calculatorId;
  return {
    kind: 'calculator',
    recordId: record.id,
    calculatorId: record.calculatorId,
    slug,
    title: definition?.title ?? record.calculatorId,
    inputSummary: record.inputSummary,
    outputs: calculationRecordOutputs(record),
    warnings: record.result.warnings.map((warning) => warning.message),
  };
}

export function assessmentNoteCaption(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
): string {
  if (record.kind === 'completed' && record.result.headline.trim()) {
    return `${definition.title} — ${record.result.headline}`;
  }
  return definition.title;
}

export function calculatorNoteCaption(record: CalculationRecord): string {
  const definition = findCalculator(record.calculatorId);
  if (definition?.state === 'available') {
    return definition.shortTitle;
  }
  return definition?.title ?? record.calculatorId;
}
