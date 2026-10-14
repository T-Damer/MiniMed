import { z } from 'zod';

/**
 * Dose rules (RX1): what the «Способ применения и дозы» sections of the installed official
 * instructions state about a dose, read by pattern parsers at build time and again, with the same
 * parsers, on the instruction that is open. A rule never holds instruction text: it holds the
 * numbers that were read and the offsets of the sentence they were read from, in the canonical text
 * of the section (its chunks joined by a line feed), plus a checksum of that text. The app quotes
 * the sentence from the installed document next to every number it computes.
 *
 * Anything the parsers do not read with confidence is not a rule: the screen then shows the quoted
 * section instead.
 */

export const DOSE_RULES_SCHEMA_VERSION = 1 as const;

/** Units a dose is written in; `DoseRule.u` is an index into this list. */
export const DOSE_UNITS = ['mg', 'ml', 'IU', 'U', 'mmol', 'drop', 'dose', 'piece'] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

/** What a counted piece is (`DoseRule.qu`), for the sign text. */
export const PIECE_KINDS = [
  'tablet',
  'capsule',
  'suppository',
  'sachet',
  'ampoule',
  'lozenge',
  'patch',
  'measure',
  'spoon',
  'other',
] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

/** Rule kinds (`DoseRule.k`). */
export const RULE_DOSE = 0;
export const RULE_CAP = 1;
export const RULE_DURATION = 2;

/** `DoseRule.g`: the population words of the sentence. */
export const GROUP_ADULT = 1;
export const GROUP_CHILD = 2;
export const GROUP_ELDERLY = 4;
export const GROUP_NEWBORN = 8;
export const GROUP_INFANT = 16;
export const GROUP_ADOLESCENT = 32;

/** `DoseRule.c`: conditions the sentence restricts the rule to. */
export const COND_RENAL = 1;
export const COND_HEPATIC = 2;
export const COND_DIALYSIS = 4;

/** `DoseRule.rt`: routes named in the sentence or in the lines before it. */
export const ROUTE_ORAL = 1;
export const ROUTE_IV = 2;
export const ROUTE_IM = 4;
export const ROUTE_SC = 8;
export const ROUTE_INHALED = 16;
export const ROUTE_TOPICAL = 32;
export const ROUTE_RECTAL = 64;
export const ROUTE_SUBLINGUAL = 128;
export const ROUTE_EYE_EAR_NOSE = 256;
export const ROUTE_VAGINAL = 512;

/** `DoseRule.ro`: role of the dose in the course. */
export const ROLE_INITIAL = 1;
export const ROLE_MAINTENANCE = 2;
export const ROLE_LOADING = 3;
export const ROLE_SINGLE = 4;

