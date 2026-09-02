import type {
  EcgMorphologyObservations,
  EcgObservationState,
} from '@/features/calculators/ecg-photo-interpreter';

const MIN_PR_MS = 80;
const MAX_PR_MS = 400;
const FIXED_PR_RANGE_MS = 30;
const MIN_PROGRESSIVE_PR_STEP_MS = 20;
const MIN_STABLE_COUPLING = 0.8;
const MAX_REGULAR_INTERVAL_CV = 0.08;

type AvSequenceObservationId =
  | 'oneToOneAvConduction'
  | 'periodicNonConductedPWaves'
  | 'progressivePrBeforeDroppedQrs'
  | 'constantPrAroundDroppedQrs'
  | 'everySecondPConducted'
  | 'twoOrMoreConsecutiveNonConductedPWaves'
  | 'someAvConductionPresent'
  | 'avDissociation'
  | 'distinctPWavesAbsent';

export type EcgAvSequenceMorphologyPatch = {
  -readonly [Id in AvSequenceObservationId]?: EcgMorphologyObservations[Id];
};

export type EcgAvSequencePattern =
  | 'insufficient'
  | 'one-to-one'
  | 'mobitz-i'
  | 'mobitz-ii'
  | 'two-to-one'
  | 'high-grade'
  | 'av-dissociation'
  | 'unclassified';

export interface EcgEventTimesParseResult {
  readonly error?: string;
  readonly values: readonly number[];
}

export interface EcgAvSequenceAnalysis {
  readonly conductedPCount: number;
  readonly couplingCoverage: number;
  readonly morphology: EcgAvSequenceMorphologyPatch;
  readonly pCount: number;
  readonly pattern: EcgAvSequencePattern;
  readonly prRangeMs?: number;
  readonly qrsCount: number;
  readonly summary: string;
}

interface ConductedPair {
  readonly pIndex: number;
  readonly prMs: number;
}

function observation(value: boolean): EcgObservationState {
  return value ? 'present' : 'absent';
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const average = mean(values);
  if (average <= 0) return Number.POSITIVE_INFINITY;
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / average;
}

function differences(values: readonly number[]): number[] {
  const result: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current !== undefined && previous !== undefined) result.push(current - previous);
  }
  return result;
}

function maximumFalseRun(values: readonly boolean[]): number {
  let maximum = 0;
  let current = 0;
  for (const value of values) {
    current = value ? 0 : current + 1;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function precedingPIndex(pOnsetsMs: readonly number[], qrsOnsetMs: number): number {
  for (let index = pOnsetsMs.length - 1; index >= 0; index -= 1) {
    const pOnsetMs = pOnsetsMs[index];
    if (pOnsetMs !== undefined && pOnsetMs < qrsOnsetMs) return index;
  }
  return -1;
}

function conductedPairs(
  pOnsetsMs: readonly number[],
  qrsOnsetsMs: readonly number[],
): { readonly pairs: readonly ConductedPair[]; readonly qrsWithPrecedingP: number } {
  const pairs: ConductedPair[] = [];
  const usedP = new Set<number>();
  let qrsWithPrecedingP = 0;
  for (const qrsOnsetMs of qrsOnsetsMs) {
    const pIndex = precedingPIndex(pOnsetsMs, qrsOnsetMs);
    if (pIndex < 0) continue;
    qrsWithPrecedingP += 1;
    const pOnsetMs = pOnsetsMs[pIndex];
    if (pOnsetMs === undefined) continue;
    const prMs = qrsOnsetMs - pOnsetMs;
    if (prMs < MIN_PR_MS || prMs > MAX_PR_MS || usedP.has(pIndex)) continue;
    usedP.add(pIndex);
    pairs.push({ pIndex, prMs });
  }
  return { pairs, qrsWithPrecedingP };
}

export function parseEcgEventTimes(raw: string): EcgEventTimesParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { values: [] };
  const tokens = trimmed.split(/[\s,;]+/u).filter(Boolean);
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 600_000)) {
    return {
      values: [],
      error:
        'Используйте неотрицательные значения в миллисекундах, разделённые пробелами или запятыми.',
    };
  }
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    const previous = values[index - 1];
    if (value !== undefined && previous !== undefined && value <= previous) {
      return { values: [], error: 'Метки должны идти по возрастанию без повторов.' };
    }
  }
  return { values };
}

