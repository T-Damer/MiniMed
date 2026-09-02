import {
  ECG_STANDARD_LEADS,
  type EcgDigitizationResult,
  type EcgDigitizedLead,
} from '@/features/calculators/ecg-model-contract';
import {
  ECG_NUMERIC_FEATURES,
  type EcgNumericFeatureId,
} from '@/features/calculators/ecg-numeric-diagnostic';
import type { EcgMeasurements } from '@/features/calculators/ecg-photo-caliper';

export type EcgWaveName = 'Q' | 'R' | 'S' | 'T';

export interface EcgIntervalRange {
  readonly end: number;
  readonly start: number;
}

export interface EcgLeadIntervalDetection {
  readonly fiducials: {
    readonly pOffset?: number;
    readonly pOnset?: number;
    readonly qPeak?: number;
    readonly qrsOffset: number;
    readonly qrsOnset: number;
    readonly rPeak: number;
    readonly sPeak?: number;
    readonly tOffset?: number;
    readonly tOnset?: number;
    readonly tPeak?: number;
  };
  readonly ranges: {
    readonly p?: EcgIntervalRange;
    readonly pr?: EcgIntervalRange;
    readonly qrs: EcgIntervalRange;
    readonly qt?: EcgIntervalRange;
    readonly st?: EcgIntervalRange;
  };
}

// Eight distinct standard leads per interval is deliberately conservative. Each interval is
// measured independently because P and T are not necessarily visible in every lead.
export const ECG_INTERVAL_MIN_LEAD_SUPPORT = 8;

const MIN_LEAD_COVERAGE = 0.8;
const MIN_FINITE_RATIO = 0.9;
const MIN_LEAD_SAMPLES = 120;
const MAX_INTERVAL_MAD_MS = 30;
const MAX_INTERVAL_DEVIATION_MS = 80;
const PHYSIOLOGIC_INTERVALS = {
  p: { maxMs: 220, minMs: 20 },
  pr: { maxMs: 350, minMs: 80 },
  qrs: { maxMs: 240, minMs: 40 },
  qt: { maxMs: 700, minMs: 200 },
  st: { maxMs: 300, minMs: 20 },
} as const;

export interface EcgWaveMarker {
  readonly amplitudeMv: number;
  readonly index: number;
  readonly wave: EcgWaveName;
}

export function canAcceptEcgAutomaticDraft(
  result: EcgDigitizationResult,
  recordingProfileConfirmed: boolean,
): boolean {
  return (
    recordingProfileConfirmed &&
    result.layout === '12x1' &&
    result.quality === 'usable' &&
    Boolean(result.rrMs && result.heartRate)
  );
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 1 ? right : ((sorted[middle - 1] ?? right) + right) / 2;
}

function extremeIndex(
  values: Float32Array,
  start: number,
  end: number,
  score: (value: number) => number,
): number | undefined {
  let selected: number | undefined;
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (let index = Math.max(0, start); index < Math.min(values.length, end); index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    const nextScore = score(value ?? 0);
    if (nextScore > selectedScore) {
      selected = index;
      selectedScore = nextScore;
    }
  }
  return selected;
}

function smoothSamples(samples: Float32Array): Float64Array {
  const smoothed = new Float64Array(samples.length);
  smoothed.fill(Number.NaN);
  for (let index = 1; index < samples.length - 1; index += 1) {
    const left = samples[index - 1];
    const value = samples[index];
    const right = samples[index + 1];
    if (Number.isFinite(left) && Number.isFinite(value) && Number.isFinite(right)) {
      smoothed[index] = ((left ?? 0) + (value ?? 0) + (right ?? 0)) / 3;
    }
  }
  return smoothed;
}