const finite = z.number().finite();
const ruleSchema = z
  .object({
    k: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    s: z.number().int().min(0),
    a: z.number().int().min(0),
    b: z.number().int().min(1),
    h: z.tuple([z.number().int().min(0), z.number().int().min(1)]).optional(),
    p0: finite.min(0).optional(),
    p1: finite.min(0).optional(),
    w0: finite.min(0).optional(),
    w1: finite.min(0).optional(),
    g: z.number().int().min(0).optional(),
    or: z.literal(1).optional(),
    c: z.number().int().min(0).optional(),
    u: z
      .number()
      .int()
      .min(0)
      .max(DOSE_UNITS.length - 1)
      .optional(),
    d0: finite.min(0).optional(),
    d1: finite.min(0).optional(),
    pk: z.union([z.literal(1), z.literal(2)]).optional(),
    bs: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    up: z.literal(1).optional(),
    q0: finite.min(0).optional(),
    q1: finite.min(0).optional(),
    qu: z
      .number()
      .int()
      .min(0)
      .max(PIECE_KINDS.length - 1)
      .optional(),
    pm: finite.min(0).optional(),
    f0: finite.min(0).optional(),
    f1: finite.min(0).optional(),
    fp: finite.min(1).optional(),
    t0: finite.min(0).optional(),
    t1: finite.min(0).optional(),
    tm: z.literal(1).optional(),
    rt: z.number().int().min(0).optional(),
    fm: z.number().int().min(0).optional(),
    ro: z.number().int().min(0).max(4).optional(),
    gc: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * One rule. Keys are short because the build-time index holds thousands of them; every key but
 * `k`, `s`, `a`, `b` is omitted when the sentence does not state it.
 *
 * - `k` kind (dose, cap, duration only); `s` section index in the document; `a`,`b` half-open range of the
 *   sentence in the canonical text of the section; `h` range of the heading line or earlier sentence the
 *   population or condition was taken from.
 * - Population as printed: `p0`,`p1` age bounds in days, `w0`,`w1` weight bounds in tenths of a kilogram
 *   (inclusive), `g` group bits, `or` (age and weight are alternatives), `c` condition bits.
 * - Amount: `u` index into `DOSE_UNITS`, `d0`,`d1` lower and upper end (per intake, or per day when
 *   `bs` is 1; for a cap `bs` is 0 single, 1 day, 2 course), `pk` 1 per kg / 2 per m2, `up` «до X».
 * - Pieces: `q0`,`q1` counted pieces per intake, `qu` index into `PIECE_KINDS`, `pm` mg in one piece.
 * - Frequency: `f0`,`f1` intakes per `fp` days (default 1). Duration: `t0`,`t1` days, `tm` upper bound.
 * - `rt` route bits, `fm` dosage-form bits named, `ro` role of the dose in the course.
 * - `gc` the shape the confidence gate gave the rule (an index into `DOSE_SHAPES` of the app's `dose-gate.ts`;
 *   absent = 0 = not classified); only shapes measured correct may produce computed numbers.
 */
export type DoseRule = z.infer<typeof ruleSchema>;

const documentSchema = z
  .object({
    /** Indexes into the asset's `cards`. */
    c: z.array(z.number().int().min(0)),
    /** Index into `modules`. */
    m: z.number().int().min(0),
    /** Trade name as the registry writes it. */
    t: z.string().nullable(),
    /** Index into the instruction kinds of the interaction index. */
    k: z.number().int().min(0),
    /** 1 for a holder's own site, 0 for a ГРЛС file. */
    s: z.union([z.literal(0), z.literal(1)]),
    /** Dosage form as the document's metadata states it. */
    f: z.string().nullable(),
    /** The instruction says a tablet may be divided («можно разделить», «с риской»). */
    v: z.union([z.literal(0), z.literal(1)]),
    /** `[section id without «section.», checksum of the canonical text]`. */
    sec: z.array(z.tuple([z.string().min(1), z.string().min(1)])),
    rules: z.array(ruleSchema),
  })
  .strict();

export type DoseRuleDocument = z.infer<typeof documentSchema>;

/** Unit of a registry row's pack size (`DoseRegistryRow[2]`). */
export const PACK_UNITS = ['piece', 'ml', 'g', 'other'] as const;
export type PackUnit = (typeof PACK_UNITS)[number];

/** `[dosage form index, strength, pack unit index, pack sizes]` of a registry row (ЕСКЛП). */
const registryRowSchema = z.tuple([
  z.number().int().min(0),
  z.string(),
  z
    .number()
    .int()
    .min(0)
    .max(PACK_UNITS.length - 1),
  z.array(z.number().positive()),
]);

const cardSchema = z
  .object({
    /** Card id without «esklp.mnn.». */
    s: z.string().min(1),
    /** Name as the registry writes it. */
    n: z.string(),
    /** Registry rows: `[form index, strength, pack unit, pack sizes]`. */
    r: z.array(registryRowSchema),
    /** Latin name in the nominative («Amoxycillinum»), from the Allmed reference; absent when unknown. */
    l: z.string().optional(),
    /** Trade names of the card's registrations, most common first (at most a dozen). */
    t: z.array(z.string()),
    /** ATC codes. */
    a: z.array(z.string()),
    /** Valid ГРЛС registrations by conditions of dispensing: `[Rx, OTC, mixed, not stated]`. */
    x: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    /** 1 when the registry lists the card in ЖНВЛП for some form. */
    e: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

export const doseRuleIndexSchema = z
  .object({
    schemaVersion: z.literal(DOSE_RULES_SCHEMA_VERSION),
    basis: z
      .object({
        esklpEdition: z.string(),
        modules: z.array(
          z.object({ id: z.string(), version: z.string(), sha256: z.string() }).strict(),
        ),
      })
      .strict(),
    modules: z.array(z.string()),
    /** Dosage form wordings as the registry writes them, lower case. */
    forms: z.array(z.string()),
    cards: z.array(cardSchema),
    documents: z.record(z.string(), documentSchema),
  })
  .strict();

export type DoseRuleIndexAsset = z.infer<typeof doseRuleIndexSchema>;
export type DoseRuleCard = z.infer<typeof cardSchema>;
export type DoseRegistryRow = z.infer<typeof registryRowSchema>;

/** Validates the shipped asset once; a malformed asset is an error, never a silently empty index. */
export function parseDoseRuleIndex(value: unknown): DoseRuleIndexAsset {
  const parsed = doseRuleIndexSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Dose-rule index: ${parsed.error.issues[0]?.message ?? 'malformed'}`);
  }
  for (const [id, document] of Object.entries(parsed.data.documents)) {
    for (const rule of document.rules) {
      if (rule.s >= document.sec.length || rule.b <= rule.a) {
        throw new Error(`Dose-rule index: document ${id} has an invalid rule range`);
      }
    }
    if (document.m >= parsed.data.modules.length) {
      throw new Error(`Dose-rule index: document ${id} has no module`);
    }
    if (document.c.some((card) => card >= parsed.data.cards.length)) {
      throw new Error(`Dose-rule index: document ${id} has an invalid card`);
    }
  }
  return parsed.data;
}
