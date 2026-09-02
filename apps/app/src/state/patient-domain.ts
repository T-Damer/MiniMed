import type {
  CalculatorPatientBinding,
  EvaluationStatus,
  ReferenceVerdict,
  ToolEvaluation,
} from '@localmed/contracts';
import { isHttpUrl, ReferenceVerdictSchema } from '@localmed/contracts';

export const PATIENT_DOMAIN_SCHEMA_VERSION = 2 as const;

export type BiologicalSex = 'female' | 'male' | 'intersex' | 'unknown';

export type PatientEventKind =
  | 'tool-result'
  | 'manual-measurement'
  | 'laboratory-result'
  | 'medication'
  | 'note';

export type MedicationEventKind = 'start' | 'take' | 'dose-change' | 'stop';

export interface PatientProfile {
  readonly id: string;
  readonly displayName: string;
  readonly localRecordNumber?: string;
  readonly birthDate?: string;
  readonly biologicalSex?: BiologicalSex;
  readonly summary?: string;
  /** Stable, explicitly named context fields captured with the profile. */
  readonly context?: Readonly<Record<string, string | number>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClinicalEpisode {
  readonly id: string;
  readonly patientId: string;
  readonly title: string;
  readonly startedAt: string;
  readonly text: string;
  readonly eventIds: readonly string[];
  /** Only an explicitly open episode may receive automatic tool recordings. */
  readonly status: 'open' | 'closed';
  readonly closedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PatientMetricDefinition {
  readonly id: string;
  readonly metricId: string;
  readonly label: string;
  readonly unit: string;
  readonly metricVersion: string;
  readonly kind: 'registry' | 'custom';
  readonly createdAt: string;
}

/** Small, product-owned registry; custom definitions stay inside the encrypted patient snapshot. */
export const PATIENT_METRIC_REGISTRY: readonly Omit<PatientMetricDefinition, 'id' | 'createdAt'>[] =
  [
    {
      metricId: 'body-mass',
      label: 'Масса тела',
      unit: 'кг',
      metricVersion: '1',
      kind: 'registry',
    },
    { metricId: 'body-height', label: 'Рост', unit: 'см', metricVersion: '1', kind: 'registry' },
    {
      metricId: 'blood-pressure-systolic',
      label: 'Давление: систолическое',
      unit: 'мм рт. ст.',
      metricVersion: '1',
      kind: 'registry',
    },
    {
      metricId: 'blood-pressure-diastolic',
      label: 'Давление: диастолическое',
      unit: 'мм рт. ст.',
      metricVersion: '1',
      kind: 'registry',
    },
    { metricId: 'pulse', label: 'Пульс', unit: 'уд/мин', metricVersion: '1', kind: 'registry' },
    {
      metricId: 'temperature',
      label: 'Температура',
      unit: '°C',
      metricVersion: '1',
      kind: 'registry',
    },
    {
      metricId: 'oxygen-saturation',
      label: 'SpO₂',
      unit: '%',
      metricVersion: '1',
      kind: 'registry',
    },
  ];

export interface PatientObservation {
  readonly id: string;
  readonly patientId: string;
  readonly eventId: string;
  readonly metricId: string;
  readonly value: number;
  readonly unit: string;
  readonly observedAt: string;
  readonly method?: string;
  readonly source: PatientObservationSource;
  readonly evaluation?: PatientEvaluationSnapshot;
  readonly revisionOf?: string;
  readonly supersededBy?: string;
}

export type PatientObservationSource =
  | { readonly kind: 'tool-result'; readonly toolId: string; readonly toolVersion: string }
  | { readonly kind: 'manual'; readonly label: string; readonly metricVersion: string }
  | { readonly kind: 'laboratory'; readonly label: string; readonly reportRange?: LaboratoryRange };

export interface LaboratoryRange {
  readonly lower?: number;
  readonly upper?: number;
  readonly lowerInclusive?: boolean;
  readonly upperInclusive?: boolean;
  readonly text?: string;
}

/** Immutable source metadata captured with a patient result, never resolved from live content. */
export interface PatientSourceSnapshot {
  readonly id: string;
  readonly title: string;
  readonly moduleId?: string;
  readonly documentId?: string;
  readonly url?: string;
}

export interface PatientEvaluationSnapshot {
  readonly status: EvaluationStatus;
  readonly verdict?: ReferenceVerdict;
  readonly missingContext?: readonly string[];
  readonly reason?: string;
  readonly sourceIds?: readonly string[];
  readonly sourceLinks?: readonly PatientSourceSnapshot[];
  readonly context: Readonly<Record<string, string | number>>;
  readonly capturedAt: string;
}

export interface ToolResultProvenance {
  readonly toolId: string;
  readonly toolVersion: string;
  readonly definitionVersion: string;
  readonly sourceIds: readonly string[];
  readonly sourceLinks?: readonly PatientSourceSnapshot[];
  readonly idempotencyKey: string;
  readonly normalizedInputs: Readonly<Record<string, string | number>>;
  readonly contextSnapshot: Readonly<Record<string, string | number>>;
}

export interface PatientEvent {
  readonly id: string;
  readonly patientId: string;
  readonly episodeId?: string;
  readonly kind: PatientEventKind;
  readonly occurredAt: string;
  readonly title: string;
  readonly text?: string;
  readonly medicationKind?: MedicationEventKind;
  readonly provenance?: ToolResultProvenance;
  readonly observations: readonly PatientObservation[];
  readonly immutable: boolean;
  readonly revisionOf?: string;
  readonly supersededBy?: string;
}

export interface PatientVaultSnapshot {
  readonly schemaVersion: typeof PATIENT_DOMAIN_SCHEMA_VERSION;
  readonly profiles: readonly PatientProfile[];
  readonly episodes: readonly ClinicalEpisode[];
  readonly events: readonly PatientEvent[];
  readonly observations: readonly PatientObservation[];
  readonly metricDefinitions: readonly PatientMetricDefinition[];
}

export interface CreatePatientProfileInput {
  readonly id?: string;
  readonly displayName: string;
  readonly localRecordNumber?: string;
  readonly birthDate?: string;
  readonly biologicalSex?: BiologicalSex;
  readonly summary?: string;
  readonly context?: Readonly<Record<string, string | number>>;
  readonly createdAt?: string;
  readonly weightKg?: number;
  readonly heightCm?: number;
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function metricDefinitionId(
  metricId: string,
  label: string,
  unit: string,
  metricVersion: string,
): string {
  return [metricId, label, unit, metricVersion].map((part) => encodeURIComponent(part)).join(':');
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label}: требуется конечное число.`);
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) throw new Error(`${label}: требуется положительное число.`);
  return value;
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}: значение обязательно.`);
  return trimmed;
}

function asDate(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label}: некорректная дата.`);
  const calendar = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(calendar)) {
    const [year, month, day] = calendar.split('-').map(Number);
    const normalized = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
    if (
      normalized.getUTCFullYear() !== year ||
      normalized.getUTCMonth() !== (month ?? 1) - 1 ||
      normalized.getUTCDate() !== day
    ) {
      throw new Error(`${label}: некорректная календарная дата.`);
    }
  }
  return value;
}

export function emptyPatientVaultSnapshot(): PatientVaultSnapshot {
  return {
    schemaVersion: PATIENT_DOMAIN_SCHEMA_VERSION,
    profiles: [],
    episodes: [],
    events: [],
    observations: [],
    metricDefinitions: [],
  };
}

export function createPatientProfile(input: CreatePatientProfileInput): {
  readonly profile: PatientProfile;
  readonly initialEvents: readonly PatientEvent[];
} {
  const createdAt = input.createdAt ?? nowIso();
  asDate(createdAt, 'Дата создания карточки');
  const displayName = nonEmpty(input.displayName, 'Отображаемое имя пациента');
  if (input.birthDate) asDate(input.birthDate, 'Дата рождения');
  const context =
    input.context === undefined
      ? undefined
      : normalizeValueRecord(input.context, 'контекст пациента');
  const profile: PatientProfile = {
    id: input.id ?? createId('patient'),
    displayName,
    ...(input.localRecordNumber?.trim()
      ? { localRecordNumber: input.localRecordNumber.trim() }
      : {}),
    ...(input.birthDate ? { birthDate: input.birthDate } : {}),
    ...(input.biologicalSex ? { biologicalSex: input.biologicalSex } : {}),
    ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
    createdAt,
    updatedAt: createdAt,
  };
  const initialEvents: PatientEvent[] = [];
  if (input.weightKg !== undefined) {
    initialEvents.push(
      createManualMeasurementEvent({
        patientId: profile.id,
        occurredAt: createdAt,
        metricId: 'body-mass',
        label: 'Масса тела',
        value: positive(input.weightKg, 'Масса тела'),
        unit: 'кг',
      }),
    );
  }
  if (input.heightCm !== undefined) {
    initialEvents.push(
      createManualMeasurementEvent({
        patientId: profile.id,
        occurredAt: createdAt,
        metricId: 'body-height',
        label: 'Рост',
        value: positive(input.heightCm, 'Рост'),
        unit: 'см',
      }),
    );
  }
  return { profile, initialEvents };
}

export function createClinicalEpisode(input: {
  readonly patientId: string;
  readonly title?: string;
  readonly startedAt?: string;
  readonly text?: string;
  readonly id?: string;
}): ClinicalEpisode {
  const startedAt = input.startedAt ?? nowIso();
  asDate(startedAt, 'Дата осмотра');
  const title = input.title?.trim() || 'Осмотр';
  return {
    id: input.id ?? createId('episode'),
    patientId: nonEmpty(input.patientId, 'Пациент'),
    title,
    startedAt,
    text: input.text?.trim() ?? '',
    eventIds: [],
    status: 'open',
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

export function closeClinicalEpisode(
  snapshot: PatientVaultSnapshot,
  episodeId: string,
  closedAt = nowIso(),
): PatientVaultSnapshot {
  asDate(closedAt, 'Дата закрытия осмотра');
  let found = false;
  const episodes = snapshot.episodes.map((episode) => {
    if (episode.id !== episodeId) return episode;
    found = true;
    return {
      ...episode,
      status: 'closed' as const,
      closedAt,
      updatedAt: closedAt,
    };
  });
  if (!found) throw new Error('Осмотр не найден.');
  return { ...snapshot, episodes };
}

export function calculateAgeOnDate(
  birthDate: string,
  eventDate: string,
): { readonly years: number; readonly months: number; readonly days: number } {
  asDate(birthDate, 'Дата рождения');
  asDate(eventDate, 'Дата события');
  const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  const event = new Date(`${eventDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(event.getTime())) {
    throw new Error('Дата рождения или дата события имеет неверный календарный формат.');
  }
  if (event.getTime() < birth.getTime()) throw new Error('Дата события раньше даты рождения.');
  let years = event.getUTCFullYear() - birth.getUTCFullYear();
  let months = event.getUTCMonth() - birth.getUTCMonth();
  let days = event.getUTCDate() - birth.getUTCDate();
  if (days < 0) {
    months -= 1;
    const previousMonth = new Date(Date.UTC(event.getUTCFullYear(), event.getUTCMonth(), 0));
    days += previousMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

export function ageInYearsOnDate(birthDate: string, eventDate: string): number {
  const age = calculateAgeOnDate(birthDate, eventDate);
  return age.years + age.months / 12 + age.days / 365.2425;
}

export function createManualMeasurementEvent(input: {
  readonly patientId: string;
  readonly episodeId?: string;
  readonly occurredAt?: string;
  readonly metricId: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly method?: string;
  readonly id?: string;
}): PatientEvent {
  const occurredAt = input.occurredAt ?? nowIso();
  asDate(occurredAt, 'Дата измерения');
  const eventId = input.id ?? createId('event');
  const observation: PatientObservation = {
    id: createId('observation'),
    patientId: nonEmpty(input.patientId, 'Пациент'),
    eventId,
    metricId: nonEmpty(input.metricId, 'Показатель'),
    value: finite(input.value, input.label),
    unit: nonEmpty(input.unit, 'Единица'),
    observedAt: occurredAt,
    ...(input.method ? { method: input.method } : {}),
    source: {
      kind: 'manual',
      label: nonEmpty(input.label, 'Название показателя'),
      metricVersion: '1',
    },
  };
  return {
    id: eventId,
    patientId: input.patientId,
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    kind: 'manual-measurement',
    occurredAt,
    title: input.label.trim(),
    observations: [observation],
    immutable: false,
  };
}

export function createLaboratoryEvent(input: {
  readonly patientId: string;
  readonly episodeId?: string;
  readonly occurredAt?: string;
  readonly metricId: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly method?: string;
  readonly reportRange?: LaboratoryRange;
  readonly id?: string;
}): PatientEvent {
  const base = createManualMeasurementEvent(input);
  const observation = base.observations[0];
  if (!observation) throw new Error('Не удалось создать лабораторное наблюдение.');
  const range = input.reportRange;
  const evaluation: PatientEvaluationSnapshot = range
    ? laboratoryEvaluation(observation.value, range, observation.observedAt)
    : {
        status: 'unavailable',
        reason: 'Референсный диапазон с бланка не указан.',
        missingContext: ['Референсный диапазон с бланка'],
        sourceIds: [],
        context: {},
        capturedAt: observation.observedAt,
      };
  return {
    ...base,
    kind: 'laboratory-result',
    observations: [
      {
        ...observation,
        source: {
          kind: 'laboratory',
          label: input.label.trim(),
          ...(input.reportRange ? { reportRange: input.reportRange } : {}),
        },
        evaluation,
      },
    ],
  };
}

function laboratoryEvaluation(
  value: number,
  range: LaboratoryRange,
  capturedAt: string,
): PatientEvaluationSnapshot {
  const lower = range.lower;
  const upper = range.upper;
  if (lower === undefined && upper === undefined) {
    return {
      status: 'unavailable',
      reason: 'Введённый текст диапазона не содержит числовых границ.',
      missingContext: ['Числовые границы диапазона'],
      sourceIds: [],
      context: {},
      capturedAt,
    };
  }
  const lowerInclusive = range.lowerInclusive ?? true;
  const upperInclusive = range.upperInclusive ?? true;
  const below = lower !== undefined && (value < lower || (!lowerInclusive && value === lower));
  const above = upper !== undefined && (value > upper || (!upperInclusive && value === upper));
  const title = below
    ? 'Ниже диапазона бланка'
    : above
      ? 'Выше диапазона бланка'
      : 'В диапазоне бланка';
  return {
    status: 'verdict',
    verdict: {
      rangeId: 'laboratory-report-range',
      title,
      explanation:
        range.text?.trim() || 'Оценка выполнена только по референсному диапазону с бланка.',
      attentionLevel: below || above ? 'moderate' : 'none',
      ...(lower === undefined ? {} : { lowerBound: lower }),
      ...(upper === undefined ? {} : { upperBound: upper }),
      lowerInclusive,
      upperInclusive,
      sourceIds: [],
    },
    missingContext: [],
    sourceIds: [],
    context: {},
    capturedAt,
  };
}

export function createMedicationEvent(input: {
  readonly patientId: string;
  readonly episodeId?: string;
  readonly occurredAt?: string;
  readonly medicationKind: MedicationEventKind;
  readonly title: string;
  readonly text?: string;
  readonly id?: string;
}): PatientEvent {
  const occurredAt = input.occurredAt ?? nowIso();
  asDate(occurredAt, 'Дата лекарственного события');
  return {
    id: input.id ?? createId('event'),
    patientId: nonEmpty(input.patientId, 'Пациент'),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    kind: 'medication',
    occurredAt,
    title: nonEmpty(input.title, 'Препарат'),
    ...(input.text?.trim() ? { text: input.text.trim() } : {}),
    medicationKind: input.medicationKind,
    observations: [],
    immutable: false,
  };
}

function isClosedEpisodeRevision(
  snapshot: PatientVaultSnapshot,
  event: PatientEvent,
  episode: ClinicalEpisode,
): boolean {
  if (!event.revisionOf || event.immutable) return false;
  const original = snapshot.events.find((candidate) => candidate.id === event.revisionOf);
  return Boolean(
    original &&
      !original.immutable &&
      (original.kind === 'manual-measurement' || original.kind === 'laboratory-result') &&
      original.kind === event.kind &&
      original.patientId === event.patientId &&
      original.episodeId === episode.id &&
      original.supersededBy === event.id,
  );
}

function appendEventInternal(
  snapshot: PatientVaultSnapshot,
  event: PatientEvent,
  allowClosedEpisodeRevision: boolean,
): PatientVaultSnapshot {
  if (snapshot.events.some((candidate) => candidate.id === event.id)) return snapshot;
  if (!snapshot.profiles.some((profile) => profile.id === event.patientId)) {
    throw new Error('Нельзя записать событие неизвестному пациенту.');
  }
  if (event.episodeId) {
    const episode = snapshot.episodes.find((candidate) => candidate.id === event.episodeId);
    if (!episode) throw new Error('Нельзя записать событие в неизвестный осмотр.');
    if (episode.patientId !== event.patientId) {
      throw new Error('Нельзя записать событие в осмотр другого пациента.');
    }
    if (
      episode.status !== 'open' &&
      (!allowClosedEpisodeRevision || !isClosedEpisodeRevision(snapshot, event, episode))
    ) {
      throw new Error('Нельзя записать событие в закрытый осмотр.');
    }
  }
  if (event.kind !== 'tool-result' && event.provenance !== undefined) {
    throw new Error('Происхождение результата допустимо только для события инструмента.');
  }
  if ((event.kind === 'medication' || event.kind === 'note') && event.observations.length > 0) {
    throw new Error('Лекарственное или текстовое событие не может содержать наблюдения.');
  }
  const eventObservationIds = new Set<string>();
  for (const observation of event.observations) {
    if (
      eventObservationIds.has(observation.id) ||
      snapshot.observations.some((candidate) => candidate.id === observation.id) ||
      observation.id.trim() === '' ||
      observation.eventId !== event.id ||
      observation.patientId !== event.patientId ||
      observation.metricId.trim() === '' ||
      observation.unit.trim() === '' ||
      !Number.isFinite(observation.value)
    ) {
      throw new Error('Наблюдение не связано с событием пациента.');
    }
    eventObservationIds.add(observation.id);
    if (
      event.kind === 'tool-result' &&
      (observation.source.kind !== 'tool-result' ||
        observation.source.toolId !== event.provenance?.toolId ||
        observation.source.toolVersion !== event.provenance?.toolVersion)
    ) {
      throw new Error('Происхождение наблюдения не совпадает с результатом инструмента.');
    }
    if (event.kind === 'manual-measurement' && observation.source.kind !== 'manual') {
      throw new Error('Ручное событие содержит не ручное наблюдение.');
    }
    if (event.kind === 'laboratory-result' && observation.source.kind !== 'laboratory') {
      throw new Error('Лабораторное событие содержит не лабораторное наблюдение.');
    }
  }
  if (event.kind === 'tool-result' && (!event.immutable || !event.provenance)) {
    throw new Error('Результат инструмента должен быть неизменяемым и иметь происхождение.');
  }
  const prepared = withManualMetricVersion(snapshot, event);
  const preparedEvent = prepared.event;
  const episodeId = preparedEvent.episodeId;
  const episodes = episodeId
    ? snapshot.episodes.map((episode) =>
        episode.id === episodeId
          ? {
              ...episode,
              eventIds: [...episode.eventIds, preparedEvent.id],
              updatedAt: preparedEvent.occurredAt,
            }
          : episode,
      )
    : snapshot.episodes;
  return {
    ...snapshot,
    episodes,
    events: [...snapshot.events, preparedEvent],
    observations: [...snapshot.observations, ...preparedEvent.observations],
    metricDefinitions: prepared.metricDefinitions,
  };
}

export function appendEvent(
  snapshot: PatientVaultSnapshot,
  event: PatientEvent,
): PatientVaultSnapshot {
  return appendEventInternal(snapshot, event, false);
}

function appendRevisionEvent(
  snapshot: PatientVaultSnapshot,
  event: PatientEvent,
): PatientVaultSnapshot {
  return appendEventInternal(snapshot, event, true);
}

function withManualMetricVersion(
  snapshot: PatientVaultSnapshot,
  event: PatientEvent,
): {
  readonly event: PatientEvent;
  readonly metricDefinitions: readonly PatientMetricDefinition[];
} {
  if (event.kind !== 'manual-measurement')
    return { event, metricDefinitions: snapshot.metricDefinitions };
  const definitions = [...snapshot.metricDefinitions];
  const observations = event.observations.map((observation) => {
    if (observation.source.kind !== 'manual') return observation;
    const source = observation.source;
    const registry = PATIENT_METRIC_REGISTRY.find(
      (candidate) =>
        candidate.metricId === observation.metricId &&
        candidate.label === source.label &&
        candidate.unit === observation.unit,
    );
    const same = definitions.find(
      (definition) =>
        definition.metricId === observation.metricId &&
        definition.label === source.label &&
        definition.unit === observation.unit,
    );
    const priorVersions = definitions
      .filter(
        (definition) =>
          definition.metricId === observation.metricId && definition.label === source.label,
      )
      .map((definition) => Number(definition.metricVersion) || 1);
    const metricVersion =
      same?.metricVersion ?? registry?.metricVersion ?? String(Math.max(...priorVersions, 0) + 1);
    if (!same) {
      definitions.push({
        id: metricDefinitionId(observation.metricId, source.label, observation.unit, metricVersion),
        metricId: observation.metricId,
        label: source.label,
        unit: observation.unit,
        metricVersion,
        kind: registry ? 'registry' : 'custom',
        createdAt: observation.observedAt,
      });
    }
    return { ...observation, source: { ...source, metricVersion } };
  });
  return { event: { ...event, observations }, metricDefinitions: definitions };
}

export function appendEpisode(
  snapshot: PatientVaultSnapshot,
  episode: ClinicalEpisode,
): PatientVaultSnapshot {
  if (!snapshot.profiles.some((profile) => profile.id === episode.patientId)) {
    throw new Error('Нельзя создать осмотр неизвестному пациенту.');
  }
  if (snapshot.episodes.some((candidate) => candidate.id === episode.id)) return snapshot;
  for (const eventId of episode.eventIds) {
    const event = snapshot.events.find((candidate) => candidate.id === eventId);
    if (!event || event.patientId !== episode.patientId || event.episodeId !== episode.id) {
      throw new Error('Осмотр содержит событие другого пациента или неизвестное событие.');
    }
  }
  return { ...snapshot, episodes: [...snapshot.episodes, episode] };
}

export function removePatientFromSnapshot(
  snapshot: PatientVaultSnapshot,
  patientId: string,
): PatientVaultSnapshot {
  if (!snapshot.profiles.some((profile) => profile.id === patientId)) {
    throw new Error('Пациент не найден.');
  }
  const eventIds = new Set(
    snapshot.events.filter((event) => event.patientId === patientId).map((event) => event.id),
  );
  const events = snapshot.events.filter((event) => event.patientId !== patientId);
  return {
    ...snapshot,
    profiles: snapshot.profiles.filter((profile) => profile.id !== patientId),
    episodes: snapshot.episodes.filter((episode) => episode.patientId !== patientId),
    events,
    observations: snapshot.observations.filter(
      (observation) => observation.patientId !== patientId && !eventIds.has(observation.eventId),
    ),
    metricDefinitions: metricDefinitionsForEvents(snapshot.metricDefinitions, events),
  };
}

/**
 * Returns a portable snapshot containing exactly one patient and everything linked to that
 * patient. This is deliberately separate from `removePatientFromSnapshot`: export must never
 * accidentally omit the selected patient or include another patient's records.
 */
export function selectPatientFromSnapshot(
  snapshot: PatientVaultSnapshot,
  patientId: string,
): PatientVaultSnapshot {
  if (!snapshot.profiles.some((profile) => profile.id === patientId)) {
    throw new Error('Пациент не найден.');
  }
  const events = snapshot.events.filter((event) => event.patientId === patientId);
  const eventIds = new Set(events.map((event) => event.id));
  return {
    ...snapshot,
    profiles: snapshot.profiles.filter((profile) => profile.id === patientId),
    episodes: snapshot.episodes.filter((episode) => episode.patientId === patientId),
    events,
    observations: snapshot.observations.filter(
      (observation) => observation.patientId === patientId && eventIds.has(observation.eventId),
    ),
    metricDefinitions: metricDefinitionsForEvents(snapshot.metricDefinitions, events),
  };
}

function metricDefinitionsForEvents(
  definitions: readonly PatientMetricDefinition[],
  events: readonly PatientEvent[],
): readonly PatientMetricDefinition[] {
  const used = new Set(
    events.flatMap((event) =>
      event.observations.map(
        (observation) =>
          `${observation.metricId}|${observation.source.kind === 'manual' ? observation.source.label : ''}|${observation.unit}`,
      ),
    ),
  );
  return definitions.filter((definition) =>
    used.has(`${definition.metricId}|${definition.label}|${definition.unit}`),
  );
}

export function createToolResultEvent(input: {
  readonly patientId: string;
  readonly episodeId?: string;
  readonly occurredAt?: string;
  readonly title: string;
  readonly text?: string;
  readonly provenance: ToolResultProvenance;
  readonly observations: readonly Omit<PatientObservation, 'patientId' | 'eventId' | 'id'>[];
  readonly id?: string;
}): PatientEvent {
  const occurredAt = input.occurredAt ?? nowIso();
  const eventId = input.id ?? createId('event');
  return {
    id: eventId,
    patientId: nonEmpty(input.patientId, 'Пациент'),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    kind: 'tool-result',
    occurredAt,
    title: nonEmpty(input.title, 'Результат'),
    ...(input.text?.trim() ? { text: input.text.trim() } : {}),
    provenance: input.provenance,
    observations: input.observations.map((observation) => ({
      ...observation,
      id: createId('observation'),
      patientId: input.patientId,
      eventId,
    })),
    immutable: true,
  };
}

export function appendToolResultIdempotently(
  snapshot: PatientVaultSnapshot,
  input: Parameters<typeof createToolResultEvent>[0],
): {
  readonly snapshot: PatientVaultSnapshot;
  readonly event: PatientEvent;
  readonly created: boolean;
} {
  const existing = snapshot.events.find(
    (event) => event.provenance?.idempotencyKey === input.provenance.idempotencyKey,
  );
  if (existing) {
    if (
      existing.patientId !== input.patientId ||
      existing.provenance?.toolId !== input.provenance.toolId ||
      existing.provenance?.toolVersion !== input.provenance.toolVersion ||
      existing.provenance?.definitionVersion !== input.provenance.definitionVersion
    ) {
      throw new Error(
        'Идентификатор результата уже используется другим инструментом или пациентом.',
      );
    }
    return { snapshot, event: existing, created: false };
  }
  const event = createToolResultEvent(input);
  return { snapshot: appendEvent(snapshot, event), event, created: true };
}

export function reviseManualObservation(
  snapshot: PatientVaultSnapshot,
  observationId: string,
  input: { readonly value: number; readonly unit?: string; readonly occurredAt?: string },
): PatientVaultSnapshot {
  const current = snapshot.observations.find((observation) => observation.id === observationId);
  if (!current) throw new Error('Наблюдение не найдено.');
  if (current.supersededBy) throw new Error('Нельзя изменить уже заменённое наблюдение.');
  const event = snapshot.events.find((candidate) => candidate.id === current.eventId);
  if (!event || event.immutable || current.source.kind === 'tool-result') {
    throw new Error('Результат инструмента неизменяем.');
  }
  const revisedEventInput: {
    readonly patientId: string;
    readonly episodeId?: string;
    readonly occurredAt: string;
    readonly metricId: string;
    readonly label: string;
    readonly value: number;
    readonly unit: string;
    readonly method?: string;
  } = {
    patientId: current.patientId,
    occurredAt: input.occurredAt ?? nowIso(),
    metricId: current.metricId,
    label: current.source.label,
    value: input.value,
    unit: input.unit ?? current.unit,
    ...(event.episodeId ? { episodeId: event.episodeId } : {}),
    ...(current.method ? { method: current.method } : {}),
  };
  const revisedEvent =
    current.source.kind === 'laboratory'
      ? createLaboratoryEvent({
          ...revisedEventInput,
          ...(current.source.reportRange ? { reportRange: current.source.reportRange } : {}),
        })
      : createManualMeasurementEvent(revisedEventInput);
  const replacementObservationId = revisedEvent.observations[0]?.id;
  if (!replacementObservationId) throw new Error('Не удалось создать ревизию наблюдения.');
  const superseded: PatientObservation = { ...current, supersededBy: replacementObservationId };
  const supersededEvent = {
    ...event,
    supersededBy: revisedEvent.id,
    observations: event.observations.map((observation) =>
      observation.id === current.id ? superseded : observation,
    ),
  };
  return appendRevisionEvent(
    {
      ...snapshot,
      events: snapshot.events.map((candidate) =>
        candidate.id === event.id ? supersededEvent : candidate,
      ),
      observations: snapshot.observations.map((candidate) =>
        candidate.id === current.id ? superseded : candidate,
      ),
    },
    {
      ...revisedEvent,
      revisionOf: event.id,
      observations: revisedEvent.observations.map((observation) => ({
        ...observation,
        revisionOf: current.id,
      })),
    },
  );
}

export function latestObservation(
  snapshot: PatientVaultSnapshot,
  patientId: string,
  metricId: string,
  unit?: string,
  asOf?: string,
): PatientObservation | undefined {
  return snapshot.observations
    .filter(
      (observation) =>
        observation.patientId === patientId &&
        observation.metricId === metricId &&
        (!unit || observation.unit === unit) &&
        (asOf === undefined || Date.parse(observation.observedAt) <= Date.parse(asOf)) &&
        !observation.supersededBy,
    )
    .toSorted((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
}

export function observationSeriesKey(
  observation: Pick<PatientObservation, 'metricId' | 'unit' | 'method' | 'source'>,
): string {
  const method =
    observation.source.kind === 'tool-result'
      ? `${observation.source.toolId}@${observation.source.toolVersion}`
      : observation.source.kind === 'manual'
        ? `${observation.source.label}@${observation.source.metricVersion}`
        : `laboratory:${observation.source.label}`;
  return `${observation.metricId}|${observation.unit}|${method}|${observation.method ?? ''}`;
}

export interface DynamicsSeries {
  readonly key: string;
  readonly metricId: string;
  readonly unit: string;
  readonly method: string;
  readonly observations: readonly PatientObservation[];
}

export interface DynamicsChartGroup {
  readonly key: string;
  readonly metricId: string;
  readonly unit: string;
  readonly series: readonly DynamicsSeries[];
}

export function buildDynamics(
  snapshot: PatientVaultSnapshot,
  patientId: string,
): readonly DynamicsSeries[] {
  const groups = new Map<string, PatientObservation[]>();
  for (const observation of snapshot.observations) {
    if (observation.patientId !== patientId || observation.supersededBy) continue;
    const key = observationSeriesKey(observation);
    const list = groups.get(key) ?? [];
    list.push(observation);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, observations]) => {
      const first = observations[0];
      if (!first) throw new Error('Пустой ряд наблюдений.');
      const sourceMethod =
        first.source.kind === 'tool-result'
          ? `${first.source.toolId} · ${first.source.toolVersion}`
          : first.source.kind === 'manual'
            ? first.source.label
            : `Лаборатория · ${first.source.label}`;
      return {
        key,
        metricId: first.metricId,
        unit: first.unit,
        method: first.method ? `${sourceMethod} · ${first.method}` : sourceMethod,
        observations: observations.toSorted((left, right) =>
          left.observedAt.localeCompare(right.observedAt),
        ),
      };
    })
    .toSorted(
      (left, right) =>
        left.metricId.localeCompare(right.metricId) ||
        left.unit.localeCompare(right.unit) ||
        left.method.localeCompare(right.method),
    );
}

export function buildDynamicsGroups(
  snapshot: PatientVaultSnapshot,
  patientId: string,
): readonly DynamicsChartGroup[] {
  const groups = new Map<string, DynamicsSeries[]>();
  for (const series of buildDynamics(snapshot, patientId)) {
    const key =
      series.metricId === 'blood-pressure-systolic' ||
      series.metricId === 'blood-pressure-diastolic'
        ? `blood-pressure|${series.unit}`
        : `${series.metricId}|${series.unit}`;
    const list = groups.get(key) ?? [];
    list.push(series);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, series]) => {
      const first = series[0];
      if (!first) throw new Error('Пустая группа динамики.');
      return {
        key,
        metricId: key.startsWith('blood-pressure|') ? 'blood-pressure' : first.metricId,
        unit: first.unit,
        series,
      };
    })
    .toSorted(
      (left, right) =>
        left.metricId.localeCompare(right.metricId) || left.key.localeCompare(right.key),
    );
}

