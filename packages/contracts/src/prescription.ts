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
