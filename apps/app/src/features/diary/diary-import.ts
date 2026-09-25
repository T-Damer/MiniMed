import {
  type DiaryResults,
  GLUCOSE_CONTEXT_LABEL,
  isBloodPressureEntry,
  isGlucoseEntry,
} from '@/features/diary/diary-model';
import {
  appendEvent,
  createMedicationEvent,
  type PatientEvent,
  type PatientObservation,
  type PatientVaultSnapshot,
} from '@/state/patient-domain';

/** Marks every imported observation as patient-reported rather than measured by the doctor. */
export const DIARY_OBSERVATION_METHOD = 'Дневник пациента';

const GLUCOSE_METRIC = {
  metricId: 'capillary-glucose',
  label: 'Глюкоза (глюкометр)',
  unit: 'ммоль/л',
} as const;

interface MeasurementInput {
  readonly metricId: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
}

function measurementEvent(
  base: {
    readonly id: string;
    readonly patientId: string;
    readonly episodeId?: string;
    readonly occurredAt: string;
    readonly title: string;
    readonly method: string;
    readonly text?: string;
  },
  measurements: readonly MeasurementInput[],
): PatientEvent {
  const observations = measurements.map(
    (measurement): PatientObservation => ({
      id: `${base.id}-${measurement.metricId}`,
      patientId: base.patientId,
      eventId: base.id,
      metricId: measurement.metricId,
      value: measurement.value,
      unit: measurement.unit,
      observedAt: base.occurredAt,
      method: base.method,
      source: { kind: 'manual', label: measurement.label, metricVersion: '1' },
    }),
  );
  return {
    id: base.id,
    patientId: base.patientId,
    ...(base.episodeId ? { episodeId: base.episodeId } : {}),
    kind: 'manual-measurement',
    occurredAt: base.occurredAt,
    title: base.title,
    ...(base.text ? { text: base.text } : {}),
    observations,
    immutable: false,
  };
}

/**
 * Patient events for a scanned diary. Event ids derive from the diary and entry ids, so scanning
 * the same codes twice cannot duplicate records.
 */
export function diaryImportEvents(
  results: DiaryResults,
  patientId: string,
  episodeId?: string,
): readonly PatientEvent[] {
  const { invitation } = results;
  const episode = episodeId ? { episodeId } : {};
  return results.entries.map((entry): PatientEvent => {
    const id = `diary-${invitation.id}-${entry.id}`;
    const common = { id, patientId, ...episode, occurredAt: entry.at };
    if (isBloodPressureEntry(entry)) {
      return measurementEvent(
        {
          ...common,
          title: 'Давление (дневник пациента)',
          method: DIARY_OBSERVATION_METHOD,
          ...(entry.note ? { text: entry.note } : {}),
        },
        [
          {
            metricId: 'blood-pressure-systolic',
            label: 'Давление: систолическое',
            unit: 'мм рт. ст.',
            value: entry.systolic,
          },
          {
            metricId: 'blood-pressure-diastolic',
            label: 'Давление: диастолическое',
            unit: 'мм рт. ст.',
            value: entry.diastolic,
          },
          ...(entry.pulse === undefined
            ? []
            : [{ metricId: 'pulse', label: 'Пульс', unit: 'уд/мин', value: entry.pulse }]),
        ],
      );
    }
    if (isGlucoseEntry(entry)) {
      return measurementEvent(
        {
          ...common,
          title: 'Глюкоза (дневник пациента)',
          method: `${DIARY_OBSERVATION_METHOD}, ${GLUCOSE_CONTEXT_LABEL[entry.context]}`,
          ...(entry.note ? { text: entry.note } : {}),
        },
        [{ ...GLUCOSE_METRIC, value: entry.mmol }],
      );
    }
    const medication = invitation.medications?.[entry.medication];
    const name = medication?.name ?? 'Препарат';
    const details = [medication?.dose, entry.note].filter(Boolean).join('. ');
    if (entry.taken) {
      return createMedicationEvent({
        ...common,
        medicationKind: 'take',
        title: name,
        text: ['Приём отмечен пациентом в дневнике', details].filter(Boolean).join('. '),
      });
    }
    // A missed dose is not an intake; keep it as an explicit text event.
    return {
      id,
      patientId,
      ...episode,
      kind: 'note',
      occurredAt: entry.at,
      title: `Пропущен приём: ${name}`,
      text: ['Отмечено пациентом в дневнике', details].filter(Boolean).join('. '),
      observations: [],
      immutable: false,
    };
  });
}

export interface DiaryImportOutcome {
  readonly snapshot: PatientVaultSnapshot;
  readonly added: number;
  readonly alreadyPresent: number;
}

export function applyDiaryImport(
  snapshot: PatientVaultSnapshot,
  events: readonly PatientEvent[],
): DiaryImportOutcome {
  let next = snapshot;
  let alreadyPresent = 0;
  for (const event of events) {
    if (next.events.some((candidate) => candidate.id === event.id)) {
      alreadyPresent += 1;
      continue;
    }
    next = appendEvent(next, event);
  }
  return { snapshot: next, added: events.length - alreadyPresent, alreadyPresent };
}
