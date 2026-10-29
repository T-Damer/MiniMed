/**
 * The skin atlas: for every condition the tool can name — the model's classes and the conditions
 * only a description can reach (vitiligo, milia, Koplik spots…) — how dangerous it is, what to do,
 * what it looks like, how it evolves, its red flags and drawn reference pictures. The clinical text
 * (`skin-atlas.json`) is a draft extracted from the app's own clinical recommendations and reference
 * articles, each entry citing its documents; the pictures (`skin-atlas-art.json`) are schemas drawn
 * by skin-lesion-art. Both are validated here, at the package boundary.
 */
import { z } from 'zod';
import skinAtlasJson from '@/features/skin/skin-atlas.json';
import skinAtlasArtJson from '@/features/skin/skin-atlas-art.json';
import {
  dangerRank,
  maxDanger,
  SKIN_ATLAS_SITES,
  SKIN_COLORS,
  SKIN_DANGER_LEVELS,
  SKIN_ELEMENTS,
  SKIN_SIGNS,
  type SkinColor,
  type SkinDangerLevel,
  type SkinElement,
  type SkinSign,
  type SkinTrigger,
} from '@/features/skin/skin-atlas-terms';
import {
  LESION_BORDERS,
  LESION_PATTERNS,
  LESION_SURFACES,
  type LesionArt,
} from '@/features/skin/skin-lesion-art';
import {
  SKIN_CLASSES,
  SKIN_SYMPTOMS,
  type SkinDetails,
  type SkinPrediction,
} from '@/features/skin/skin-model';

const TriggerSchema = z.enum([...SKIN_SIGNS, ...SKIN_SYMPTOMS]);
const DangerSchema = z.enum(SKIN_DANGER_LEVELS);

const ConditionSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/u),
  ru: z.string().min(2),
  icd10: z.array(z.string()),
  model: z.boolean(),
  danger: DangerSchema,
  dangerWhy: z.string().min(3).max(90),
  action: z.string().min(3).max(140),
  summary: z.string().min(10).max(280),
  evolution: z.string().min(10).max(240),
  redFlags: z
    .array(
      z.object({
        text: z.string().min(3).max(120),
        danger: z.enum(['moderate', 'high', 'urgent']),
        triggers: z.array(TriggerSchema),
      }),
    )
    .max(5),
  features: z.object({
    elements: z.array(z.enum(SKIN_ELEMENTS)).min(1),
    colors: z.array(z.enum(SKIN_COLORS)),
    sites: z.array(z.enum(SKIN_ATLAS_SITES)),
    signs: z.array(TriggerSchema),
  }),
  sources: z
    .array(z.object({ documentId: z.string().min(5), title: z.string(), section: z.string() }))
    .min(1),
  status: z.enum(['draft', 'reviewed']),
});

const LayerSchema = z.object({
  element: z.enum(SKIN_ELEMENTS),
  pattern: z.enum(LESION_PATTERNS).optional(),
  count: z.number().int().min(1).max(80).optional(),
  size: z.number().min(0.5).max(45).optional(),
  colors: z.array(z.enum(SKIN_COLORS)).min(1).optional(),
  border: z.enum(LESION_BORDERS).optional(),
  surface: z.array(z.enum(LESION_SURFACES)).optional(),
  seed: z.number().int().optional(),
});

const ArtSchema = z.object({
  caption: z.string().min(2).max(40),
  background: z.enum(['skin', 'mucosa']).optional(),
  tone: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  layers: z.array(LayerSchema).min(1),
});

export const SkinAtlasFileSchema = z.object({
  conditions: z.array(ConditionSchema).min(1),
});
export const SkinAtlasArtFileSchema = z.object({
  art: z.record(z.string(), z.array(ArtSchema).min(1).max(4)),
});

type ConditionData = z.infer<typeof ConditionSchema>;

export interface SkinAtlasCondition extends ConditionData {
  readonly art: readonly LesionArt[];
}

export function buildSkinAtlas(
  conditionsFile: unknown,
  artFile: unknown,
): readonly SkinAtlasCondition[] {
  const { conditions } = SkinAtlasFileSchema.parse(conditionsFile);
  const { art } = SkinAtlasArtFileSchema.parse(artFile);
  return conditions.map((condition) => ({ ...condition, art: art[condition.id] ?? [] }));
}

