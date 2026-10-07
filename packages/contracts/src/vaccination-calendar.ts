import { z } from 'zod';

/**
 * Vaccination calendars of Минздрав order 1122н with every amendment in force (docs/research/
 * vax1-transcription-2026-10-05.md). Generated from the official publication by the deterministic
 * preparer (tools/ingest, `localmed_ingest.vaccination_calendar`); interpreted by a generic renderer.
 * The wording of every cell is the printed wording; the structured fields on a national-calendar
 * item (`infectionKey`, `steps`, `qualifier`, `condition`) are parsed from that wording by the
 * preparer, never typed by hand. Each row cites the PDF page of the official file it is printed on.
 */

export const VACCINATION_CALENDAR_SCHEMA_VERSION = 2 as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'must be an ISO date');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u, 'must be a lowercase SHA-256');
const eoNumber = z.string().regex(/^\d{16}$/u, 'must be a portal eoNumber');
const nonEmpty = z.string().refine((value) => value.trim().length > 0, 'must not be empty');
const rowId = z.string().regex(/^[nep]-\d{2}(-\d+)?$/u, 'must be a stable row identifier');

export const VaccinationPopulationSchema = z.enum(['children', 'adults', 'both']);
export type VaccinationPopulation = z.infer<typeof VaccinationPopulationSchema>;

export const VaccinationSourceRefSchema = z
  .object({
    eoNumber,
    appendix: z.enum(['1', '2', '3']),
    pdfPages: z.array(z.number().int().min(1)).min(1),
    /** Opens the official PDF at the first page of the row. */
    url: z.string().url(),
  })
  .strict();
export type VaccinationSourceRef = z.infer<typeof VaccinationSourceRefSchema>;

export const VaccinationVerificationSchema = z
  .object({
    /** Share of the transcribed words the OCR of the same pages found. */
    ocrCoverage: z.number().min(0).max(1),
    /** Words the OCR did not find; read from the scan instead. Empty when none. */
    ocrUnmatchedWords: z.array(z.string()),
  })
  .strict();

export const VaccinationStepSchema = z
  .object({
    kind: z.enum(['vaccination', 'revaccination']),
    /** «Первая» … «Четвертая» as printed; `null` when the order names no number. */
    ordinal: z.number().int().min(1).max(4).nullable(),
  })
  .strict();
export type VaccinationStep = z.infer<typeof VaccinationStepSchema>;

/** A vaccine the order names for one step (paragraph of Appendix 3), e.g. «ИПВ» or «ОПВ». */
export const VaccinationProductSchema = z
  .object({
    code: nonEmpty,
    label: nonEmpty,
    /** The code for children of risk groups when it differs from `code`. */
    riskCode: nonEmpty.nullable(),
    /** Paragraph of Appendix 3 the product is named in. */
    procedureNumber: z.string().regex(/^\d+$/u),
  })
  .strict();
export type VaccinationProduct = z.infer<typeof VaccinationProductSchema>;

/**
 * Who a chart cell is for: `all` (everyone of the age), `risk` (groups of risk the order names),
 * `catch-up` (persons not vaccinated before). Declared by the preparer from the printed wording.
 */
export const VaccinationBandSchema = z.enum(['all', 'risk', 'catch-up']);
export type VaccinationBand = z.infer<typeof VaccinationBandSchema>;

const targetKey = z.string().regex(/^[a-z][a-z0-9-]*$/u);

export const NationalItemSchema = z
  .object({
    id: rowId,
    /** The printed wording of the cell. */
    text: nonEmpty,
    infectionKey: z.string().regex(/^[a-z][a-z0-9-]*$/u),
    infection: nonEmpty,
    /** Rows of the chart (`national.chart.targets`) this vaccination is shown in. */
    targets: z.array(targetKey).min(1),
    band: VaccinationBandSchema,
    /**
     * Ages of a category row whose band differs from `band` (months, `toMonths` inclusive): row 19
     * is for every child from 6 months, for named groups of adults. Absent when the band is uniform.
     */
    bandSpans: z
      .array(
        z
          .object({
            fromMonths: z.number().nonnegative(),
            toMonths: z.number().nonnegative().nullable(),
            band: VaccinationBandSchema,
          })
          .strict(),
      )
      .min(1)
      .optional(),
    steps: z.array(VaccinationStepSchema).min(1),
    /** The printed «(группы риска)». */
    qualifier: z.string().nullable(),
    /** The printed condition after a dash. */
    condition: z.string().nullable(),
    /** The vaccine the order names for the step; `null` when it names none. */
    product: VaccinationProductSchema.nullable(),
  })
  .strict();