function contiguousFiniteSamples(samples: Float32Array): number {
  let longest = 0;
  let current = 0;
  for (const value of samples) {
    current = Number.isFinite(value) ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function signalNoise(samples: Float64Array): number {
  const differences: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const left = samples[index - 1];
    const right = samples[index];
    if (Number.isFinite(left) && Number.isFinite(right)) {
      differences.push(Math.abs((right ?? 0) - (left ?? 0)));
    }
  }
  return differences.length > 0 ? median(differences) * 1.4826 : Number.NaN;
}

function rangeDurationMs(range: EcgIntervalRange, sampleRateHz: number): number {
  return ((range.end - range.start) / sampleRateHz) * 1_000;
}

function isPhysiologicRange(
  range: EcgIntervalRange,
  sampleRateHz: number,
  limits: { readonly maxMs: number; readonly minMs: number },
): boolean {
  const durationMs = rangeDurationMs(range, sampleRateHz);
  return Number.isFinite(durationMs) && durationMs >= limits.minMs && durationMs <= limits.maxMs;
}

function findQuietLeft(
  values: Float64Array,
  peak: number,
  threshold: number,
  lower: number,
): number {
  let quiet = 0;
  for (let index = peak; index >= lower; index -= 1) {
    const value = values[index];
    if (Number.isFinite(value) && Math.abs(value ?? 0) <= threshold) quiet += 1;
    else quiet = 0;
    if (quiet >= 2) return index + 1;
  }
  return lower;
}

function findQuietRight(
  values: Float64Array,
  peak: number,
  threshold: number,
  upper: number,
): number {
  let quiet = 0;
  for (let index = peak; index < upper; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && Math.abs(value ?? 0) <= threshold) quiet += 1;
    else quiet = 0;
    if (quiet >= 2) return index - quiet + 1;
  }
  return upper;
}

function findWaveRange(
  values: Float64Array,
  start: number,
  end: number,
  noise: number,
  minSamples: number,
  maxSamples: number,
): { readonly peak: number; readonly range: EcgIntervalRange } | undefined {
  let peak: number | undefined;
  let amplitude = 0;
  for (let index = Math.max(0, start); index < Math.min(values.length, end); index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    const nextAmplitude = Math.abs(value ?? 0);
    if (nextAmplitude > amplitude) {
      amplitude = nextAmplitude;
      peak = index;
    }
  }
  if (
    peak === undefined ||
    amplitude < Math.max(0.04, Number.isFinite(noise) ? noise * 6 : 0) ||
    amplitude < Math.max(0.02, Number.isFinite(noise) ? noise * 4 : 0) * 1.8
  ) {
    return undefined;
  }

  const threshold = Math.max(0.02, Number.isFinite(noise) ? noise * 4 : 0, amplitude * 0.15);
  let rangeStart = peak;
  while (
    rangeStart > start &&
    Number.isFinite(values[rangeStart - 1]) &&
    Math.abs(values[rangeStart - 1] ?? 0) >= threshold
  ) {
    rangeStart -= 1;
  }
  let rangeEnd = peak + 1;
  while (
    rangeEnd < end &&
    Number.isFinite(values[rangeEnd]) &&
    Math.abs(values[rangeEnd] ?? 0) >= threshold
  ) {
    rangeEnd += 1;
  }
  if (rangeEnd - rangeStart < minSamples || rangeEnd - rangeStart > maxSamples) {
    return undefined;
  }
  return { peak, range: { end: rangeEnd, start: rangeStart } };
}

/**
 * Finds conservative single-lead P/PR/QRS/ST/QT drafts from 100 Hz samples.
 * QRS is required; absent or implausible P/T waves withhold only their dependent ranges.
 * This is a review aid only; it has no clinical validation or diagnostic authority.
 */
