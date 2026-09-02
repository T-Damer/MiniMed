export type EcgIntervalId = 'rr' | 'p' | 'pr' | 'qrs' | 'qt';

export const ECG_PAPER_SPEED_MM_PER_SECOND = 50;
export const ECG_SENSITIVITY_MM_PER_MILLIVOLT = 10;
export const ECG_MILLISECONDS_PER_MILLIMETER = 20;

export interface EcgPointPair {
  readonly start: number;
  readonly end: number;
}

export interface EcgMeasurements {
  readonly rrMs?: number;
  readonly pDurationMs?: number;
  readonly prMs?: number;
  readonly qrsMs?: number;
  readonly qtMs?: number;
  readonly heartRate?: number;
  readonly qtcBazettMs?: number;
  readonly qtcFridericiaMs?: number;
  readonly qtcFraminghamMs?: number;
}

export function shiftEcgPointPair(pair: EcgPointPair, delta: number, width: number): EcgPointPair {
  const left = Math.min(pair.start, pair.end);
  const right = Math.max(pair.start, pair.end);
  const clampedDelta = Math.max(-left, Math.min(delta, width - right));
  return { start: pair.start + clampedDelta, end: pair.end + clampedDelta };
}

export function rescaleEcgPointPair(
  pair: EcgPointPair,
  previousWidth: number,
  nextWidth: number,
): EcgPointPair {
  if (
    !Number.isFinite(previousWidth) ||
    previousWidth <= 0 ||
    !Number.isFinite(nextWidth) ||
    nextWidth <= 0
  ) {
    return pair;
  }
  const scale = nextWidth / previousWidth;
  const clamp = (value: number): number => Math.max(0, Math.min(nextWidth, value * scale));
  return { start: clamp(pair.start), end: clamp(pair.end) };
}

export function calculateEcgMeasurements(
  pairs: Readonly<Partial<Record<EcgIntervalId, EcgPointPair>>>,
  pixelsPerMillimeter: number,
): EcgMeasurements {
  if (!Number.isFinite(pixelsPerMillimeter) || pixelsPerMillimeter <= 0) return {};
  const milliseconds = (pair: EcgPointPair | undefined): number | undefined => {
    if (!pair || !Number.isFinite(pair.start) || !Number.isFinite(pair.end)) return undefined;
    const distance = Math.abs(pair.end - pair.start);
    if (distance <= 0) return undefined;
    return Math.round((distance / pixelsPerMillimeter) * ECG_MILLISECONDS_PER_MILLIMETER);
  };
  const rrMs = milliseconds(pairs.rr);
  const pDurationMs = milliseconds(pairs.p);
  const prMs = milliseconds(pairs.pr);
  const qrsMs = milliseconds(pairs.qrs);
  const qtMs = milliseconds(pairs.qt);
  const rrSeconds = rrMs ? rrMs / 1000 : undefined;

  return {
    ...(rrMs ? { rrMs, heartRate: Math.round(60000 / rrMs) } : {}),
    ...(pDurationMs ? { pDurationMs } : {}),
    ...(prMs ? { prMs } : {}),
    ...(qrsMs ? { qrsMs } : {}),
    ...(qtMs ? { qtMs } : {}),
    ...(qtMs && rrSeconds
      ? {
          qtcBazettMs: Math.round(qtMs / Math.sqrt(rrSeconds)),
          qtcFridericiaMs: Math.round(qtMs / Math.cbrt(rrSeconds)),
          qtcFraminghamMs: Math.round(qtMs + 154 * (1 - rrSeconds)),
        }
      : {}),
  };
}