export function patientContextSnapshot(
  profile: PatientProfile,
  snapshot: PatientVaultSnapshot,
  eventDate: string,
): Readonly<Record<string, string | number>> {
  const context: Record<string, string | number> = { ...(profile.context ?? {}) };
  if (profile.birthDate) {
    context['birthDate'] = profile.birthDate;
    const age = calculateAgeOnDate(profile.birthDate, eventDate);
    context['ageYears'] = ageInYearsOnDate(profile.birthDate, eventDate);
    context['ageMonths'] = age.years * 12 + age.months;
  }
  if (profile.biologicalSex) context['biologicalSex'] = profile.biologicalSex;
  const weight = latestObservation(snapshot, profile.id, 'body-mass', 'кг', eventDate);
  const height = latestObservation(snapshot, profile.id, 'body-height', 'см', eventDate);
  if (weight) context['weightKg'] = weight.value;
  if (height) context['heightCm'] = height.value;
  return context;
}

export function patientBindingValue(
  binding: CalculatorPatientBinding,
  profile: PatientProfile,
  snapshot: PatientVaultSnapshot,
  eventDate: string,
): string | number | undefined {
  if (binding.kind === 'birthDate' || binding.kind === 'dateOfBirth') {
    return profile.birthDate?.slice(0, 10);
  }
  if (binding.kind === 'biologicalSex') return profile.biologicalSex;
  if (binding.kind === 'ageAtEvent') {
    if (!profile.birthDate) return undefined;
    return ageInYearsOnDate(profile.birthDate, eventDate);
  }
  if (!binding.metricId) return undefined;
  const observation = latestObservation(
    snapshot,
    profile.id,
    binding.metricId,
    binding.unit,
    eventDate,
  );
  if (!observation) return undefined;
  if (binding.maxAgeDays !== undefined) {
    const age = Date.parse(eventDate) - Date.parse(observation.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > binding.maxAgeDays * 86_400_000) return undefined;
  }
  return observation.value;
}