export type NationalItem = z.infer<typeof NationalItemSchema>;

export const NationalRowSchema = z
  .object({
    id: rowId,
    number: z.string().regex(/^\d+$/u),
    category: nonEmpty,
    ageLabel: nonEmpty,
    /**
     * The age a row names: months from birth, or the day of life counted with the day of birth as
     * day 1. `null` for a category row.
     */
    age: z
      .object({
        unit: z.enum(['months', 'day-of-life']),
        from: z.number().min(0),
        to: z.number().min(0),
      })
      .strict()
      .nullable(),
    population: VaccinationPopulationSchema,
    /**
     * Category rows only: the age (months) from which the category applies; `toMonths` is `null`
     * when it runs on into adulthood. `null` for an age row.
     */
    ageSpan: z
      .object({ fromMonths: z.number().min(0), toMonths: z.number().min(0).nullable() })
      .strict()
      .nullable(),
    items: z.array(NationalItemSchema).min(1),
    source: VaccinationSourceRefSchema,
    verification: VaccinationVerificationSchema,
  })
  .strict();
export type NationalRow = z.infer<typeof NationalRowSchema>;

export const VaccinationBlockSchema = z
  .object({ kind: z.enum(['paragraph', 'bullet']), text: nonEmpty })
  .strict();
export type VaccinationBlock = z.infer<typeof VaccinationBlockSchema>;

