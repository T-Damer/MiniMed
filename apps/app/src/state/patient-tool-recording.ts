import type { CalculatorSchema } from '@localmed/contracts';
import type {
  AssessmentDefinition,
  CompletedAssessmentRecord,
} from '@/features/assessments/assessment-types';
import type { StoredCalculationResult } from '@/features/calculators/clinical-calculations';
import {
  appendToolResultIdempotently,
  type PatientEvent,
  type PatientObservation,
  type PatientProfile,
  type PatientSourceSnapshot,
  type PatientVaultSnapshot,
  patientBindingValue,
  patientContextSnapshot,
} from '@/state/patient-domain';
import {
  isPatientVaultUnlocked,
  readPatientVault,
  withPatientVaultMutation,
  writePatientVault,
} from '@/state/patient-vault';

const PATIENT_RECORDING_BLOCKED_CALCULATORS = new Set([
  'minimed.calculator.weight-for-age-girls-who-demo',
]);

export interface PatientToolRecordOutcome {
  readonly snapshot: PatientVaultSnapshot;
  readonly event?: PatientEvent;
  readonly created: boolean;
  readonly reason?: string;
}

function profileFor(snapshot: PatientVaultSnapshot, patientId: string): PatientProfile {
  const profile = snapshot.profiles.find((candidate) => candidate.id === patientId);
  if (!profile) throw new Error('Выбранный пациент не найден в защищённом хранилище.');
  return profile;
}

function episodeFor(
  snapshot: PatientVaultSnapshot,
  patientId: string,
  explicitEpisodeId: string | undefined,
): string | undefined {
  if (!explicitEpisodeId) return undefined;
  const episode = snapshot.episodes.find((candidate) => candidate.id === explicitEpisodeId);
  if (!episode || episode.patientId !== patientId) {
    throw new Error('Выбранный осмотр не относится к этому пациенту.');
  }
  if (episode.status !== 'open') throw new Error('Выбранный осмотр уже закрыт.');
  return episode.id;
}