export function normalizePatientVaultSnapshot(value: unknown): PatientVaultSnapshot {
  if (!isRecord(value)) throw new Error('Повреждён снимок пациентского хранилища.');
  if (value['schemaVersion'] !== PATIENT_DOMAIN_SCHEMA_VERSION) {
    throw new Error('Неподдерживаемая версия пациентского хранилища.');
  }
  const profileValues = value['profiles'];
  const episodeValues = value['episodes'];
  const eventValues = value['events'];
  const observationValues = value['observations'];
  if (
    !Array.isArray(profileValues) ||
    !Array.isArray(episodeValues) ||
    !Array.isArray(eventValues) ||
    !Array.isArray(observationValues)
  ) {
    throw new Error('Повреждён снимок пациентского хранилища.');
  }
  const profiles = profileValues.map(normalizeProfile);
  const profileIds = uniqueIds(
    profiles.map((profile) => profile.id),
    'профили',
  );
  const episodes = episodeValues.map(normalizeEpisode);
  uniqueIds(
    episodes.map((episode) => episode.id),
    'осмотры',
  );
  const events = eventValues.map(normalizeEvent);
  uniqueIds(
    events.map((event) => event.id),
    'события',
  );
  const observations = observationValues.map(normalizeObservation);
  uniqueIds(
    observations.map((observation) => observation.id),
    'наблюдения',
  );
  const episodeIds = new Set(episodes.map((episode) => episode.id));
  const eventIds = new Set(events.map((event) => event.id));
  const observationIds = new Set(observations.map((observation) => observation.id));
  const metricDefinitionValues = value['metricDefinitions'];
  const metricDefinitions =
    metricDefinitionValues === undefined
      ? []
      : Array.isArray(metricDefinitionValues)
        ? metricDefinitionValues.map(normalizeMetricDefinition)
        : (() => {
            throw new Error('Повреждён справочник показателей пациента.');
          })();
  uniqueIds(
    metricDefinitions.map((definition) => definition.id),
    'определения показателей',
  );
  const metricDefinitionKeys = new Set<string>();
  for (const definition of metricDefinitions) {
    const key = `${definition.metricId}|${definition.label}|${definition.unit}`;
    if (metricDefinitionKeys.has(key)) {
      throw new Error('Определение показателя повторяется.');
    }
    metricDefinitionKeys.add(key);
  }
  for (const episode of episodes) {
    if (!profileIds.has(episode.patientId) || episode.eventIds.some((id) => !eventIds.has(id))) {
      throw new Error('Повреждены ссылки осмотра пациентского хранилища.');
    }
    for (const eventId of episode.eventIds) {
      const event = events.find((candidate) => candidate.id === eventId);
      if (!event || event.patientId !== episode.patientId || event.episodeId !== episode.id) {
        throw new Error('Повреждены ссылки осмотра пациентского хранилища.');
      }
    }
  }
  const eventObservationIds = new Set<string>();
  for (const event of events) {
    if (!profileIds.has(event.patientId) || (event.episodeId && !episodeIds.has(event.episodeId))) {
      throw new Error('Повреждены ссылки события пациентского хранилища.');
    }
    for (const relation of [event.revisionOf, event.supersededBy]) {
      if (relation !== undefined) {
        const related = events.find((candidate) => candidate.id === relation);
        if (!related || related.patientId !== event.patientId || related.id === event.id) {
          throw new Error('Повреждены ссылки ревизии события.');
        }
      }
    }
    if (event.kind !== 'tool-result' && event.provenance !== undefined) {
      throw new Error('Происхождение результата допустимо только для события инструмента.');
    }
    if ((event.kind === 'medication' || event.kind === 'note') && event.observations.length > 0) {
      throw new Error('Лекарственное или текстовое событие не может содержать наблюдения.');
    }
    if (event.episodeId) {
      const episode = episodes.find((candidate) => candidate.id === event.episodeId);
      if (!episode?.eventIds.includes(event.id))
        throw new Error('Повреждены ссылки события пациентского хранилища.');
    }
    if (
      event.observations.some(
        (observation) =>
          !observationIds.has(observation.id) ||
          observation.eventId !== event.id ||
          observation.patientId !== event.patientId,
      )
    ) {
      throw new Error('Повреждены ссылки наблюдений события.');
    }
    for (const observation of event.observations) {
      if (eventObservationIds.has(observation.id)) {
        throw new Error('Наблюдение связано с несколькими событиями.');
      }
      if (
        event.kind === 'tool-result' &&
        (observation.source.kind !== 'tool-result' ||
          observation.source.toolId !== event.provenance?.toolId ||
          observation.source.toolVersion !== event.provenance?.toolVersion)
      ) {
        throw new Error('Происхождение наблюдения не совпадает с результатом инструмента.');
      }
      if (event.kind === 'laboratory-result' && observation.source.kind !== 'laboratory') {
        throw new Error('Лабораторное событие содержит не лабораторное наблюдение.');
      }
      if (event.kind === 'manual-measurement' && observation.source.kind !== 'manual') {
        throw new Error('Ручное событие содержит не ручное наблюдение.');
      }
      const storedObservation = observations.find((candidate) => candidate.id === observation.id);
      if (!storedObservation || JSON.stringify(storedObservation) !== JSON.stringify(observation)) {
        throw new Error('Данные наблюдения дублируются с разными значениями.');
      }
      eventObservationIds.add(observation.id);
    }
  }
  for (const observation of observations) {
    if (!profileIds.has(observation.patientId) || !eventIds.has(observation.eventId)) {
      throw new Error('Повреждены ссылки наблюдения пациентского хранилища.');
    }
    if (!eventObservationIds.has(observation.id))
      throw new Error('Наблюдение не связано с событием.');
    for (const relation of [observation.revisionOf, observation.supersededBy]) {
      if (relation !== undefined) {
        const related = observations.find((candidate) => candidate.id === relation);
        if (
          !related ||
          related.patientId !== observation.patientId ||
          related.id === observation.id
        ) {
          throw new Error('Повреждены ссылки ревизии наблюдения.');
        }
      }
    }
  }
  return {
    schemaVersion: PATIENT_DOMAIN_SCHEMA_VERSION,
    profiles,
    episodes,
    events,
    observations,
    metricDefinitions,
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Повреждено поле ${label}.`);
  return value;
}

function optionalString(record: UnknownRecord, key: string, label: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Повреждено поле ${label}.`);
  return value;
}