export function detectEcgLeadIntervals(
  lead: EcgDigitizedLead,
  sampleRateHz: number,
  rrMs?: number,
): EcgLeadIntervalDetection | undefined {
  if (
    sampleRateHz !== 100 ||
    lead.samples.length < MIN_LEAD_SAMPLES ||
    !Number.isFinite(lead.coverage) ||
    lead.coverage < MIN_LEAD_COVERAGE
  ) {
    return undefined;
  }
  const finiteCount = [...lead.samples].filter(Number.isFinite).length;
  if (
    finiteCount < lead.samples.length * MIN_FINITE_RATIO ||
    contiguousFiniteSamples(lead.samples) < lead.samples.length * MIN_FINITE_RATIO
  ) {
    return undefined;
  }

  const values = smoothSamples(lead.samples);
  const baseline = median([...values].filter(Number.isFinite));
  if (!Number.isFinite(baseline)) return undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (Number.isFinite(values[index])) values[index] = (values[index] ?? 0) - baseline;
  }
  const noise = signalNoise(values);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let maximumAbsolute = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value ?? 0);
    maximum = Math.max(maximum, value ?? 0);
    maximumAbsolute = Math.max(maximumAbsolute, Math.abs(value ?? 0));
  }
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum - minimum < 0.08 ||
    maximumAbsolute < Math.max(0.04, Number.isFinite(noise) ? noise * 7 : 0)
  ) {
    return undefined;
  }

  const qrsSearchEnd = values.length - Math.round(sampleRateHz * 0.45);
  let qrsCandidate: number | undefined;
  let maximumSlope = 0;
  for (let index = 2; index < qrsSearchEnd - 2; index += 1) {
    const left = values[index - 2];
    const right = values[index + 2];
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    const slope = Math.abs((right ?? 0) - (left ?? 0));
    if (slope > maximumSlope) {
      maximumSlope = slope;
      qrsCandidate = index;
    }
  }
  if (
    qrsCandidate === undefined ||
    maximumSlope < Math.max(0.02, Number.isFinite(noise) ? noise * 6 : 0)
  ) {
    return undefined;
  }

  const qrsPeakStart = Math.max(0, qrsCandidate - Math.round(sampleRateHz * 0.12));
  const qrsPeakEnd = Math.min(values.length, qrsCandidate + Math.round(sampleRateHz * 0.12) + 1);
  let rPeak: number | undefined;
  let rAmplitude = 0;
  for (let index = qrsPeakStart; index < qrsPeakEnd; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    const nextAmplitude = Math.abs(value ?? 0);
    if (nextAmplitude > rAmplitude) {
      rAmplitude = nextAmplitude;
      rPeak = index;
    }
  }
  if (rPeak === undefined || rAmplitude < Math.max(0.08, Number.isFinite(noise) ? noise * 7 : 0)) {
    return undefined;
  }

  const qrsThreshold = Math.max(0.04, rAmplitude * 0.1, Number.isFinite(noise) ? noise * 5 : 0);
  const qrsStart = findQuietLeft(
    values,
    rPeak,
    qrsThreshold,
    Math.max(0, rPeak - Math.round(sampleRateHz * 0.25)),
  );
  const qrsEnd = findQuietRight(
    values,
    rPeak,
    qrsThreshold,
    Math.min(values.length, rPeak + Math.round(sampleRateHz * 0.25) + 1),
  );
  const qrsRange = { end: qrsEnd, start: qrsStart } satisfies EcgIntervalRange;
  if (!isPhysiologicRange(qrsRange, sampleRateHz, PHYSIOLOGIC_INTERVALS.qrs)) return undefined;

  const polarity = (values[rPeak] ?? 0) >= 0 ? 1 : -1;
  const qPeak = extremeIndex(
    Float32Array.from(values),
    qrsStart,
    rPeak + 1,
    (value) => -polarity * value,
  );
  const sPeak = extremeIndex(
    Float32Array.from(values),
    rPeak,
    qrsEnd,
    (value) => -polarity * value,
  );

  const p = findWaveRange(
    values,
    Math.max(0, qrsStart - Math.round(sampleRateHz * 0.35)),
    Math.max(0, qrsStart - Math.round(sampleRateHz * 0.08)),
    noise,
    Math.round(sampleRateHz * 0.02),
    Math.round(sampleRateHz * 0.22),
  );
  const pRange =
    p && isPhysiologicRange(p.range, sampleRateHz, PHYSIOLOGIC_INTERVALS.p) ? p.range : undefined;
  const prRange = pRange
    ? ({ end: qrsStart, start: pRange.start } satisfies EcgIntervalRange)
    : undefined;
  const validPrRange =
    prRange && isPhysiologicRange(prRange, sampleRateHz, PHYSIOLOGIC_INTERVALS.pr)
      ? prRange
      : undefined;

  const rrSeconds = Number.isFinite(rrMs) && (rrMs ?? 0) > 0 ? (rrMs ?? 0) / 1_000 : 1;
  const t = findWaveRange(
    values,
    Math.min(values.length, qrsEnd + Math.round(sampleRateHz * 0.02)),
    Math.min(
      values.length,
      qrsStart + Math.round(sampleRateHz * Math.min(0.8, Math.max(0.55, rrSeconds * 0.8))),
    ),
    noise,
    Math.round(sampleRateHz * 0.04),
    Math.round(sampleRateHz * 0.35),
  );
  const stRange = t
    ? ({ end: t.range.start, start: qrsEnd } satisfies EcgIntervalRange)
    : undefined;
  const qtRange = t
    ? ({ end: t.range.end, start: qrsStart } satisfies EcgIntervalRange)
    : undefined;
  const validStRange =
    stRange && isPhysiologicRange(stRange, sampleRateHz, PHYSIOLOGIC_INTERVALS.st)
      ? stRange
      : undefined;
  const validQtRange =
    qtRange && isPhysiologicRange(qtRange, sampleRateHz, PHYSIOLOGIC_INTERVALS.qt)
      ? qtRange
      : undefined;

  return {
    fiducials: {
      qrsOffset: qrsEnd,
      qrsOnset: qrsStart,
      rPeak,
      ...(qPeak === undefined ? {} : { qPeak }),
      ...(sPeak === undefined ? {} : { sPeak }),
      ...(pRange ? { pOffset: pRange.end, pOnset: pRange.start } : {}),
      ...(t && validStRange && validQtRange
        ? { tOffset: t.range.end, tOnset: t.range.start, tPeak: t.peak }
        : {}),
    },
    ranges: {
      qrs: qrsRange,
      ...(pRange ? { p: pRange } : {}),
      ...(validPrRange ? { pr: validPrRange } : {}),
      ...(validQtRange ? { qt: validQtRange } : {}),
      ...(validStRange ? { st: validStRange } : {}),
    },
  };
}