export const SKIN_ATLAS: readonly SkinAtlasCondition[] = buildSkinAtlas(
  skinAtlasJson,
  skinAtlasArtJson,
);

const ATLAS_BY_ID: ReadonlyMap<string, SkinAtlasCondition> = new Map(
  SKIN_ATLAS.map((entry) => [entry.id, entry]),
);

export function atlasCondition(id: string): SkinAtlasCondition | undefined {
  return ATLAS_BY_ID.get(id);
}

/** Every model class has its atlas entry (checked by a unit test, not at run time). */
export function missingAtlasClasses(): readonly string[] {
  return SKIN_CLASSES.filter((entry) => !ATLAS_BY_ID.has(entry.id)).map((entry) => entry.id);
}

/** What the doctor sees on the lesion, beyond the model's details. Every field is optional. */
export interface SkinFindings {
  readonly elements?: readonly SkinElement[];
  readonly colors?: readonly SkinColor[];
  readonly signs?: readonly SkinSign[];
  /** How the elements appeared and changed, in the doctor's words. */
  readonly evolution?: string;
}

/** Signs ticked plus symptoms marked present: what can trigger a red flag. */
export function activeTriggers(
  details: SkinDetails,
  findings: SkinFindings,
): ReadonlySet<SkinTrigger> {
  const present = SKIN_SYMPTOMS.filter((symptom) => details.symptoms?.[symptom] === true);
  return new Set<SkinTrigger>([...(findings.signs ?? []), ...present]);
}

export interface SkinRedFlagView {
  readonly text: string;
  readonly danger: SkinDangerLevel;
  /** One of its triggers is ticked. */
  readonly active: boolean;
}

export function redFlagViews(
  condition: SkinAtlasCondition,
  triggers: ReadonlySet<SkinTrigger>,
): readonly SkinRedFlagView[] {
  return condition.redFlags
    .map((flag) => ({
      text: flag.text,
      danger: flag.danger,
      active: flag.triggers.some((trigger) => triggers.has(trigger)),
    }))
    .toSorted((left, right) => Number(right.active) - Number(left.active));
}

/** The condition's level, raised by any red flag the doctor's ticks make apply. */
export function conditionDanger(
  condition: SkinAtlasCondition,
  triggers: ReadonlySet<SkinTrigger>,
): SkinDangerLevel {
  const flagged = condition.redFlags
    .filter((flag) => flag.triggers.some((trigger) => triggers.has(trigger)))
    .map((flag) => flag.danger);
  return maxDanger([condition.danger, ...flagged]) ?? condition.danger;
}

export interface SkinDescriptionMatch {
  readonly conditionId: string;
  /** Doctor's picks the condition shows. */
  readonly matched: number;
  /** Doctor's picks in all. */
  readonly asked: number;
}

/** A description-only condition is offered when it shows at least this share of the picks. */
const MIN_MATCH_SHARE = 0.5;
const MIN_MATCHED = 2;
export const MAX_DESCRIPTION_MATCHES = 2;

/**
 * Conditions the photo model does not know, ranked by how much of the doctor's description they
 * show: elements, colours, sites (the mouth when «На слизистой» is ticked), signs and symptoms. At
 * least one element must agree; a description without elements offers nothing.
 */
export function describedConditions(
  details: SkinDetails,
  findings: SkinFindings,
  atlas: readonly SkinAtlasCondition[] = SKIN_ATLAS,
): readonly SkinDescriptionMatch[] {
  const elements = findings.elements ?? [];
  if (elements.length === 0) return [];
  const triggers = activeTriggers(details, findings);
  const sites = [
    ...(details.sites ?? []),
    ...((findings.signs ?? []).includes('mucosa') ? (['mouth'] as const) : []),
  ];
  const colors = findings.colors ?? [];
  const asked = elements.length + colors.length + sites.length + triggers.size;
  return atlas
    .filter((condition) => !condition.model)
    .flatMap((condition): SkinDescriptionMatch[] => {
      const features = condition.features;
      const elementHits = elements.filter((entry) => features.elements.includes(entry)).length;
      if (elementHits === 0) return [];
      const matched =
        elementHits +
        colors.filter((entry) => features.colors.includes(entry)).length +
        sites.filter((entry) => features.sites.includes(entry)).length +
        [...triggers].filter((entry) => features.signs.includes(entry)).length;
      return matched >= MIN_MATCHED && matched / asked >= MIN_MATCH_SHARE
        ? [{ conditionId: condition.id, matched, asked }]
        : [];
    })
    .toSorted(
      (left, right) =>
        right.matched / right.asked - left.matched / left.asked || right.matched - left.matched,
    )
    .slice(0, MAX_DESCRIPTION_MATCHES);
}