function uniqueIds(ids: readonly string[], label: string): Set<string> {
  const result = new Set(ids);
  if (result.size !== ids.length) throw new Error(`Дублируются идентификаторы: ${label}.`);
  return result;
}

function validDate(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Повреждена дата: ${label}.`);
  try {
    return asDate(value, label);
  } catch {
    throw new Error(`Повреждена дата: ${label}.`);
  }
}

function normalizeProfile(value: unknown): PatientProfile {
  if (!isRecord(value)) throw new Error('Повреждена карточка пациента.');
  const biologicalSex = value['biologicalSex'];
  if (
    biologicalSex !== undefined &&
    biologicalSex !== 'female' &&
    biologicalSex !== 'male' &&
    biologicalSex !== 'intersex' &&
    biologicalSex !== 'unknown'
  ) {
    throw new Error('Поврежден биологический пол пациента.');
  }
  const localRecordNumber = optionalString(value, 'localRecordNumber', 'номер карты');
  const birthDate = optionalString(value, 'birthDate', 'дата рождения');
  const summary = optionalString(value, 'summary', 'описание');
  const context =
    value['context'] === undefined
      ? undefined
      : normalizeValueRecord(value['context'], 'контекст пациента');
  return {
    id: requiredString(value, 'id', 'идентификатор пациента'),
    displayName: requiredString(value, 'displayName', 'имя пациента'),
    ...(localRecordNumber ? { localRecordNumber } : {}),
    ...(birthDate ? { birthDate: validDate(birthDate, 'дата рождения') } : {}),
    ...(biologicalSex ? { biologicalSex } : {}),
    ...(summary ? { summary } : {}),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
    createdAt: validDate(value['createdAt'], 'создания карточки'),
    updatedAt: validDate(value['updatedAt'], 'изменения карточки'),
  };
}

function normalizeEpisode(value: unknown): ClinicalEpisode {
  if (!isRecord(value) || !Array.isArray(value['eventIds']))
    throw new Error('Повреждён осмотр пациента.');
  const eventIds = value['eventIds'].filter((id): id is string => typeof id === 'string');
  if (eventIds.length !== value['eventIds'].length) throw new Error('Повреждены события осмотра.');
  if (new Set(eventIds).size !== eventIds.length) throw new Error('События осмотра повторяются.');
  const status = value['status'] === undefined ? 'closed' : value['status'];
  if (status !== 'open' && status !== 'closed') throw new Error('Поврежден статус осмотра.');
  const closedAt =
    value['closedAt'] === undefined ? undefined : validDate(value['closedAt'], 'закрытия осмотра');
  if (status === 'open' && closedAt !== undefined)
    throw new Error('Открытый осмотр не может иметь дату закрытия.');
  return {
    id: requiredString(value, 'id', 'идентификатор осмотра'),
    patientId: requiredString(value, 'patientId', 'пациент осмотра'),
    title: requiredString(value, 'title', 'название осмотра'),
    startedAt: validDate(value['startedAt'], 'осмотра'),
    text: typeof value['text'] === 'string' ? value['text'] : '',
    eventIds,
    status,
    ...(closedAt ? { closedAt } : {}),
    createdAt: validDate(value['createdAt'], 'создания осмотра'),
    updatedAt: validDate(value['updatedAt'], 'изменения осмотра'),
  };
}

function normalizeMetricDefinition(value: unknown): PatientMetricDefinition {
  if (!isRecord(value)) throw new Error('Повреждено определение показателя пациента.');
  const kind = value['kind'];
  if (kind !== 'registry' && kind !== 'custom')
    throw new Error('Поврежден тип определения показателя.');
  return {
    id: requiredString(value, 'id', 'идентификатор определения показателя'),
    metricId: requiredString(value, 'metricId', 'идентификатор показателя'),
    label: requiredString(value, 'label', 'название показателя'),
    unit: requiredString(value, 'unit', 'единица показателя'),
    metricVersion: requiredString(value, 'metricVersion', 'версия показателя'),
    kind,
    createdAt: validDate(value['createdAt'], 'создания определения показателя'),
  };
}

function normalizeEvaluation(value: unknown): PatientEvaluationSnapshot | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !['verdict', 'missing-context', 'unavailable', 'not-applicable'].includes(
      String(value['status']),
    ) ||
    !isRecord(value['context'])
  ) {
    throw new Error('Повреждён снимок оценки результата.');
  }
  const context: Record<string, string | number> = {};
  for (const [key, contextValue] of Object.entries(value['context'])) {
    if (
      (typeof contextValue !== 'string' && typeof contextValue !== 'number') ||
      (typeof contextValue === 'number' && !Number.isFinite(contextValue))
    )
      throw new Error('Повреждён контекст оценки.');
    context[key] = contextValue;
  }
  const missingContext = normalizeStringArray(value['missingContext'], 'недостающий контекст');
  const sourceIds = normalizeStringArray(value['sourceIds'], 'источники оценки');
  const sourceLinks = normalizeSourceSnapshots(value['sourceLinks'], 'снимок источников оценки');
  const reason = optionalString(value, 'reason', 'причина оценки');
  const verdict = value['verdict'];
  if (verdict !== undefined && !ReferenceVerdictSchema.safeParse(verdict).success) {
    throw new Error('Повреждён структурированный вердикт.');
  }
  if (value['status'] === 'verdict' && verdict === undefined) {
    throw new Error('Для оценки со статусом verdict нужен структурированный вердикт.');
  }
  if (value['status'] !== 'verdict' && verdict !== undefined) {
    throw new Error('Структурированный вердикт допустим только при статусе verdict.');
  }
  return {
    status: value['status'] as EvaluationStatus,
    ...(verdict !== undefined ? { verdict: verdict as ReferenceVerdict } : {}),
    ...(missingContext ? { missingContext } : {}),
    ...(reason ? { reason } : {}),
    ...(sourceIds ? { sourceIds } : {}),
    ...(sourceLinks ? { sourceLinks } : {}),
    context,
    capturedAt: validDate(value['capturedAt'], 'оценки'),
  };
}

function normalizeStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`Повреждены ${label}.`);
  }
  return value;
}

function normalizeSourceSnapshots(
  value: unknown,
  label: string,
): readonly PatientSourceSnapshot[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`Повреждён ${label}.`);
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error(`Повреждён ${label}.`);
    const moduleId = optionalNullableString(entry, 'moduleId', `${label}: модуль`);
    const documentId = optionalNullableString(entry, 'documentId', `${label}: документ`);
    const url = optionalNullableString(entry, 'url', `${label}: ссылка`);
    if (url !== undefined && !isHttpUrl(url)) {
      throw new Error(`${label}: ссылка должна использовать http или https.`);
    }
    return {
      id: requiredString(entry, 'id', `${label}: идентификатор`),
      title: requiredString(entry, 'title', `${label}: название`),
      ...(moduleId ? { moduleId } : {}),
      ...(documentId ? { documentId } : {}),
      ...(url ? { url } : {}),
    };
  });
}

function optionalNullableString(
  record: UnknownRecord,
  key: string,
  label: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Повреждено поле ${label}.`);
  return value;
}