type MutableEcgMeasurements = {
  -readonly [Key in keyof EcgMeasurements]?: EcgMeasurements[Key];
};

function consensusGlobalIntervalDuration(
  detections: readonly EcgLeadIntervalDetection[],
  interval: keyof EcgLeadIntervalDetection['ranges'],
  sampleRateHz: number,
): number | undefined {
  const durations: number[] = [];
  for (const detection of detections) {
    const range = detection.ranges[interval];
    if (range) durations.push(rangeDurationMs(range, sampleRateHz));
  }
  if (durations.length < ECG_INTERVAL_MIN_LEAD_SUPPORT) return undefined;
  const value = median(durations);
  const deviations = durations.map((duration) => Math.abs(duration - value));
  const medianDeviation = median(deviations);
  const maximumDeviation = Math.max(...deviations);
  if (
    !Number.isFinite(value) ||
    medianDeviation > MAX_INTERVAL_MAD_MS ||
    maximumDeviation > MAX_INTERVAL_DEVIATION_MS
  ) {
    return undefined;
  }
  // A device's global interval spans multiple leads; the upper quartile better approximates it
  // than the median without letting one noisy lead control the result like the maximum would.
  durations.sort((left, right) => left - right);
  return Math.round(durations[Math.round((durations.length - 1) * 0.75)] ?? value);
}

/**
 * Returns the currently supported editable QRS draft after strict image/layout/lead gates.
 * P/PR/QT ranges remain review-only until an external benchmark supports exporting them.
 * Drafts are heuristic and require source verification; they are not clinically validated.
 */
export function ecgIntervalSuggestions(result: EcgDigitizationResult): EcgMeasurements {
  const rrMs = result.rrMs;
  if (
    result.quality !== 'usable' ||
    result.layout !== '12x1' ||
    result.sampleRateHz !== 100 ||
    !Number.isFinite(rrMs) ||
    (rrMs ?? 0) < 200 ||
    (rrMs ?? 0) > 5_000
  ) {
    return {};
  }

  const seenLeads = new Set<string>();
  const detections: EcgLeadIntervalDetection[] = [];
  for (const lead of result.leads) {
    if (!ECG_STANDARD_LEADS.includes(lead.name) || seenLeads.has(lead.name)) continue;
    seenLeads.add(lead.name);
    const detection = detectEcgLeadIntervals(lead, result.sampleRateHz, rrMs);
    if (detection) detections.push(detection);
  }

  const suggestions: MutableEcgMeasurements = {
    heartRate: Math.round(60_000 / (rrMs ?? 1)),
    rrMs: Math.round(rrMs ?? 0),
  };
  const qrsMs = consensusGlobalIntervalDuration(detections, 'qrs', result.sampleRateHz);
  return qrsMs === undefined ? {} : { ...suggestions, qrsMs };
}

