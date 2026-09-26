import {
  type DiaryEntry,
  type DiaryField,
  type DiaryInvitation,
  type DiaryPlanValue,
  type DiaryResults,
  describeDiaryValue,
  planItem,
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

function isPlanValue(value: unknown): value is DiaryPlanValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function observationsFor(
  invitation: DiaryInvitation,
  entry: DiaryEntry,
  eventId: string,
  patientId: string,
): PatientObservation[] {
  return invitation.fields.flatMap((field): PatientObservation[] => {
    const value = entry.values[field.id];
    if (field.type !== 'number' || !field.metric || typeof value !== 'number') return [];
    const unit = field.metric.unit ?? field.unit ?? '';
    return [
      {
        id: `${eventId}-${field.metric.metricId}`,
        patientId,
        eventId,
        metricId: field.metric.metricId,
        value: Math.round(value * (field.metric.factor ?? 1) * 1000) / 1000,
        unit,
        observedAt: entry.at,
        method: DIARY_OBSERVATION_METHOD,
        source: { kind: 'manual', label: field.metric.label, metricVersion: '1' },
      },
    ];
  });
}

function isTrackedPlan(field: DiaryField, value: unknown): value is DiaryPlanValue {
  return (
    field.type === 'plan' &&
    field.trackDone === true &&
    isPlanValue(value) &&
    value.done !== undefined
  );
}

/**
 * Patient events for a scanned diary. Measurements become card observations, a tracked
 * medicine intake becomes a medication event, everything else is kept verbatim as text.
 * Event ids derive from the diary, entry and field ids, so rescanning cannot duplicate records.
 */
export function diaryImportEvents(
  results: DiaryResults,
  patientId: string,
  episodeId?: string,
): readonly PatientEvent[] {
  const { invitation } = results;
  const episode = episodeId ? { episodeId } : {};
  return results.entries.flatMap((entry): PatientEvent[] => {
    const id = `diary-${invitation.id}-${entry.id}`;
    const observations = observationsFor(invitation, entry, id, patientId);
    const measured = new Set(
      invitation.fields.filter((field) => field.metric).map((field) => field.id),
    );
    const textLines = invitation.fields.flatMap((field) => {
      const value = entry.values[field.id];
      if (value === undefined || measured.has(field.id) || isTrackedPlan(field, value)) return [];
      return [describeDiaryValue(invitation, field, value)];
    });
    const text = [...textLines, entry.note].filter(Boolean).join('. ');
    const events: PatientEvent[] = [];
    if (observations.length > 0) {
      events.push({
        id,
        patientId,
        ...episode,
        kind: 'manual-measurement',
        occurredAt: entry.at,
        title: `${invitation.title} (дневник пациента)`,
        ...(text ? { text } : {}),
        observations,
        immutable: false,
      });
    } else if (text) {
      events.push({
        id,
        patientId,
        ...episode,
        kind: 'note',
        occurredAt: entry.at,
        title: `${invitation.title} (дневник пациента)`,
        text,
        observations: [],
        immutable: false,
      });
    }
    for (const field of invitation.fields) {
      const value = entry.values[field.id];
      if (!isTrackedPlan(field, value)) continue;
      const item = planItem(invitation, value.item);
      const name = item?.name ?? value.other ?? field.label;
      const details = [item?.dose, entry.note].filter(Boolean).join('. ');
      const eventId = `${id}-${field.id}`;
      if (value.done) {
        events.push(
          createMedicationEvent({
            id: eventId,
            patientId,
            ...episode,
            occurredAt: entry.at,
            medicationKind: 'take',
            title: name,
            text: ['Приём отмечен пациентом в дневнике', details].filter(Boolean).join('. '),
          }),
        );
      } else {
        // A missed dose is not an intake; keep it as an explicit text event.
        events.push({
          id: eventId,
          patientId,
          ...episode,
          kind: 'note',
          occurredAt: entry.at,
          title: `Пропущен приём: ${name}`,
          text: ['Отмечено пациентом в дневнике', details].filter(Boolean).join('. '),
          observations: [],
          immutable: false,
        });
      }
    }
    return events;
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