export const EpidemicRowSchema = z
  .object({
    id: rowId,
    number: z.string().regex(/^\d+$/u),
    vaccine: z.string().startsWith('Против '),
    target: nonEmpty,
    categories: z.array(VaccinationBlockSchema).min(1),
    population: VaccinationPopulationSchema,
    source: VaccinationSourceRefSchema,
    verification: VaccinationVerificationSchema,
    /** Set when an amending order replaced the row; the earlier text is kept below. */
    amendedBy: z.string().optional(),
    previousEdition: z
      .object({
        categories: z.array(VaccinationBlockSchema).min(1),
        source: VaccinationSourceRefSchema,
        verification: VaccinationVerificationSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type EpidemicRow = z.infer<typeof EpidemicRowSchema>;

export const ProcedureItemSchema = z
  .object({
    id: rowId,
    number: z.string().regex(/^\d+$/u),
    /** `general` for a rule of every vaccination, otherwise the infection keys it is about. */
    appliesTo: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/u)).min(1),
    blocks: z.array(nonEmpty).min(1),
    source: VaccinationSourceRefSchema,
    verification: VaccinationVerificationSchema,
    footnote: z
      .object({
        number: z.number().int().min(1),
        text: nonEmpty,
        verification: VaccinationVerificationSchema,
      })
      .strict()
      .optional(),
    amendedBy: z.string().optional(),
  })
  .strict();
export type ProcedureItem = z.infer<typeof ProcedureItemSchema>;

export const VaccinationSourceFileSchema = z
  .object({
    role: z.enum(['order', 'amendment']),
    eoNumber,
    orderNumber: nonEmpty,
    orderDate: isoDate,
    title: nonEmpty,
    registration: z.object({ number: nonEmpty, date: isoDate }).strict(),
    publicationUrl: z.string().url(),
    pdfUrl: z.string().url(),
    pagesCount: z.number().int().min(1),
    bytes: z.number().int().min(1),
    sha256,
    retrievedAt: isoDate,
  })
  .strict();
export type VaccinationSourceFile = z.infer<typeof VaccinationSourceFileSchema>;

const columns = z.tuple([nonEmpty, nonEmpty, nonEmpty]);

export const VaccinationCalendarSchema = z
  .object({
    schemaVersion: z.literal(VACCINATION_CALENDAR_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z][a-z0-9.-]*$/u),
    title: nonEmpty,
    edition: z
      .object({
        /** Printed on the screens and the print: «по приказу № 1122н в ред. приказа № 677н». */
        editionLine: nonEmpty,
        label: nonEmpty,
        inForceFrom: isoDate,
        validUntil: isoDate,
        /** Date the portal was last asked for amending orders. */
        checkedOn: isoDate,
        amendingOrders: z.array(nonEmpty),
        searchNote: nonEmpty,
      })
      .strict(),
    sources: z.array(VaccinationSourceFileSchema).min(1),
    national: z
      .object({
        appendix: z.literal('1'),
        title: nonEmpty,
        columns,
        /** Infections of the chart, in the order of its rows. */
        chart: z
          .object({
            targets: z.array(z.object({ key: targetKey, label: nonEmpty }).strict()).min(1),
          })
          .strict(),
        rows: z.array(NationalRowSchema).min(1),
      })
      .strict(),
    epidemic: z
      .object({
        appendix: z.literal('2'),
        title: nonEmpty,
        columns,
        rows: z.array(EpidemicRowSchema).min(1),
      })
      .strict(),
    procedure: z
      .object({
        appendix: z.literal('3'),
        title: nonEmpty,
        items: z.array(ProcedureItemSchema).min(1),
      })
      .strict(),
    review: z
      .object({
        transcription: nonEmpty,
        ocrMethod: nonEmpty,
        /** `none` until a clinician has checked the transcription. */
        clinicalReview: z.enum(['none', 'done']),
        notes: z.array(nonEmpty),
      })
      .strict(),
  })
  .strict()
  .superRefine((calendar, context) => {
    const known = new Map(calendar.sources.map((source) => [source.eoNumber, source.pagesCount]));
    const units = [
      ...calendar.national.rows,
      ...calendar.epidemic.rows,
      ...calendar.procedure.items,
    ];
    const seen = new Set<string>();
    for (const unit of units) {
      if (seen.has(unit.id)) {
        context.addIssue({ code: 'custom', message: `duplicate row id ${unit.id}` });
      }
      seen.add(unit.id);
      const pages = known.get(unit.source.eoNumber);
      if (pages === undefined) {
        context.addIssue({ code: 'custom', message: `${unit.id}: source file is not listed` });
      } else if (unit.source.pdfPages.some((page) => page > pages)) {
        context.addIssue({ code: 'custom', message: `${unit.id}: page beyond the file` });
      }
      if (!unit.source.url.includes(`eoNumber=${unit.source.eoNumber}`)) {
        context.addIssue({ code: 'custom', message: `${unit.id}: link points at another file` });
      }
    }
    const targets = new Set(calendar.national.chart.targets.map((target) => target.key));
    if (targets.size !== calendar.national.chart.targets.length) {
      context.addIssue({ code: 'custom', message: 'chart targets repeat' });
    }
    const paragraphs = new Set(calendar.procedure.items.map((item) => item.number));
    for (const row of calendar.national.rows) {
      if (row.age && row.age.to < row.age.from) {
        context.addIssue({ code: 'custom', message: `${row.id}: age range is reversed` });
      }
      if (row.age && row.ageSpan) {
        context.addIssue({ code: 'custom', message: `${row.id}: an age row has no age span` });
      }
      if (row.ageSpan?.toMonths != null && row.ageSpan.toMonths < row.ageSpan.fromMonths) {
        context.addIssue({ code: 'custom', message: `${row.id}: age span is reversed` });
      }
      for (const item of row.items) {
        if (item.targets.some((target) => !targets.has(target))) {
          context.addIssue({ code: 'custom', message: `${item.id}: unknown chart target` });
        }
        if (item.product && !paragraphs.has(item.product.procedureNumber)) {
          context.addIssue({ code: 'custom', message: `${item.id}: product paragraph is missing` });
        }
      }
    }
  });
export type VaccinationCalendar = z.infer<typeof VaccinationCalendarSchema>;

export function parseVaccinationCalendar(value: unknown): VaccinationCalendar {
  return VaccinationCalendarSchema.parse(value);
}