export function detectEcgWaveMarkers(
  lead: EcgDigitizedLead,
  sampleRateHz: number,
  rrMs?: number,
): readonly EcgWaveMarker[] {
  const finite = [...lead.samples].filter(Number.isFinite);
  if (finite.length < lead.samples.length * 0.7 || sampleRateHz < 25) return [];
  const baseline = median(finite);
  const centered = Float32Array.from(lead.samples, (value) =>
    Number.isFinite(value) ? value - baseline : Number.NaN,
  );
  const before = Math.round(sampleRateHz * 0.12);
  const after = Math.round(sampleRateHz * 0.5);
  let qrsCenter = before;
  let maximumSlope = 0;
  for (let index = before; index < centered.length - after; index += 1) {
    const left = centered[index - 2];
    const right = centered[index + 2];
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    const slope = Math.abs((right ?? 0) - (left ?? 0));
    if (slope > maximumSlope) {
      maximumSlope = slope;
      qrsCenter = index;
    }
  }
  if (maximumSlope < 0.02) return [];

  const qrsRadius = Math.round(sampleRateHz * 0.11);
  const qrsStart = Math.max(0, qrsCenter - qrsRadius);
  const qrsEnd = Math.min(centered.length, qrsCenter + qrsRadius + 1);
  const rIndex = extremeIndex(centered, qrsStart, qrsEnd, (value) => value);
  if (rIndex === undefined) return [];
  const qIndex = extremeIndex(centered, qrsStart, rIndex + 1, (value) => -value);
  const sIndex = extremeIndex(centered, rIndex, qrsEnd, (value) => -value);
  const tStart = Math.min(centered.length, rIndex + Math.round(sampleRateHz * 0.12));
  const tWindowSeconds = rrMs ? Math.min(0.5, (rrMs / 1_000) * 0.7) : 0.45;
  const tEnd = Math.min(centered.length, rIndex + Math.round(sampleRateHz * tWindowSeconds));
  if (tEnd - tStart < Math.round(sampleRateHz * 0.08)) return [];
  const tIndex = extremeIndex(centered, tStart, tEnd, (value) => Math.abs(value));
  if (qIndex === undefined || sIndex === undefined || tIndex === undefined) return [];

  return [
    { wave: 'Q', index: qIndex, amplitudeMv: centered[qIndex] ?? 0 },
    { wave: 'R', index: rIndex, amplitudeMv: centered[rIndex] ?? 0 },
    { wave: 'S', index: sIndex, amplitudeMv: centered[sIndex] ?? 0 },
    { wave: 'T', index: tIndex, amplitudeMv: centered[tIndex] ?? 0 },
  ];
}

export function ecgAmplitudeSuggestions(
  result: EcgDigitizationResult,
): Partial<Record<EcgNumericFeatureId, number>> {
  if (result.quality !== 'usable') return {};
  const markersByLead = new Map<string, readonly EcgWaveMarker[]>(
    result.leads.map((lead) => [
      lead.name,
      detectEcgWaveMarkers(lead, result.sampleRateHz, result.rrMs),
    ]),
  );
  const suggestions: Partial<Record<EcgNumericFeatureId, number>> = {};
  for (const feature of ECG_NUMERIC_FEATURES.slice(6)) {
    const match = /^(Q|R|S|T)_Amp_(.+)$/u.exec(feature.id);
    const wave = match?.[1] as EcgWaveName | undefined;
    const lead = match?.[2];
    if (!wave || !lead) continue;
    const marker = markersByLead.get(lead)?.find((candidate) => candidate.wave === wave);
    if (marker) suggestions[feature.id] = Math.round(marker.amplitudeMv * 1_000) / 1_000;
  }
  return suggestions;
}
