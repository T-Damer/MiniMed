import type { ReferenceAttentionLevel, ScoreScaleDefinition } from '@localmed/contracts';

/**
 * Score scales: the banded track drawn under a numeric result. A scale is declared as data in the
 * tool schema (`scoreScales`); the engines turn it into a plain serializable {@link ScoreScaleSpec}
 * for one result, and the screen, the print sheet and the tests all read the same geometry from
 * {@link scoreScaleGeometry}. Nothing here knows a tool id.
 */

export type ScoreScaleAttention = ReferenceAttentionLevel;

export interface ScoreScaleSpecBand {
  readonly from: number;
  readonly label?: string;
  readonly attentionLevel?: ScoreScaleAttention;
}

export interface ScoreScaleSpec {
  readonly id: string;
  /** Id of the result value the marker shows (an output id when the scale stands for that output). */
  readonly valueId: string;
  readonly label?: string;
  readonly value: number;
  readonly unit?: string;
  readonly precision: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly step?: number;
  readonly layout: 'proportional' | 'equal';
  readonly bands: readonly ScoreScaleSpecBand[];
  /** Index of the band the result falls in; absent for a plain gauge. */
  readonly activeBand?: number;
  /** The interpretation text of the active band. */
  readonly text?: string;
}

export interface ScoreScaleSegment {
  readonly index: number;
  readonly startPercent: number;
  readonly endPercent: number;
  readonly widthPercent: number;
  readonly label?: string;
  readonly attentionLevel?: ScoreScaleAttention;
  /** First value of the band, formatted for display. */
  readonly fromText: string;
}

export interface ScoreScaleTick {
  readonly percent: number;
  readonly text: string;
}

export interface ScoreScaleGeometry {
  /** At least one segment: a gauge without bands is a single unlabelled segment. */
  readonly segments: readonly ScoreScaleSegment[];
  readonly markerPercent: number;
  /** The value lies outside the track; the marker is held at that end. */
  readonly overflow?: 'below' | 'above';
  readonly ticks: readonly ScoreScaleTick[];
  /** Every band label is short enough to be written inside its segment. */
  readonly labelsFitInside: boolean;
}

const TRACK_WIDTH_ESTIMATE_PX = 320;
const LABEL_CHARACTER_PX = 6.4;
const LABEL_PADDING_PX = 10;
const MINIMUM_TICK_GAP_PERCENT = 7;

const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatScaleNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** The band a value falls in: the last one that starts at or below it (cells are half a step wide). */
export function scoreScaleBandIndexForValue(
  scale: Pick<ScoreScaleSpec, 'bands' | 'step'>,
  value: number,
): number | undefined {
  if (scale.bands.length === 0) return undefined;
  const half = (scale.step ?? 0) / 2;
  let found = 0;
  for (const [index, band] of scale.bands.entries()) {
    if (value >= band.from - half - 1e-9) found = index;
  }
  return found;
}

/** Band edges in value units, from the lower end of the track to the upper one. */
function scaleEdges(scale: ScoreScaleSpec): readonly number[] {
  const half = (scale.step ?? 0) / 2;
  return [
    scale.minimum - half,
    ...scale.bands.slice(1).map((band) => band.from - half),
    scale.maximum + half,
  ];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function scoreScaleGeometry(scale: ScoreScaleSpec): ScoreScaleGeometry {
  const edges = scaleEdges(scale);
  const count = Math.max(1, scale.bands.length);
  const equal = scale.layout === 'equal' && scale.bands.length >= 2;
  const edgePercent = (index: number): number =>
    equal
      ? (index / count) * 100
      : (((edges[index] ?? 0) - (edges[0] ?? 0)) /
          Math.max(1e-9, (edges[edges.length - 1] ?? 1) - (edges[0] ?? 0))) *
        100;

  const segments: ScoreScaleSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const band = scale.bands[index];
    const startPercent = round(edgePercent(index));
    const endPercent = round(edgePercent(index + 1));
    segments.push({
      index,
      startPercent,
      endPercent,
      widthPercent: round(endPercent - startPercent),
      ...(band?.label ? { label: band.label } : {}),
      ...(band?.attentionLevel ? { attentionLevel: band.attentionLevel } : {}),
      fromText: formatScaleNumber(band?.from ?? scale.minimum),
    });
  }

  const lower = edges[0] ?? scale.minimum;
  const upper = edges[edges.length - 1] ?? scale.maximum;
  let overflow: 'below' | 'above' | undefined;
  if (scale.value < lower - 1e-9) overflow = 'below';
  else if (scale.value > upper + 1e-9) overflow = 'above';
  const clamped = Math.min(upper, Math.max(lower, scale.value));
  let markerPercent: number;
  if (equal) {
    let bandIndex = 0;
    for (let index = 0; index < count; index += 1) {
      if (clamped >= (edges[index] ?? lower) - 1e-9) bandIndex = index;
    }
    const start = edges[bandIndex] ?? lower;
    const end = edges[bandIndex + 1] ?? upper;
    const fraction = end > start ? (clamped - start) / (end - start) : 0.5;
    const segment = segments[bandIndex];
    markerPercent = segment
      ? segment.startPercent + Math.min(1, Math.max(0, fraction)) * segment.widthPercent
      : 0;
  } else {
    markerPercent = upper > lower ? ((clamped - lower) / (upper - lower)) * 100 : 0;
  }

  const innerTicks: ScoreScaleTick[] = segments
    .slice(1)
    .map((segment) => ({ percent: segment.startPercent, text: segment.fromText }));
  const ticks: ScoreScaleTick[] = [];
  let lastPercent = -Infinity;
  const candidates: ScoreScaleTick[] = [
    { percent: 0, text: formatScaleNumber(scale.minimum) },
    ...innerTicks,
    { percent: 100, text: formatScaleNumber(scale.maximum) },
  ];
  for (const [index, tick] of candidates.entries()) {
    const isEnd = index === 0 || index === candidates.length - 1;
    const nearestInner = innerTicks.some(
      (inner) =>
        inner.text === tick.text ||
        Math.abs(inner.percent - tick.percent) < MINIMUM_TICK_GAP_PERCENT,
    );
    // Cut-points matter more than the ends of the track: an end label that would touch one is dropped.
    if (isEnd && nearestInner) continue;
    if (tick.percent - lastPercent < MINIMUM_TICK_GAP_PERCENT) continue;
    ticks.push(tick);
    lastPercent = tick.percent;
  }

  const labelsFitInside =
    scale.bands.length > 0 &&
    segments.every((segment) => {
      if (!segment.label) return false;
      const widthPx = (segment.widthPercent / 100) * TRACK_WIDTH_ESTIMATE_PX;
      return widthPx >= segment.label.length * LABEL_CHARACTER_PX + LABEL_PADDING_PX;
    });

  return {
    segments,
    markerPercent: round(markerPercent),
    ...(overflow ? { overflow } : {}),
    ticks,
    labelsFitInside,
  };
}