export function analyzeEcgAvSequence(input: {
  readonly pOnsetsMs: readonly number[];
  readonly qrsOnsetsMs: readonly number[];
}): EcgAvSequenceAnalysis {
  const { pOnsetsMs, qrsOnsetsMs } = input;
  if (pOnsetsMs.length < 3 || qrsOnsetsMs.length < 3) {
    return {
      conductedPCount: 0,
      couplingCoverage: 0,
      morphology: {},
      pCount: pOnsetsMs.length,
      pattern: 'insufficient',
      qrsCount: qrsOnsetsMs.length,
      summary: 'Нужно минимум по три метки P и QRS.',
    };
  }

  const { pairs, qrsWithPrecedingP } = conductedPairs(pOnsetsMs, qrsOnsetsMs);
  const couplingCoverage = pairs.length / Math.max(1, qrsWithPrecedingP);
  const stableCoupling = pairs.length >= 3 && couplingCoverage >= MIN_STABLE_COUPLING;
  const conducted = pOnsetsMs.map((_, index) => pairs.some((pair) => pair.pIndex === index));
  const firstConducted = conducted.indexOf(true);
  const lastConducted = conducted.lastIndexOf(true);
  const assessedConducted =
    firstConducted >= 0 && lastConducted >= firstConducted
      ? conducted.slice(firstConducted, lastConducted + 1)
      : conducted;
  const maximumNonConductedRun = maximumFalseRun(assessedConducted);
  const pIndexes = pairs.map((pair) => pair.pIndex);
  const prValues = pairs.map((pair) => pair.prMs);
  const pIndexGaps = differences(pIndexes);
  const prChanges = differences(prValues);
  const prRangeMs = prValues.length > 0 ? Math.max(...prValues) - Math.min(...prValues) : undefined;
  const prRange = prRangeMs === undefined ? {} : { prRangeMs };
  const periodicNonConduction = stableCoupling && maximumNonConductedRun > 0;
  const everySecondPConducted =
    periodicNonConduction && pairs.length >= 3 && pIndexGaps.every((gap) => gap === 2);
  const fixedPr =
    periodicNonConduction && prRangeMs !== undefined && prRangeMs <= FIXED_PR_RANGE_MS;
  const progressiveSteps = prChanges.filter(
    (change, index) => pIndexGaps[index] === 1 && change >= MIN_PROGRESSIVE_PR_STEP_MS,
  ).length;
  const resetSteps = prChanges.filter(
    (change, index) => (pIndexGaps[index] ?? 0) > 1 && change <= -MIN_PROGRESSIVE_PR_STEP_MS,
  ).length;
  const progressivePr = periodicNonConduction && progressiveSteps >= 2 && resetSteps >= 1;
  const pIntervals = differences(pOnsetsMs);
  const qrsIntervals = differences(qrsOnsetsMs);
  const avDissociation =
    !stableCoupling &&
    coefficientOfVariation(pIntervals) <= MAX_REGULAR_INTERVAL_CV &&
    coefficientOfVariation(qrsIntervals) <= MAX_REGULAR_INTERVAL_CV &&
    mean(qrsIntervals) > mean(pIntervals) * 1.15;
  const oneToOne =
    stableCoupling && pairs.length === pOnsetsMs.length && pairs.length === qrsOnsetsMs.length;

  const morphology: EcgAvSequenceMorphologyPatch = {
    distinctPWavesAbsent: 'absent',
  };
  if (oneToOne) {
    Object.assign(morphology, {
      avDissociation: 'absent',
      everySecondPConducted: 'absent',
      oneToOneAvConduction: 'present',
      periodicNonConductedPWaves: 'absent',
      someAvConductionPresent: 'present',
      twoOrMoreConsecutiveNonConductedPWaves: 'absent',
    } satisfies EcgAvSequenceMorphologyPatch);
    return {
      conductedPCount: pairs.length,
      couplingCoverage,
      morphology,
      pCount: pOnsetsMs.length,
      pattern: 'one-to-one',
      ...prRange,
      qrsCount: qrsOnsetsMs.length,
      summary: 'Последовательность совместима с проведением P→QRS 1:1.',
    };
  }

  if (avDissociation) {
    Object.assign(morphology, {
      avDissociation: 'present',
      everySecondPConducted: 'absent',
      oneToOneAvConduction: 'absent',
      someAvConductionPresent: 'absent',
      twoOrMoreConsecutiveNonConductedPWaves: 'present',
    } satisfies EcgAvSequenceMorphologyPatch);
    return {
      conductedPCount: pairs.length,
      couplingCoverage,
      morphology,
      pCount: pOnsetsMs.length,
      pattern: 'av-dissociation',
      ...prRange,
      qrsCount: qrsOnsetsMs.length,
      summary:
        'Есть числовой паттерн независимых регулярных P и QRS; проверьте AV-диссоциацию вручную.',
    };
  }

  if (!stableCoupling) {
    Object.assign(morphology, {
      avDissociation: 'unknown',
      oneToOneAvConduction: 'unknown',
      someAvConductionPresent: 'unknown',
    } satisfies EcgAvSequenceMorphologyPatch);
    return {
      conductedPCount: pairs.length,
      couplingCoverage,
      morphology,
      pCount: pOnsetsMs.length,
      pattern: 'unclassified',
      ...prRange,
      qrsCount: qrsOnsetsMs.length,
      summary: 'Устойчивая связь P→QRS не определена; автоматический черновик воздерживается.',
    };
  }

  Object.assign(morphology, {
    avDissociation: 'absent',
    everySecondPConducted: observation(everySecondPConducted),
    oneToOneAvConduction: 'absent',
    periodicNonConductedPWaves: observation(periodicNonConduction),
    someAvConductionPresent: 'present',
    twoOrMoreConsecutiveNonConductedPWaves: observation(maximumNonConductedRun >= 2),
  } satisfies EcgAvSequenceMorphologyPatch);
  if (progressivePr) {
    morphology.progressivePrBeforeDroppedQrs = 'present';
    morphology.constantPrAroundDroppedQrs = 'absent';
  } else if (fixedPr) {
    morphology.progressivePrBeforeDroppedQrs = 'absent';
    morphology.constantPrAroundDroppedQrs = 'present';
  }

  const pattern: EcgAvSequencePattern =
    maximumNonConductedRun >= 2
      ? 'high-grade'
      : everySecondPConducted
        ? 'two-to-one'
        : progressivePr
          ? 'mobitz-i'
          : fixedPr
            ? 'mobitz-ii'
            : 'unclassified';
  const summary =
    pattern === 'high-grade'
      ? 'Есть минимум два последовательных непроведённых P при сохранённом проведении.'
      : pattern === 'two-to-one'
        ? 'Последовательность совместима с проведением 2:1.'
        : pattern === 'mobitz-i'
          ? 'PR прогрессивно удлиняется и сбрасывается после непроведённого P.'
          : pattern === 'mobitz-ii'
            ? 'PR остаётся постоянным вокруг периодически непроведённых P.'
            : 'Последовательность не соответствует одному поддерживаемому паттерну.';
  return {
    conductedPCount: pairs.length,
    couplingCoverage,
    morphology,
    pCount: pOnsetsMs.length,
    pattern,
    ...prRange,
    qrsCount: qrsOnsetsMs.length,
    summary,
  };
}
