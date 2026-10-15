import { z } from 'zod';

/**
 * A prescription draft (RX1): the items chosen, the patient facts they were computed for and the
 * blank they print on. It holds no instruction text and no dose that was not computed from a rule
 * (the rule is referenced by key); a draft with a patient lives only inside the encrypted patient
 * vault, a draft without one holds no personal data and may live in the browser's own storage.
 */
export const PRESCRIPTION_DRAFT_VERSION = 1 as const;

const optionalNumber = z.number().finite().nullable();

export const prescriptionItemSchema = z
  .object({
    id: z.string().min(1),
    /** Slug of the ЕСКЛП МНН card, without «esklp.mnn.». */
    slug: z.string().min(1),
    label: z.string(),
    form: z.string().nullable(),
    strength: z.string().nullable(),
    documentId: z.string().nullable(),
    ruleKey: z.string().nullable(),
    position: z.union([z.literal('min'), z.literal('max')]).nullable(),
    intakesPerDay: optionalNumber,
    singleOverride: optionalNumber,
    days: optionalNumber,
    packSize: optionalNumber,
    signa: z.string().nullable(),
    rp: z.string().nullable(),
  })
  .strict();

export const prescriptionPatientSchema = z
  .object({
    ageDays: optionalNumber,
    /** The age as the doctor typed it («5», «8 мес»): shown again after a reload, `ageDays` is derived from it. */
    ageInput: z.string().max(40).nullable().optional(),
    group: z.union([z.literal('adult'), z.literal('child')]).nullable(),
    weightKg: optionalNumber,
    heightCm: optionalNumber,
    pregnant: z.boolean(),
    lactating: z.boolean(),
  })
  .strict();

export const prescriptionDraftSchema = z
  .object({
    kind: z.literal('minimed-prescription-draft'),
    version: z.literal(PRESCRIPTION_DRAFT_VERSION),
    items: z.array(prescriptionItemSchema).max(20),
    patient: prescriptionPatientSchema,
    /** Id of the form schema the blank is printed on. */
    formId: z.string().min(1),
    status: z.union([z.literal('draft'), z.literal('saved')]),
    updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
      message: 'must be an ISO date-time',
    }),
    savedAt: z.string().optional(),
  })
  .strict();

export type PrescriptionItem = z.infer<typeof prescriptionItemSchema>;
export type PrescriptionPatient = z.infer<typeof prescriptionPatientSchema>;
export type PrescriptionDraft = z.infer<typeof prescriptionDraftSchema>;

/** Validates stored text; a damaged draft is reported, never half-read. */
export function parsePrescriptionDraft(text: string): PrescriptionDraft {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error('Черновик назначения повреждён.', { cause });
  }
  const parsed = prescriptionDraftSchema.safeParse(value);
  if (!parsed.success) throw new Error('Черновик назначения повреждён.');
  return parsed.data;
}

/**
 * The settings of the prescription tool and of the dose card in search (RX4). They are release data
 * (`apps/app/src/features/prescription/data/prescription-settings.json`), not a user preference.
 *
 * - `computedDoses`: the numbers the tool works out from the dose sentences of an instruction (single
 *   and daily dose for the patient, units per intake, caps compared, quantity and packages). `false`
 *   ships the tool with the sentences quoted only: forms, the blank and the recipe text stay, nothing
 *   is computed. A release turns it off when the independent audit of the computed doses fails.
 */
export const prescriptionSettingsSchema = z
  .object({
    computedDoses: z.boolean(),
  })
  .strict();

export type PrescriptionSettings = z.infer<typeof prescriptionSettingsSchema>;

/** Validates the shipped settings once; a malformed file is an error, never a silent «on». */
export function parsePrescriptionSettings(value: unknown): PrescriptionSettings {
  const parsed = prescriptionSettingsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Prescription settings: ${parsed.error.issues[0]?.message ?? 'malformed'}`);
  }
  return parsed.data;
}