function normalizeObservation(value: unknown): PatientObservation {
  if (
    !isRecord(value) ||
    typeof value['value'] !== 'number' ||
    !Number.isFinite(value['value']) ||
    typeof value['source'] !== 'object' ||
    value['source'] === null
  ) {
    throw new Error('Повреждено наблюдение пациента.');
  }
  const source = value['source'] as UnknownRecord;
  const sourceKind = source['kind'];
  if (sourceKind !== 'tool-result' && sourceKind !== 'manual' && sourceKind !== 'laboratory')
    throw new Error('Поврежден источник наблюдения.');
  const normalizedSource: PatientObservationSource =
    sourceKind === 'tool-result'
      ? {
          kind: 'tool-result',
          toolId: requiredString(source, 'toolId', 'инструмент'),
          toolVersion: requiredString(source, 'toolVersion', 'версия инструмента'),
        }
      : sourceKind === 'manual'
        ? {
            kind: 'manual',
            label: requiredString(source, 'label', 'показатель'),
            metricVersion: requiredString(source, 'metricVersion', 'версия показателя'),
          }
        : {
            kind: 'laboratory',
            label: requiredString(source, 'label', 'лабораторный показатель'),
            ...(source['reportRange'] !== undefined
              ? { reportRange: normalizeLaboratoryRange(source['reportRange']) }
              : {}),
          };
  const method = optionalString(value, 'method', 'методика');
  const evaluation =
    value['evaluation'] === undefined ? undefined : normalizeEvaluation(value['evaluation']);
  const revisionOf = optionalString(value, 'revisionOf', 'исходное наблюдение');
  const supersededBy = optionalString(value, 'supersededBy', 'заменившее наблюдение');
  return {
    id: requiredString(value, 'id', 'наблюдения'),
    patientId: requiredString(value, 'patientId', 'пациент наблюдения'),
    eventId: requiredString(value, 'eventId', 'событие наблюдения'),
    metricId: requiredString(value, 'metricId', 'показатель'),
    value: value['value'],
    unit: requiredString(value, 'unit', 'единица'),
    observedAt: validDate(value['observedAt'], 'наблюдения'),
    ...(method ? { method } : {}),
    source: normalizedSource,
    ...(evaluation ? { evaluation } : {}),
    ...(revisionOf ? { revisionOf } : {}),
    ...(supersededBy ? { supersededBy } : {}),
  };
}

