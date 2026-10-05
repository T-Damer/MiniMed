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
  /** Records that were not in the card yet. */
  readonly added: number;
  /** Records the patient corrected after an earlier import; the card now shows the corrected one. */
  readonly updated: number;
  /** Records identical to what the card already holds. */
  readonly alreadyPresent: number;
  /** Corrected records that could not be updated because their visit is closed. */
  readonly blocked: number;
}

function observationKey(event: PatientEvent): string {
  return event.observations
    .map(
      (observation) =>
        `${observation.metricId}=${observation.value}${observation.unit}@${observation.observedAt}`,
    )
    .toSorted()
    .join('|');
}

/** Same content regardless of which visit the record is attached to. */
function sameDiaryRecord(left: PatientEvent, right: PatientEvent): boolean {
  return (
    left.kind === right.kind &&
    left.occurredAt === right.occurredAt &&
    left.title === right.title &&
    (left.text ?? '') === (right.text ?? '') &&
    (left.medicationKind ?? '') === (right.medicationKind ?? '') &&
    observationKey(left) === observationKey(right)
  );
}

const REVISION_MARKER = 'Исправлено пациентом, ранее:';

/** Text of a record without the trailing «corrected by the patient» history. */
function baseText(event: PatientEvent): string {
  const text = event.text ?? '';
  const cut = text.indexOf(REVISION_MARKER);
  return cut < 0 ? text : text.slice(0, cut).replace(/\. $/u, '');
}

function describeRecord(event: PatientEvent): string {
  const values = event.observations.map(
    (observation) =>
      `${observation.source.kind === 'manual' ? observation.source.label : observation.metricId}: ${observation.value} ${observation.unit}`,
  );
  return [event.kind === 'medication' ? event.title : undefined, ...values, baseText(event)]
    .filter(Boolean)
    .join('; ');
}

/** The card's own copy of a diary record, replaced by the patient's corrected version. */
function reviseDiaryRecord(
  snapshot: PatientVaultSnapshot,
  existing: PatientEvent,
  incoming: PatientEvent,
): PatientVaultSnapshot {
  const episode = existing.episodeId
    ? snapshot.episodes.find((candidate) => candidate.id === existing.episodeId)
    : undefined;
  if (episode && episode.status !== 'open') throw new DiaryRecordLockedError();
  const previous = describeRecord(existing);
  const text = [incoming.text, `${REVISION_MARKER} ${previous}`].filter(Boolean).join('. ');
  const oldObservationIds = new Set(existing.observations.map((observation) => observation.id));
  const base: PatientVaultSnapshot = {
    ...snapshot,
    events: snapshot.events.filter((candidate) => candidate.id !== existing.id),
    observations: snapshot.observations.filter(
      (observation) => !oldObservationIds.has(observation.id),
    ),
    episodes: snapshot.episodes.map((candidate) =>
      candidate.id === existing.episodeId
        ? { ...candidate, eventIds: candidate.eventIds.filter((id) => id !== existing.id) }
        : candidate,
    ),
  };
  const { episodeId: _ignored, ...withoutEpisode } = incoming;
  return appendEvent(base, {
    ...withoutEpisode,
    ...(existing.episodeId ? { episodeId: existing.episodeId } : {}),
    text,
  });
}

class DiaryRecordLockedError extends Error {}

export function applyDiaryImport(
  snapshot: PatientVaultSnapshot,
  events: readonly PatientEvent[],
): DiaryImportOutcome {
  let next = snapshot;
  let added = 0;
  let updated = 0;
  let alreadyPresent = 0;
  let blocked = 0;
  for (const event of events) {
    const existing = next.events.find((candidate) => candidate.id === event.id);
    if (!existing) {
      next = appendEvent(next, event);
      added += 1;
      continue;
    }
    if (existing.immutable || sameDiaryRecord(existing, event) || isRevised(existing, event)) {
      alreadyPresent += 1;
      continue;
    }
    try {
      next = reviseDiaryRecord(next, existing, event);
      updated += 1;
    } catch (cause) {
      if (!(cause instanceof DiaryRecordLockedError)) throw cause;
      blocked += 1;
    }
  }
  return { snapshot: next, added, updated, alreadyPresent, blocked };
}

/** A corrected record carries «Исправлено пациентом» text; the same correction is not applied twice. */
function isRevised(existing: PatientEvent, incoming: PatientEvent): boolean {
  if (!(existing.text ?? '').includes(REVISION_MARKER)) return false;
  return (
    existing.kind === incoming.kind &&
    existing.occurredAt === incoming.occurredAt &&
    existing.title === incoming.title &&
    baseText(existing) === (incoming.text ?? '') &&
    observationKey(existing) === observationKey(incoming)
  );
}

export interface DiaryImportPreview {
  readonly added: number;
  readonly updated: number;
  readonly alreadyPresent: number;
}

/** What importing would do, without changing the card. */
export function previewDiaryImport(
  snapshot: PatientVaultSnapshot,
  events: readonly PatientEvent[],
): DiaryImportPreview {
  let added = 0;
  let updated = 0;
  let alreadyPresent = 0;
  for (const event of events) {
    const existing = snapshot.events.find((candidate) => candidate.id === event.id);
    if (!existing) added += 1;
    else if (existing.immutable || sameDiaryRecord(existing, event) || isRevised(existing, event)) {
      alreadyPresent += 1;
    } else updated += 1;
  }
  return { added, updated, alreadyPresent };
}

/** The card (if any) that already holds records of this diary, from event ids and its issue ledger. */
export function diaryEventOwner(
  snapshot: PatientVaultSnapshot,
  diaryId: string,
): string | undefined {
  const prefix = `diary-${diaryId}-`;
  return snapshot.events.find((event) => event.id.startsWith(prefix))?.patientId;
}
