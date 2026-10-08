import { z } from 'zod';

import { parseIsoDate } from '@/features/vaccination/vaccination-plan';
import { addPatientBlob, readPatientBlob } from '@/state/patient-vault';

/**
 * What a child has had and what is planned: the marks of the vaccination calendar, kept with the
 * child's patient card. The card is the patient record (ADR-0016): the birth date and the name stay
 * in the profile; the card keeps only the marks, as a patient file of the vault (like the diary
 * ledger), protected with the vault, removed with the card and carried by the card backup. A mark
 * belongs to one vaccination of the calendar (an item id such as `n-05-1`), so a vaccination that
 * covers several infections is marked once.
 */

export const VACCINATION_RECORD_SCHEMA_VERSION = 1 as const;
const MIME = 'application/json';

const ISO_DATE = z.string().refine((value) => parseIsoDate(value) !== undefined, {
  message: 'must be an ISO date',
});
const ISO_INSTANT = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'must be an ISO date-time',
});

export const DOSE_MARK_STATES = ['done', 'planned'] as const;
export type DoseMarkState = (typeof DOSE_MARK_STATES)[number];

export const DoseMarkSchema = z
  .object({
    state: z.enum(DOSE_MARK_STATES),
    /** When it was given or when it is planned; `null` when the doctor did not note a date. */
    date: ISO_DATE.nullable(),
  })
  .strict();
export type DoseMark = z.infer<typeof DoseMarkSchema>;

/** Marks by vaccination (calendar item id). */
export type DoseMarks = Readonly<Record<string, DoseMark>>;

export const VaccinationRecordSchema = z
  .object({
    kind: z.literal('minimed-vaccination-record'),
    schemaVersion: z.literal(VACCINATION_RECORD_SCHEMA_VERSION),
    /** `id` of the calendar data the marks were made against. */
    calendarId: z.string().min(1),
    marks: z.record(z.string().min(1), DoseMarkSchema),
    updatedAt: ISO_INSTANT,
  })
  .strict();
export type VaccinationRecord = z.infer<typeof VaccinationRecordSchema>;

export class VaccinationRecordError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VaccinationRecordError';
  }
}

export function recordBlobId(patientId: string): string {
  return `vaccination-record-${patientId}`;
}

/** The mark a tap gives next: nothing → done → planned → nothing. */
export function nextMarkState(current: DoseMarkState | undefined): DoseMarkState | undefined {
  if (current === undefined) return 'done';
  return current === 'done' ? 'planned' : undefined;
}

/** `marks` with one vaccination set (keeping a date it already has) or cleared. */
export function withMark(
  marks: DoseMarks,
  itemId: string,
  state: DoseMarkState | undefined,
  date?: string | null,
): DoseMarks {
  const { [itemId]: previous, ...rest } = marks;
  if (state === undefined) return rest;
  return {
    ...rest,
    [itemId]: { state, date: date === undefined ? (previous?.date ?? null) : date },
  };
}

/**
 * What one tap or choice does to a vaccination: its new state with the date that goes with it. A
 * dose turned «done» is dated `today` (the doctor corrects it in the dose sheet); a plan keeps the
 * date of an earlier plan, never the date of a dose that was given. Choosing the state it already
 * has changes nothing.
 */
export function markedAs(
  marks: DoseMarks,
  itemId: string,
  state: DoseMarkState | undefined,
  today: string,
): DoseMarks {
  const previous = marks[itemId];
  if (state === undefined || previous?.state === state) return withMark(marks, itemId, state);
  const date = state === 'done' ? today : previous?.state === 'planned' ? previous.date : null;
  return withMark(marks, itemId, state, date);
}

/** `marks` with the same state set for several vaccinations at once; dates already noted stay. */
export function withMarks(
  marks: DoseMarks,
  itemIds: readonly string[],
  state: DoseMarkState,
): DoseMarks {
  return itemIds.reduce((current, id) => withMark(current, id, state), marks);
}

export function buildRecord(calendarId: string, marks: DoseMarks, now: Date): VaccinationRecord {
  return {
    kind: 'minimed-vaccination-record',
    schemaVersion: VACCINATION_RECORD_SCHEMA_VERSION,
    calendarId,
    marks: { ...marks },
    updatedAt: now.toISOString(),
  };
}

/** Validates stored text; a damaged record is reported, never half-read. */
export function parseRecord(text: string): VaccinationRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new VaccinationRecordError('Отметки о прививках повреждены.', { cause });
  }
  const parsed = VaccinationRecordSchema.safeParse(value);
  if (!parsed.success) throw new VaccinationRecordError('Отметки о прививках повреждены.');
  return parsed.data;
}

export async function loadRecord(patientId: string): Promise<VaccinationRecord | undefined> {
  const blob = await readPatientBlob(recordBlobId(patientId));
  return blob ? parseRecord(new TextDecoder().decode(blob.bytes)) : undefined;
}

export async function saveRecord(patientId: string, record: VaccinationRecord): Promise<void> {
  await addPatientBlob({
    id: recordBlobId(patientId),
    patientId,
    mimeType: MIME,
    bytes: new TextEncoder().encode(JSON.stringify(VaccinationRecordSchema.parse(record))),
  });
}