function finiteNumber(value: string | number | undefined): number | undefined {
  const result =
    typeof value === 'number' ? value : value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function evaluationSourceIds(
  evaluation:
    | {
        readonly sourceIds?: readonly string[];
        readonly verdict?: { readonly sourceIds: readonly string[] };
      }
    | undefined,
): readonly string[] {
  return evaluation?.sourceIds?.length
    ? evaluation.sourceIds
    : (evaluation?.verdict?.sourceIds ?? []);
}

function calculatorSourceLinks(
  calculatorId: string,
  schema: CalculatorSchema | undefined,
): readonly PatientSourceSnapshot[] {
  return (schema?.sources ?? []).map((source, index) => ({
    id: `${calculatorId}:source:${index + 1}`,
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
  }));
}

function assessmentSourceLinks(definition: AssessmentDefinition): readonly PatientSourceSnapshot[] {
  return (definition.sourceLinks ?? []).map((source) => ({
    id: source.id,
    title: source.title,
    ...(source.moduleId ? { moduleId: source.moduleId } : {}),
    ...(source.documentId ? { documentId: source.documentId } : {}),
    ...(source.url ? { url: source.url } : {}),
  }));
}

function normalizedCalculatorInputs(
  schema: CalculatorSchema,
  rawInputs: Readonly<Record<string, string | number>>,
): Readonly<Record<string, string | number>> {
  const normalized: Record<string, string | number> = {};
  for (const input of schema.inputs) {
    const raw = rawInputs[input.id];
    if (raw === undefined || raw === '') continue;
    if (input.kind === 'number') {
      const value = finiteNumber(raw);
      if (value !== undefined) normalized[input.id] = value;
    } else {
      normalized[input.id] = String(raw);
    }
  }
  return normalized;
}

export function patientBoundCalculatorInputs(
  schema: CalculatorSchema,
  profile: PatientProfile,
  snapshot: PatientVaultSnapshot,
  eventDate = new Date().toISOString(),
): Readonly<Record<string, string | number>> {
  const values: Record<string, string | number> = {};
  for (const input of schema.inputs) {
    const binding = input.patientBinding;
    if (!binding) continue;
    const value = patientBindingValue(binding, profile, snapshot, eventDate);
    if (value === undefined) continue;
    if (
      input.kind === 'select' &&
      !(input.options ?? []).some((option) => String(option.value) === String(value))
    )
      continue;
    values[input.id] = value;
  }
  return values;
}

function calculatorObservationValue(
  mapping: CalculatorSchema['observationMappings'][number],
  result: StoredCalculationResult,
  rawInputs: Readonly<Record<string, string | number>>,
): number | undefined {
  if (mapping.inputId) return finiteNumber(rawInputs[mapping.inputId]);
  if (mapping.stepId) {
    return result.trace.find((step) => step.id === mapping.stepId)?.value;
  }
  if (mapping.outputId) {
    if ('value' in result && result.outputId === mapping.outputId) return result.value;
    if ('values' in result)
      return result.values.find((output) => output.id === mapping.outputId)?.value;
    return undefined;
  }
  return undefined;
}

function assessmentObservationValues(
  definition: AssessmentDefinition,
  record: CompletedAssessmentRecord,
  contextSnapshot: Readonly<Record<string, string | number>>,
): readonly Omit<PatientObservation, 'id' | 'patientId' | 'eventId'>[] {
  const mappings = definition.observationMappings ?? [];
  const sourceLinks = assessmentSourceLinks(definition);
  const values: Omit<PatientObservation, 'id' | 'patientId' | 'eventId'>[] = [];
  const evaluation = record.result.evaluation
    ? {
        status: record.result.evaluation.status,
        ...(record.result.evaluation.verdict ? { verdict: record.result.evaluation.verdict } : {}),
        context: contextSnapshot,
        capturedAt: record.result.completedAt,
        missingContext: record.result.evaluation.missingContext ?? [],
        ...(record.result.evaluation.reason ? { reason: record.result.evaluation.reason } : {}),
        sourceIds: evaluationSourceIds(record.result.evaluation),
        sourceLinks,
      }
    : {
        status: 'unavailable' as const,
        reason: 'Опросник не объявил оценку результата.',
        missingContext: [],
        sourceIds: [],
        sourceLinks,
        context: contextSnapshot,
        capturedAt: record.result.completedAt,
      };
  for (const mapping of mappings) {
    if (!mapping.scaleId) continue;
    const score = record.result.scores.find((candidate) => candidate.scaleId === mapping.scaleId);
    if (!score || !Number.isFinite(score.rawScore)) continue;
    values.push({
      metricId: mapping.metricId,
      value: score.rawScore,
      unit: mapping.unit,
      observedAt: record.result.completedAt,
      ...(mapping.method ? { method: mapping.method } : {}),
      source: {
        kind: 'tool-result',
        toolId: definition.id,
        toolVersion: definition.version ?? '2',
      },
      evaluation,
    });
  }
  return values;
}

export async function recordCalculatorResultForPatient(input: {
  readonly patientId: string;
  readonly episodeId?: string;
  readonly recordId: string;
  readonly calculatorId: string;
  readonly calculatorVersion: string;
  readonly title: string;
  readonly schema?: CalculatorSchema;
  readonly result: StoredCalculationResult;
  readonly rawInputs: Readonly<Record<string, string | number>>;
  readonly occurredAt?: string;
}): Promise<PatientToolRecordOutcome> {
  if (PATIENT_RECORDING_BLOCKED_CALCULATORS.has(input.calculatorId)) {
    throw new Error('Приближённый WHO demo не записывается в карточку пациента.');
  }
  return withPatientVaultMutation(async () => {
    if (!isPatientVaultUnlocked())
      throw new Error('Разблокируйте карточки пациентов перед записью результата.');
    const snapshot = await readPatientVault();
    const profile = profileFor(snapshot, input.patientId);
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const schema = input.schema;
    const sourceLinks = calculatorSourceLinks(input.calculatorId, schema);
    const episodeId = episodeFor(snapshot, input.patientId, input.episodeId);
    const mappings = schema?.observationMappings ?? [];
    const normalizedInputs = schema
      ? normalizedCalculatorInputs(schema, input.rawInputs)
      : input.rawInputs;
    const contextSnapshot = schema ? patientContextSnapshot(profile, snapshot, occurredAt) : {};
    const evaluation = input.result.evaluation
      ? {
          status: input.result.evaluation.status,
          ...(input.result.evaluation.verdict ? { verdict: input.result.evaluation.verdict } : {}),
          context: contextSnapshot,
          capturedAt: occurredAt,
          missingContext: input.result.evaluation.missingContext ?? [],
          ...(input.result.evaluation.reason ? { reason: input.result.evaluation.reason } : {}),
          sourceIds: evaluationSourceIds(input.result.evaluation),
          sourceLinks,
        }
      : {
          status: 'unavailable' as const,
          reason: 'Калькулятор не объявил оценку результата.',
          missingContext: [],
          sourceIds: [],
          sourceLinks,
          context: contextSnapshot,
          capturedAt: occurredAt,
        };
    const observations: Omit<PatientObservation, 'id' | 'patientId' | 'eventId'>[] = [];
    for (const mapping of mappings) {
      const value = calculatorObservationValue(mapping, input.result, normalizedInputs);
      if (value === undefined) continue;
      observations.push({
        metricId: mapping.metricId,
        value,
        unit: mapping.unit,
        observedAt: occurredAt,
        ...(mapping.method ? { method: mapping.method } : {}),
        source: {
          kind: 'tool-result',
          toolId: input.calculatorId,
          toolVersion: input.calculatorVersion,
        },
        evaluation,
      });
    }
    const outcome = appendToolResultIdempotently(snapshot, {
      patientId: input.patientId,
      ...(episodeId ? { episodeId } : {}),
      occurredAt,
      title: input.title,
      provenance: {
        toolId: input.calculatorId,
        toolVersion: input.calculatorVersion,
        definitionVersion: input.calculatorVersion,
        sourceIds: evaluationSourceIds(input.result.evaluation),
        sourceLinks,
        idempotencyKey: input.recordId,
        normalizedInputs,
        contextSnapshot,
      },
      observations,
    });
    if (outcome.created) await writePatientVault(outcome.snapshot);
    return { snapshot: outcome.snapshot, event: outcome.event, created: outcome.created };
  });
}

export async function recordAssessmentResultForPatient(input: {
  readonly patientId: string;
  readonly episodeId?: string;
  readonly record: CompletedAssessmentRecord;
  readonly definition: AssessmentDefinition;
}): Promise<PatientToolRecordOutcome> {
  return withPatientVaultMutation(async () => {
    if (!isPatientVaultUnlocked())
      throw new Error('Разблокируйте карточки пациентов перед записью результата.');
    const snapshot = await readPatientVault();
    const profile = profileFor(snapshot, input.patientId);
    const episodeId = episodeFor(snapshot, input.patientId, input.episodeId);
    const contextSnapshot =
      input.record.contextSnapshot ??
      patientContextSnapshot(profile, snapshot, input.record.createdAt);
    const observations = assessmentObservationValues(
      input.definition,
      input.record,
      contextSnapshot,
    );
    const sourceLinks = assessmentSourceLinks(input.definition);
    const outcome = appendToolResultIdempotently(snapshot, {
      patientId: input.patientId,
      ...(episodeId ? { episodeId } : {}),
      occurredAt: input.record.createdAt,
      title: input.definition.title,
      text: input.record.result.summary,
      provenance: {
        toolId: input.definition.id,
        toolVersion: input.definition.version ?? '2',
        definitionVersion: input.definition.version ?? String(input.definition.schemaVersion ?? 2),
        sourceIds: evaluationSourceIds(input.record.result.evaluation),
        sourceLinks,
        idempotencyKey: input.record.id,
        normalizedInputs: input.record.answers,
        contextSnapshot,
      },
      observations,
    });
    if (outcome.created) await writePatientVault(outcome.snapshot);
    return { snapshot: outcome.snapshot, event: outcome.event, created: outcome.created };
  });
}