function normalizeEvent(value: unknown): PatientEvent {
  if (
    !isRecord(value) ||
    !Array.isArray(value['observations']) ||
    typeof value['immutable'] !== 'boolean'
  )
    throw new Error('Повреждено событие пациента.');
  if (value['observations'].some((observation) => !isRecord(observation)))
    throw new Error('Повреждены наблюдения события.');
  const kind = value['kind'];
  if (
    kind !== 'tool-result' &&
    kind !== 'manual-measurement' &&
    kind !== 'laboratory-result' &&
    kind !== 'medication' &&
    kind !== 'note'
  )
    throw new Error('Поврежден тип события пациента.');
  const episodeId = optionalString(value, 'episodeId', 'осмотр события');
  const text = optionalString(value, 'text', 'текст события');
  const revisionOf = optionalString(value, 'revisionOf', 'исходное событие');
  const supersededBy = optionalString(value, 'supersededBy', 'заменившее событие');
  const medicationKind = value['medicationKind'];
  if (
    medicationKind !== undefined &&
    medicationKind !== 'start' &&
    medicationKind !== 'take' &&
    medicationKind !== 'dose-change' &&
    medicationKind !== 'stop'
  ) {
    throw new Error('Поврежден тип лекарственного события.');
  }
  const provenance =
    value['provenance'] === undefined ? undefined : normalizeProvenance(value['provenance']);
  if (kind === 'tool-result' && (!provenance || value['immutable'] !== true)) {
    throw new Error('Результат инструмента должен быть неизменяемым и иметь происхождение.');
  }
  if (kind !== 'tool-result' && provenance !== undefined) {
    throw new Error('Происхождение результата допустимо только для события инструмента.');
  }
  if ((kind === 'medication' || kind === 'note') && value['observations'].length > 0) {
    throw new Error('Лекарственное или текстовое событие не может содержать наблюдения.');
  }
  if (kind !== 'medication' && medicationKind !== undefined)
    throw new Error('Тип лекарственного события указан не для лекарства.');
  return {
    id: requiredString(value, 'id', 'события'),
    patientId: requiredString(value, 'patientId', 'пациент события'),
    ...(episodeId ? { episodeId } : {}),
    kind,
    occurredAt: validDate(value['occurredAt'], 'события'),
    title: requiredString(value, 'title', 'название события'),
    ...(text ? { text } : {}),
    ...(medicationKind ? { medicationKind } : {}),
    ...(provenance ? { provenance } : {}),
    observations: value['observations'].map(normalizeObservation),
    immutable: value['immutable'] === true,
    ...(revisionOf ? { revisionOf } : {}),
    ...(supersededBy ? { supersededBy } : {}),
  };
}