export interface SkinDangerSummary {
  readonly level: SkinDangerLevel;
  /** The condition that set the level; its action is what to do. */
  readonly conditionId: string;
  readonly action: string;
  /** Why, in a few words each: the condition among the variants, a fired check, a red flag. */
  readonly reasons: readonly string[];
}

/**
 * How dangerous the picture on screen is: the highest level among the variants shown (photo and
 * description), each raised by its active red flags; a fired malignancy check makes it at least
 * high. The most probable condition at that level supplies the action.
 */
export function skinDangerSummary(input: {
  readonly predictions: readonly Pick<SkinPrediction, 'classId' | 'probability'>[];
  readonly described: readonly SkinDescriptionMatch[];
  readonly malignantFlag: boolean;
  readonly details: SkinDetails;
  readonly findings: SkinFindings;
}): SkinDangerSummary | undefined {
  const triggers = activeTriggers(input.details, input.findings);
  const candidates = [
    ...input.predictions.map((entry) => ({ id: entry.classId, weight: entry.probability })),
    ...input.described.map((entry) => ({ id: entry.conditionId, weight: 0 })),
  ].flatMap((entry) => {
    const condition = atlasCondition(entry.id);
    return condition
      ? [{ condition, weight: entry.weight, level: conditionDanger(condition, triggers) }]
      : [];
  });
  if (candidates.length === 0) return undefined;
  const malignantIds = new Set(
    SKIN_CLASSES.filter((entry) => entry.malignant).map((entry) => entry.id),
  );
  const shownLevel = maxDanger(candidates.map((entry) => entry.level)) ?? 'low';
  // A fired check lifts the picture to high even when no malignant class made the cards; the most
  // probable malignant variant shown (or else the first) then supplies the action.
  const lifted = input.malignantFlag && dangerRank(shownLevel) < dangerRank('high');
  const level: SkinDangerLevel = lifted ? 'high' : shownLevel;
  const pool = lifted
    ? candidates.filter((entry) => malignantIds.has(entry.condition.id))
    : candidates.filter((entry) => entry.level === level);
  const source = pool.toSorted((left, right) => right.weight - left.weight)[0] ?? candidates[0];
  if (!source) return undefined;
  const reasons: string[] = [];
  const first = candidates[0];
  if (first && source.condition.id !== first.condition.id) {
    reasons.push(`${source.condition.ru} среди вариантов`);
  }
  if (input.malignantFlag) reasons.push('Сработала проверка на злокачественность');
  for (const flag of redFlagViews(source.condition, triggers)) {
    if (flag.active) reasons.push(flag.text);
  }
  return {
    level,
    conditionId: source.condition.id,
    action: source.condition.action,
    reasons: reasons.slice(0, 3),
  };
}

const MAX_EVOLUTION_LENGTH = 1000;

function pickAll<Value extends string>(allowed: readonly Value[], value: unknown): Value[] {
  return Array.isArray(value) ? allowed.filter((entry) => value.includes(entry)) : [];
}

/** Findings read back from storage: unknown ids are dropped, the text is trimmed to size. */
export function sanitizeSkinFindings(value: unknown): SkinFindings {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const elements = pickAll(SKIN_ELEMENTS, raw['elements']);
  const colors = pickAll(SKIN_COLORS, raw['colors']);
  const signs = pickAll(SKIN_SIGNS, raw['signs']);
  const evolution =
    typeof raw['evolution'] === 'string' ? raw['evolution'].slice(0, MAX_EVOLUTION_LENGTH) : '';
  return {
    ...(elements.length > 0 ? { elements } : {}),
    ...(colors.length > 0 ? { colors } : {}),
    ...(signs.length > 0 ? { signs } : {}),
    ...(evolution.trim().length > 0 ? { evolution } : {}),
  };
}

/** Adds or removes one id, keeping the declared order. */
export function toggleFinding<Value extends string>(
  allowed: readonly Value[],
  current: readonly Value[] | undefined,
  value: Value,
): readonly Value[] {
  const list = current ?? [];
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : allowed.filter((entry) => entry === value || list.includes(entry));
}