export interface ScoreScaleSpecInput {
  readonly value: number;
  readonly unit?: string;
  readonly precision: number;
  readonly label?: string;
  /** Index of the interpretation the engine matched; takes precedence over the value's position. */
  readonly matchedInterpretation?: number | undefined;
  /** The text of interpretation `index`, when the definition has one. */
  readonly interpretationText?: (index: number) => string | undefined;
}

/** One result placed on a declared scale. */
export function buildScoreScaleSpec(
  scale: ScoreScaleDefinition,
  input: ScoreScaleSpecInput,
): ScoreScaleSpec {
  const bands: ScoreScaleSpecBand[] = scale.bands.map((band) => ({
    from: band.from,
    ...(band.label ? { label: band.label } : {}),
    ...(band.attentionLevel ? { attentionLevel: band.attentionLevel } : {}),
  }));
  const base: ScoreScaleSpec = {
    id: scale.id,
    valueId: scale.valueId,
    ...((scale.label ?? input.label) ? { label: scale.label ?? input.label } : {}),
    value: input.value,
    ...(input.unit ? { unit: input.unit } : {}),
    precision: input.precision,
    minimum: scale.minimum,
    maximum: scale.maximum,
    ...(scale.step === undefined ? {} : { step: scale.step }),
    layout: scale.layout,
    bands,
  };
  if (bands.length === 0) return base;
  const matched =
    input.matchedInterpretation === undefined
      ? undefined
      : scale.bands.findIndex((band) => band.interpretation === input.matchedInterpretation);
  const activeBand =
    matched !== undefined && matched >= 0
      ? matched
      : scoreScaleBandIndexForValue(base, input.value);
  if (activeBand === undefined) return base;
  const interpretationIndex = scale.bands[activeBand]?.interpretation;
  const text =
    interpretationIndex === undefined ? undefined : input.interpretationText?.(interpretationIndex);
  return { ...base, activeBand, ...(text ? { text } : {}) };
}

/**
 * Ordinal classes (`equal` layout: NYHA I–IV, PSI I–V): the class name is the result itself, so it is
 * written instead of «3 класс» and no second pill repeats it. Undefined for any other scale.
 */
export function scoreScaleClassName(
  scale: Pick<ScoreScaleSpec, 'layout' | 'bands' | 'activeBand'>,
): string | undefined {
  if (scale.layout !== 'equal' || scale.activeBand === undefined) return undefined;
  return scale.bands[scale.activeBand]?.label;
}

/**
 * Whether cut-points are written on the track. They are written once: the legend carries them when
 * it is drawn, so the track shows them only for a gauge without bands or when the band names sit
 * inside the segments. Classes have no cut-points in numbers.
 */
export function scoreScaleTicksVisible(
  scale: Pick<ScoreScaleSpec, 'layout' | 'bands'>,
  geometry: Pick<ScoreScaleGeometry, 'labelsFitInside'>,
): boolean {
  return scale.layout !== 'equal' && (scale.bands.length === 0 || geometry.labelsFitInside);
}

/** Text for assistive technology and the print sheet: «7 баллов — Средний риск». */
export function scoreScaleSummary(scale: ScoreScaleSpec): string {
  const value = `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: scale.precision }).format(scale.value)}${scale.unit ? ` ${scale.unit}` : ''}`;
  const band = scale.activeBand === undefined ? undefined : scale.bands[scale.activeBand]?.label;
  return band ? `${value} — ${band}` : value;
}

/** Result values a scale already shows, so the plain output list need not repeat them. */
export function scaledValueIds(scales: readonly ScoreScaleSpec[] | undefined): ReadonlySet<string> {
  return new Set((scales ?? []).map((scale) => scale.valueId));
}

/** Warnings that are not an interpretation text a scale already writes below its track. */
export function warningsBesideScales<T extends { readonly code: string; readonly message: string }>(
  warnings: readonly T[],
  scales: readonly ScoreScaleSpec[] | undefined,
): readonly T[] {
  const written = new Set((scales ?? []).flatMap((scale) => (scale.text ? [scale.text] : [])));
  return warnings.filter(
    (warning) => !(warning.code === 'interpretation' && written.has(warning.message)),
  );
}