function normalizeLaboratoryRange(value: unknown): LaboratoryRange {
  if (!isRecord(value)) throw new Error('Повреждён референсный диапазон лаборатории.');
  const lower = value['lower'];
  const upper = value['upper'];
  if (lower !== undefined && (typeof lower !== 'number' || !Number.isFinite(lower)))
    throw new Error('Повреждена нижняя граница лаборатории.');
  if (upper !== undefined && (typeof upper !== 'number' || !Number.isFinite(upper)))
    throw new Error('Повреждена верхняя граница лаборатории.');
  if (lower !== undefined && upper !== undefined && lower > upper)
    throw new Error('Перепутаны границы лаборатории.');
  const text = optionalString(value, 'text', 'текст диапазона');
  const lowerInclusive = value['lowerInclusive'];
  const upperInclusive = value['upperInclusive'];
  if (lowerInclusive !== undefined && typeof lowerInclusive !== 'boolean')
    throw new Error('Повреждена нижняя граница лаборатории.');
  if (upperInclusive !== undefined && typeof upperInclusive !== 'boolean')
    throw new Error('Повреждена верхняя граница лаборатории.');
  return {
    ...(lower === undefined ? {} : { lower }),
    ...(upper === undefined ? {} : { upper }),
    ...(lowerInclusive === undefined ? {} : { lowerInclusive }),
    ...(upperInclusive === undefined ? {} : { upperInclusive }),
    ...(text ? { text } : {}),
  };
}

function normalizeValueRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, string | number>> {
  if (!isRecord(value)) throw new Error(`Повреждён ${label}.`);
  const result: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !key.trim() ||
      (typeof entry !== 'string' && typeof entry !== 'number') ||
      (typeof entry === 'number' && !Number.isFinite(entry))
    ) {
      throw new Error(`Повреждён ${label}.`);
    }
    result[key] = entry;
  }
  return result;
}

function normalizeProvenance(value: unknown): ToolResultProvenance {
  if (!isRecord(value) || !Array.isArray(value['sourceIds']))
    throw new Error('Повреждено происхождение результата.');
  const sourceIds = value['sourceIds'];
  if (sourceIds.some((sourceId) => typeof sourceId !== 'string' || !sourceId.trim()))
    throw new Error('Повреждено происхождение результата.');
  const sourceLinks = normalizeSourceSnapshots(
    value['sourceLinks'],
    'снимок источников результата',
  );
  return {
    toolId: requiredString(value, 'toolId', 'инструмент'),
    toolVersion: requiredString(value, 'toolVersion', 'версия инструмента'),
    definitionVersion: requiredString(value, 'definitionVersion', 'версия определения'),
    sourceIds,
    ...(sourceLinks ? { sourceLinks } : {}),
    idempotencyKey: requiredString(value, 'idempotencyKey', 'идентификатор результата'),
    normalizedInputs: normalizeValueRecord(value['normalizedInputs'], 'входы результата'),
    contextSnapshot: normalizeValueRecord(value['contextSnapshot'], 'снимок контекста'),
  };
}

export type { ToolEvaluation };
