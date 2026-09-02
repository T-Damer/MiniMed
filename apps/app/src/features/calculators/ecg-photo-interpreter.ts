import type { EcgMeasurements } from '@/features/calculators/ecg-photo-caliper';

export const ECG_MIN_IMAGE_WIDTH_PX = 1200;
export const ECG_MIN_IMAGE_HEIGHT_PX = 600;

export const ECG_ADULT_SCREENING_LIMITS = {
  heartRateBradycardiaBpm: 50,
  heartRateTachycardiaBpm: 100,
  prShortMs: 120,
  prLongMs: 200,
  qrsWideMs: 120,
  qtcReviewFemaleMs: 460,
  qtcReviewMaleMs: 450,
  qtcReviewUnknownSexMs: 470,
  qtcUrgentMs: 500,
} as const;

export const ECG_REFERENCE_IDS = {
  intervals: 'aha-accf-hrs-2007-part-i',
  conduction: 'aha-accf-hrs-2009-part-iii',
  avConduction: 'acc-aha-hrs-2018-bradycardia',
  atrialFibrillation: 'acc-aha-accp-hrs-2023-atrial-fibrillation',
  qt: 'aha-accf-hrs-2008-part-iv',
} as const;

export type EcgReferenceId = (typeof ECG_REFERENCE_IDS)[keyof typeof ECG_REFERENCE_IDS];

export type EcgEligibilityIssueId =
  | 'adult-confirmation-required'
  | 'recording-profile-confirmation-required'
  | 'image-not-ready'
  | 'image-too-small'
  | 'image-not-horizontal'
  | 'grid-calibration-required';

export interface EcgPhotoEligibilityInput {
  readonly adultConfirmed: boolean;
  readonly recordingProfileConfirmed: boolean;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly pixelsPerMillimeter: number;
}

export interface EcgEligibilityIssue {
  readonly id: EcgEligibilityIssueId;
  readonly text: string;
}

export interface EcgPhotoEligibility {
  readonly eligible: boolean;
  readonly issues: readonly EcgEligibilityIssue[];
}

export type EcgFindingStatus = 'normal' | 'finding' | 'urgent-review';
export type EcgFindingSeverity = 'normal' | 'attention' | 'urgent';

export type EcgEvidenceMetric =
  | 'heartRate'
  | 'prMs'
  | 'qrsMs'
  | 'qtcBazettMs'
  | 'qtcFraminghamMs'
  | 'qtcFridericiaMs';

export type EcgFindingEvidence =
  | {
      readonly metric: EcgEvidenceMetric;
      readonly measurement: string;
      readonly value: number;
      readonly unit: 'мс' | '/мин';
      readonly threshold: string;
      readonly formula?: 'Bazett' | 'Framingham' | 'Fridericia';
    }
  | {
      readonly metric: 'rhythmPattern';
      readonly measurement: string;
      readonly value: string;
      readonly threshold: string;
      readonly formula?: never;
      readonly unit?: never;
    };

export interface EcgFinding {
  readonly id: string;
  readonly status: EcgFindingStatus;
  readonly severity: EcgFindingSeverity;
  readonly text: string;
  readonly evidence: EcgFindingEvidence;
  readonly criteria?: readonly string[];
  readonly sourceId: EcgReferenceId;
}

export type EcgObservationState = 'unknown' | 'present' | 'absent';

export interface EcgMorphologyObservations {
  readonly oneToOneAvConduction?: EcgObservationState;
  readonly periodicNonConductedPWaves?: EcgObservationState;
  readonly progressivePrBeforeDroppedQrs?: EcgObservationState;
  readonly constantPrAroundDroppedQrs?: EcgObservationState;
  readonly everySecondPConducted?: EcgObservationState;
  readonly twoOrMoreConsecutiveNonConductedPWaves?: EcgObservationState;
  readonly someAvConductionPresent?: EcgObservationState;
  readonly avDissociation?: EcgObservationState;
  readonly blockedPrematureAtrialBeatExcluded?: EcgObservationState;
  readonly deltaWave?: EcgObservationState;
  readonly dominantQrsSupraventricular?: EcgObservationState;
  readonly pacedQrs?: EcgObservationState;
  readonly avlQrPattern?: EcgObservationState;
  readonly inferiorRsPattern?: EcgObservationState;
  readonly rrIntervalsIrregular?: EcgObservationState;
  readonly distinctPWavesAbsent?: EcgObservationState;
  readonly fibrillatoryAtrialActivity?: EcgObservationState;
  readonly rightPrecordialTerminalRPrime?: EcgObservationState;
  readonly lateralWideTerminalS?: EcgObservationState;
  readonly lateralBroadNotchedR?: EcgObservationState;
  readonly lateralQWaveAbsent?: EcgObservationState;
  readonly lateralRPeakTimeOver60Ms?: EcgObservationState;
}

export type EcgMissingDataId = 'heart-rate' | 'pr' | 'qrs' | 'qtc';

export interface EcgMissingData {
  readonly id: EcgMissingDataId;
  readonly text: string;
}

export type EcgInterpretationStatus =
  | 'not-eligible'
  | 'requires-review'
  | 'normal'
  | 'finding'
  | 'urgent-review';

export interface EcgInterpretationInput extends EcgPhotoEligibilityInput {
  readonly measurements: EcgMeasurements;
  readonly morphology?: EcgMorphologyObservations;
  readonly sex?: EcgPatientSex;
}

export interface EcgInterpretation {
  readonly eligible: boolean;
  readonly status: EcgInterpretationStatus;
  readonly eligibility: EcgPhotoEligibility;
  readonly findings: readonly EcgFinding[];
  readonly missingData: readonly EcgMissingData[];
}

export interface EcgAdultMeasurementInterpretationInput {
  readonly measurements: EcgMeasurements;
  readonly morphology?: EcgMorphologyObservations;
  readonly sex?: EcgPatientSex;
}

export interface EcgAdultMeasurementInterpretation {
  readonly status: Exclude<EcgInterpretationStatus, 'not-eligible'>;
  readonly findings: readonly EcgFinding[];
  readonly missingData: readonly EcgMissingData[];
}

interface QtcCandidate {
  readonly metric: 'qtcBazettMs' | 'qtcFraminghamMs' | 'qtcFridericiaMs';
  readonly formula: 'Bazett' | 'Framingham' | 'Fridericia';
  readonly value: number;
}

export type EcgPatientSex = 'female' | 'male' | 'unknown';

interface QtcReviewThreshold {
  readonly inclusive: boolean;
  readonly value: number;
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function displayValue(value: number): number {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

function makeFinding(
  id: string,
  status: EcgFindingStatus,
  severity: EcgFindingSeverity,
  text: string,
  evidence: EcgFindingEvidence,
  sourceId: EcgReferenceId,
  criteria?: readonly string[],
): EcgFinding {
  return { id, status, severity, text, evidence, sourceId, ...(criteria ? { criteria } : {}) };
}

function avConductionSequenceFinding(
  morphology: EcgMorphologyObservations | undefined,
): EcgFinding | undefined {
  const sequenceIsReviewable =
    morphology?.distinctPWavesAbsent === 'absent' &&
    morphology.oneToOneAvConduction === 'absent' &&
    morphology.pacedQrs === 'absent' &&
    morphology.blockedPrematureAtrialBeatExcluded === 'present';
  if (!sequenceIsReviewable) return undefined;

  if (
    morphology.everySecondPConducted === 'absent' &&
    morphology.twoOrMoreConsecutiveNonConductedPWaves === 'present' &&
    morphology.someAvConductionPresent === 'absent' &&
    morphology.avDissociation === 'present'
  ) {
    return makeFinding(
      'complete-av-block-pattern',
      'urgent-review',
      'urgent',
      'Подтверждённая последовательность совместима с паттерном полной AV-блокады: P и QRS идут независимо, признаков проведения нет. Требуется срочная врачебная оценка.',
      {
        metric: 'rhythmPattern',
        measurement: 'AV-проведение',
        value: 'AV-диссоциация',
        threshold: 'нет признаков проведения P→QRS',
      },
      ECG_REFERENCE_IDS.avConduction,
      [
        'Различимые P-волны подтверждены',
        'Подтверждены минимум два последовательных непроведённых P',
        'P и QRS идут независимо; проведение P→QRS не обнаружено',
        'Заблокированная предсердная экстрасистола и стимуляция исключены',
      ],
    );
  }

  if (
    morphology.everySecondPConducted === 'absent' &&
    morphology.periodicNonConductedPWaves === 'present' &&
    morphology.twoOrMoreConsecutiveNonConductedPWaves === 'present' &&
    morphology.someAvConductionPresent === 'present' &&
    morphology.avDissociation === 'absent'
  ) {
    return makeFinding(
      'high-grade-av-block-pattern',
      'urgent-review',
      'urgent',
      'Подтверждённая последовательность совместима с паттерном высокоградусной AV-блокады: два или больше P подряд не проводятся, но отдельное AV-проведение сохраняется. Требуется срочная врачебная оценка.',
      {
        metric: 'rhythmPattern',
        measurement: 'AV-проведение',
        value: 'частичное проведение сохраняется',
        threshold: '≥2 последовательных P не проводятся',
      },
      ECG_REFERENCE_IDS.avConduction,
      [
        'Подтверждены минимум два последовательных непроведённых P',
        'Отдельные P всё же проводятся в QRS',
        'AV-диссоциация, паттерн 2:1, заблокированная предсердная экстрасистола и стимуляция исключены',
      ],
    );
  }

  if (
    morphology.everySecondPConducted === 'present' &&
    morphology.periodicNonConductedPWaves === 'present' &&
    morphology.twoOrMoreConsecutiveNonConductedPWaves === 'absent' &&
    morphology.someAvConductionPresent === 'present' &&
    morphology.avDissociation === 'absent'
  ) {
    return makeFinding(
      'two-to-one-av-conduction-pattern',
      'finding',
      'attention',
      'Подтверждённая последовательность совместима с паттерном AV-блокады 2:1; по этому фрагменту нельзя называть её Mobitz I или Mobitz II.',
      {
        metric: 'rhythmPattern',
        measurement: 'AV-проведение',
        value: '2:1',
        threshold: 'каждый второй P проводится в QRS',
      },
      ECG_REFERENCE_IDS.avConduction,
      [
        'Различимые P-волны подтверждены',
        'Каждый второй P проводится в QRS',
        'Заблокированная предсердная экстрасистола и стимуляция исключены',
      ],
    );
  }

  if (
    morphology.everySecondPConducted !== 'absent' ||
    morphology.periodicNonConductedPWaves !== 'present' ||
    morphology.twoOrMoreConsecutiveNonConductedPWaves !== 'absent' ||
    morphology.someAvConductionPresent !== 'present' ||
    morphology.avDissociation !== 'absent'
  ) {
    return undefined;
  }

  if (
    morphology.progressivePrBeforeDroppedQrs === 'present' &&
    morphology.constantPrAroundDroppedQrs === 'absent'
  ) {
    return makeFinding(
      'mobitz-i-av-block-pattern',
      'finding',
      'attention',
      'Подтверждённая последовательность совместима с паттерном AV-блокады II степени типа Mobitz I (Венкебах); требуется проверка врачом.',
      {
        metric: 'rhythmPattern',
        measurement: 'AV-проведение',
        value: 'периодическое непроведение P',
        threshold: 'PR прогрессивно удлиняется перед выпадением QRS',
      },
      ECG_REFERENCE_IDS.avConduction,
      [
        'Периодический непроведённый P подтверждён',
        'PR прогрессивно удлиняется перед выпадением QRS',
        'Паттерн 2:1, заблокированная предсердная экстрасистола и стимуляция исключены',
      ],
    );
  }

  if (
    morphology.constantPrAroundDroppedQrs === 'present' &&
    morphology.progressivePrBeforeDroppedQrs === 'absent'
  ) {
    return makeFinding(
      'mobitz-ii-av-block-pattern',
      'finding',
      'attention',
      'Подтверждённая последовательность совместима с паттерном AV-блокады II степени типа Mobitz II; требуется проверка врачом.',
      {
        metric: 'rhythmPattern',
        measurement: 'AV-проведение',
        value: 'периодическое непроведение P',
        threshold: 'PR до и после выпадения QRS остаётся постоянным',
      },
      ECG_REFERENCE_IDS.avConduction,
      [
        'Периодический непроведённый P подтверждён',
        'PR до и после выпадения QRS остаётся постоянным',
        'Паттерн 2:1, заблокированная предсердная экстрасистола и стимуляция исключены',
      ],
    );
  }

  return undefined;
}

function qtcCandidates(measurements: EcgMeasurements): readonly QtcCandidate[] {
  const candidates: QtcCandidate[] = [];
  if (isPositiveFinite(measurements.qtcFridericiaMs)) {
    candidates.push({
      metric: 'qtcFridericiaMs',
      formula: 'Fridericia',
      value: measurements.qtcFridericiaMs,
    });
  }
  if (isPositiveFinite(measurements.qtcFraminghamMs)) {
    candidates.push({
      metric: 'qtcFraminghamMs',
      formula: 'Framingham',
      value: measurements.qtcFraminghamMs,
    });
  }
  if (isPositiveFinite(measurements.qtcBazettMs)) {
    candidates.push({
      metric: 'qtcBazettMs',
      formula: 'Bazett',
      value: measurements.qtcBazettMs,
    });
  }

  const rrMs = measurements.rrMs;
  const qtMs = measurements.qtMs;
  if (candidates.length === 0 && isPositiveFinite(rrMs) && isPositiveFinite(qtMs)) {
    const rrSeconds = rrMs / 1000;
    candidates.push(
      {
        metric: 'qtcFridericiaMs',
        formula: 'Fridericia',
        value: qtMs / Math.cbrt(rrSeconds),
      },
      {
        metric: 'qtcBazettMs',
        formula: 'Bazett',
        value: qtMs / Math.sqrt(rrSeconds),
      },
    );
  }

  return candidates.filter((candidate) => Number.isFinite(candidate.value));
}

function preferredQtc(candidates: readonly QtcCandidate[]): QtcCandidate | undefined {
  return (
    candidates.find((candidate) => candidate.formula === 'Fridericia') ??
    candidates.find((candidate) => candidate.formula === 'Framingham') ??
    candidates.find((candidate) => candidate.formula === 'Bazett')
  );
}

function qtcReviewThreshold(sex: EcgPatientSex | undefined): QtcReviewThreshold {
  if (sex === 'female') {
    return { inclusive: true, value: ECG_ADULT_SCREENING_LIMITS.qtcReviewFemaleMs };
  }
  if (sex === 'male') {
    return { inclusive: false, value: ECG_ADULT_SCREENING_LIMITS.qtcReviewMaleMs };
  }
  return { inclusive: false, value: ECG_ADULT_SCREENING_LIMITS.qtcReviewUnknownSexMs };
}

export function assessEcgPhotoEligibility(input: EcgPhotoEligibilityInput): EcgPhotoEligibility {
  const issues: EcgEligibilityIssue[] = [];
  if (!input.adultConfirmed) {
    issues.push({
      id: 'adult-confirmation-required',
      text: 'Укажите дату рождения и дату ЭКГ; взрослые правила доступны с 18 лет.',
    });
  }
  if (!input.recordingProfileConfirmed) {
    issues.push({
      id: 'recording-profile-confirmation-required',
      text: 'Подтвердите на записи 50 мм/с, 10 мм/мВ и наличие всех 12 отведений.',
    });
  }

  const hasImageDimensions =
    Number.isFinite(input.imageWidth) &&
    Number.isFinite(input.imageHeight) &&
    input.imageWidth > 0 &&
    input.imageHeight > 0;
  if (!hasImageDimensions) {
    issues.push({
      id: 'image-not-ready',
      text: 'Загрузите изображение и дождитесь его полной загрузки.',
    });
  } else {
    if (input.imageWidth < ECG_MIN_IMAGE_WIDTH_PX || input.imageHeight < ECG_MIN_IMAGE_HEIGHT_PX) {
      issues.push({
        id: 'image-too-small',
        text: `Нужно изображение не меньше ${ECG_MIN_IMAGE_WIDTH_PX}×${ECG_MIN_IMAGE_HEIGHT_PX} пикселей.`,
      });
    }
    if (input.imageWidth <= input.imageHeight) {
      issues.push({
        id: 'image-not-horizontal',
        text: 'Нужно горизонтальное изображение стандартной 12-отведённой ЭКГ.',
      });
    }
  }

  if (!Number.isFinite(input.pixelsPerMillimeter) || input.pixelsPerMillimeter <= 0) {
    issues.push({
      id: 'grid-calibration-required',
      text: 'Проведите калибровку по отрезку сетки 25 мм.',
    });
  }

  return { eligible: issues.length === 0, issues };
}

function makeMissingData(measurements: EcgMeasurements): readonly EcgMissingData[] {
  const missing: EcgMissingData[] = [];
  const heartRate = isPositiveFinite(measurements.heartRate)
    ? measurements.heartRate
    : isPositiveFinite(measurements.rrMs)
      ? 60000 / measurements.rrMs
      : undefined;

  if (!heartRate) {
    missing.push({
      id: 'heart-rate',
      text: 'Не измерен RR — ЧСС по частоте не оценивается.',
    });
  }
  if (!isPositiveFinite(measurements.prMs)) {
    missing.push({ id: 'pr', text: 'PR не измерен — признак AV-проведения не оценивается.' });
  }
  if (!isPositiveFinite(measurements.qrsMs)) {
    missing.push({ id: 'qrs', text: 'QRS не измерен — длительность комплекса не оценивается.' });
  }
  if (qtcCandidates(measurements).length === 0) {
    const hasQt = isPositiveFinite(measurements.qtMs);
    const hasRr = isPositiveFinite(measurements.rrMs);
    missing.push({
      id: 'qtc',
      text:
        hasQt && !hasRr
          ? 'Для QTc нужен измеренный RR.'
          : !hasQt && hasRr
            ? 'Для QTc нужен измеренный QT.'
            : 'Для оценки QTc нужны измеренные QT и RR.',
    });
  }
  return missing;
}

export function interpretAdultEcgMeasurements(
  input: EcgAdultMeasurementInterpretationInput,
): EcgAdultMeasurementInterpretation {
  const measurements = input.measurements;
  const findings: EcgFinding[] = [];
  const heartRate = isPositiveFinite(measurements.heartRate)
    ? measurements.heartRate
    : isPositiveFinite(measurements.rrMs)
      ? 60000 / measurements.rrMs
      : undefined;

  if (heartRate !== undefined) {
    const displayHeartRate = displayValue(heartRate);
    if (heartRate >= ECG_ADULT_SCREENING_LIMITS.heartRateTachycardiaBpm) {
      findings.push(
        makeFinding(
          'heart-rate-tachycardia',
          'finding',
          'attention',
          'ЧСС ≥100/мин (признак тахикардии по частоте).',
          {
            metric: 'heartRate',
            measurement: 'ЧСС',
            value: displayHeartRate,
            unit: '/мин',
            threshold: '≥100 /мин',
          },
          ECG_REFERENCE_IDS.intervals,
        ),
      );
    } else if (heartRate < ECG_ADULT_SCREENING_LIMITS.heartRateBradycardiaBpm) {
      findings.push(
        makeFinding(
          'heart-rate-bradycardia',
          'finding',
          'attention',
          'ЧСС <50/мин (признак брадикардии по частоте).',
          {
            metric: 'heartRate',
            measurement: 'ЧСС',
            value: displayHeartRate,
            unit: '/мин',
            threshold: '<50 /мин',
          },
          ECG_REFERENCE_IDS.intervals,
        ),
      );
    } else {
      findings.push(
        makeFinding(
          'heart-rate-within-screening-range',
          'normal',
          'normal',
          'ЧСС в измеренном диапазоне 50–99/мин.',
          {
            metric: 'heartRate',
            measurement: 'ЧСС',
            value: displayHeartRate,
            unit: '/мин',
            threshold: '50–99 /мин',
          },
          ECG_REFERENCE_IDS.intervals,
        ),
      );
    }
  }

  const morphology = input.morphology;
  const hasAtrialFibrillationPattern =
    morphology?.rrIntervalsIrregular === 'present' &&
    morphology.distinctPWavesAbsent === 'present' &&
    morphology.fibrillatoryAtrialActivity === 'present' &&
    morphology.oneToOneAvConduction !== 'present';
  if (hasAtrialFibrillationPattern) {
    findings.push(
      makeFinding(
        'atrial-fibrillation-pattern',
        'finding',
        'attention',
        'Визуальные признаки на представленном фрагменте совместимы с паттерном фибрилляции предсердий; первичный диагноз требует проверки врачом по самой записи.',
        {
          metric: 'rhythmPattern',
          measurement: 'Ритм',
          value: 'нерегулярно-нерегулярный',
          threshold: 'все 3 визуальных признака подтверждены',
        },
        ECG_REFERENCE_IDS.atrialFibrillation,
        [
          'RR-интервалы нерегулярны без повторяющегося паттерна',
          'Различимые повторяющиеся P-волны отсутствуют',
          'Нерегулярная предсердная активность или f-волны подтверждены',
        ],
      ),
    );
  }

  const avSequenceFinding = avConductionSequenceFinding(morphology);
  if (avSequenceFinding) findings.push(avSequenceFinding);

  const prMs = measurements.prMs;
  if (isPositiveFinite(prMs)) {
    const displayPr = displayValue(prMs);
    if (prMs < ECG_ADULT_SCREENING_LIMITS.prShortMs) {
      findings.push(
        makeFinding(
          'pr-short',
          'finding',
          'attention',
          'PR короче 120 мс (признак; причина не определяется).',
          {
            metric: 'prMs',
            measurement: 'PR',
            value: displayPr,
            unit: 'мс',
            threshold: '<120 мс',
          },
          ECG_REFERENCE_IDS.intervals,
        ),
      );
    } else if (prMs > ECG_ADULT_SCREENING_LIMITS.prLongMs) {
      findings.push(
        makeFinding(
          'pr-long',
          'finding',
          'attention',
          'PR длиннее 200 мс (признак; причина не определяется).',
          {
            metric: 'prMs',
            measurement: 'PR',
            value: displayPr,
            unit: 'мс',
            threshold: '>200 мс',
          },
          ECG_REFERENCE_IDS.intervals,
        ),
      );
      if (input.morphology?.oneToOneAvConduction === 'present') {
        findings.push(
          makeFinding(
            'first-degree-av-delay-pattern',
            'finding',
            'attention',
            'PR >200 мс и подтверждённое проведение P→QRS 1:1 совместимы с паттерном AV-задержки I степени; требуется проверка врачом.',
            {
              metric: 'prMs',
              measurement: 'PR',
              value: displayPr,
              unit: 'мс',
              threshold: '>200 мс',
            },
            ECG_REFERENCE_IDS.avConduction,
            [`PR ${displayPr} мс (>200 мс)`, 'Все зубцы P проводятся в QRS 1:1'],
          ),
        );
      }
    } else {
      findings.push(
        makeFinding(
          'pr-within-screening-range',
          'normal',
          'normal',
          'PR в измеренном диапазоне 120–200 мс.',
          {
            metric: 'prMs',
            measurement: 'PR',
            value: displayPr,
            unit: 'мс',
            threshold: '120–200 мс',
          },
          ECG_REFERENCE_IDS.intervals,
        ),
      );
    }
  }

  const qrsMs = measurements.qrsMs;
  const hasWpwTypePreexcitation =
    isPositiveFinite(prMs) &&
    prMs < ECG_ADULT_SCREENING_LIMITS.prShortMs &&
    isPositiveFinite(qrsMs) &&
    qrsMs > ECG_ADULT_SCREENING_LIMITS.qrsWideMs &&
    input.morphology?.deltaWave === 'present';
  if (isPositiveFinite(qrsMs)) {
    const displayQrs = displayValue(qrsMs);
    if (qrsMs >= ECG_ADULT_SCREENING_LIMITS.qrsWideMs) {
      const evidence: EcgFindingEvidence = {
        metric: 'qrsMs',
        measurement: 'QRS',
        value: displayQrs,
        unit: 'мс',
        threshold: '≥120 мс',
      };
      findings.push(
        makeFinding(
          'qrs-wide',
          'finding',
          'attention',
          'QRS ≥120 мс (широкий комплекс; тип нарушения проводимости определяется только при полном наборе морфологических признаков).',
          evidence,
          ECG_REFERENCE_IDS.conduction,
        ),
      );

      const completeRbbb =
        morphology?.rightPrecordialTerminalRPrime === 'present' &&
        morphology.lateralWideTerminalS === 'present';
      const completeLbbb =
        morphology?.lateralBroadNotchedR === 'present' &&
        morphology.lateralQWaveAbsent === 'present' &&
        morphology.lateralRPeakTimeOver60Ms === 'present';

      if (!hasWpwTypePreexcitation && completeRbbb !== completeLbbb) {
        findings.push(
          completeRbbb
            ? makeFinding(
                'complete-rbbb-pattern',
                'finding',
                'attention',
                'Измерения и подтверждённая морфология совместимы с паттерном полной БПНПГ; требуется проверка врачом.',
                evidence,
                ECG_REFERENCE_IDS.conduction,
                [
                  `QRS ${displayQrs} мс (≥120 мс)`,
                  'rsr′/rsR′/rSR′ в V1–V2 подтверждён',
                  'Широкая терминальная S в I и V6 подтверждена',
                ],
              )
            : makeFinding(
                'complete-lbbb-pattern',
                'finding',
                'attention',
                'Измерения и подтверждённая морфология: признаки совместимы с паттерном полной БЛНПГ; требуется проверка врачом.',
                evidence,
                ECG_REFERENCE_IDS.conduction,
                [
                  `QRS ${displayQrs} мс (≥120 мс)`,
                  'Широкий зазубренный или сглаженный R в I, aVL, V5–V6 подтверждён',
                  'Отсутствие q в I, V5–V6 подтверждено',
                  'Время до пика R >60 мс в V5–V6 подтверждено',
                ],
              ),
        );
      }
    } else {
      findings.push(
        makeFinding(
          'qrs-within-screening-range',
          'normal',
          'normal',
          'QRS короче 120 мс по измеренной длительности.',
          {
            metric: 'qrsMs',
            measurement: 'QRS',
            value: displayQrs,
            unit: 'мс',
            threshold: '<120 мс',
          },
          ECG_REFERENCE_IDS.intervals,
        ),
      );
    }
  }

  if (hasWpwTypePreexcitation && prMs !== undefined && qrsMs !== undefined) {
    const displayPr = displayValue(prMs);
    const displayQrs = displayValue(qrsMs);
    findings.push(
      makeFinding(
        'wpw-type-preexcitation-pattern',
        'finding',
        'attention',
        'Короткий PR, широкий QRS и подтверждённая дельта-волна совместимы с паттерном желудочкового предвозбуждения WPW-типа; требуется проверка врачом.',
        {
          metric: 'prMs',
          measurement: 'PR',
          value: displayPr,
          unit: 'мс',
          threshold: '<120 мс',
        },
        ECG_REFERENCE_IDS.conduction,
        [
          `PR ${displayPr} мс (<120 мс)`,
          `QRS ${displayQrs} мс (>120 мс)`,
          'Дельта-волна в начале QRS подтверждена',
        ],
      ),
    );
  }

  const qtc = preferredQtc(qtcCandidates(measurements));
  if (qtc) {
    const reviewThreshold = qtcReviewThreshold(input.sex);
    const crossesReviewThreshold = reviewThreshold.inclusive
      ? qtc.value >= reviewThreshold.value
      : qtc.value > reviewThreshold.value;
    const reviewThresholdText = `${reviewThreshold.inclusive ? '≥' : '>'}${reviewThreshold.value} мс`;
    const displayQtc = displayValue(qtc.value);
    const evidence: EcgFindingEvidence = {
      metric: qtc.metric,
      measurement: `QTc ${qtc.formula}`,
      value: displayQtc,
      unit: 'мс',
      threshold:
        qtc.value >= ECG_ADULT_SCREENING_LIMITS.qtcUrgentMs ? '≥500 мс' : reviewThresholdText,
      formula: qtc.formula,
    };
    if (isPositiveFinite(qrsMs) && qrsMs >= ECG_ADULT_SCREENING_LIMITS.qrsWideMs) {
      const urgent = qtc.value >= ECG_ADULT_SCREENING_LIMITS.qtcUrgentMs;
      findings.push(
        makeFinding(
          'qtc-wide-qrs-review',
          urgent ? 'urgent-review' : 'finding',
          urgent ? 'urgent' : 'attention',
          urgent
            ? 'QTc ≥500 мс при QRS ≥120 мс — стандартный порог требует коррекции QT/JT; нужна срочная врачебная оценка.'
            : 'QTc при QRS ≥120 мс нельзя оценивать обычным порогом без коррекции QT/JT.',
          {
            ...evidence,
            threshold: 'отдельная коррекция при QRS ≥120 мс',
          },
          ECG_REFERENCE_IDS.qt,
          [`QRS ${displayValue(qrsMs)} мс (≥120 мс)`],
        ),
      );
    } else if (qtc.value >= ECG_ADULT_SCREENING_LIMITS.qtcUrgentMs) {
      findings.push(
        makeFinding(
          'qtc-urgent',
          'urgent-review',
          'urgent',
          'QTc ≥500 мс — требуется срочная врачебная оценка; причина не определяется.',
          evidence,
          ECG_REFERENCE_IDS.qt,
        ),
      );
    } else if (crossesReviewThreshold) {
      findings.push(
        makeFinding(
          'qtc-prolonged',
          'finding',
          'attention',
          `QTc выше скринингового порога ${reviewThresholdText} — требуется врачебная оценка.`,
          evidence,
          ECG_REFERENCE_IDS.qt,
        ),
      );
    } else {
      findings.push(
        makeFinding(
          'qtc-within-screening-range',
          'normal',
          'normal',
          `QTc ${qtc.formula} не пересекает скрининговый порог ${reviewThresholdText}.`,
          {
            ...evidence,
            threshold: `${reviewThreshold.inclusive ? '<' : '≤'}${reviewThreshold.value} мс`,
          },
          ECG_REFERENCE_IDS.qt,
        ),
      );
    }
  }

  const missingData = makeMissingData(measurements);
  const status: EcgAdultMeasurementInterpretation['status'] = findings.some(
    (finding) => finding.status === 'urgent-review',
  )
    ? 'urgent-review'
    : findings.some((finding) => finding.status === 'finding')
      ? 'finding'
      : missingData.length > 0
        ? 'requires-review'
        : 'normal';
  return { status, findings, missingData };
}

export function interpretEcgPhoto(input: EcgInterpretationInput): EcgInterpretation {
  const eligibility = assessEcgPhotoEligibility(input);
  if (!eligibility.eligible) {
    return {
      eligible: false,
      status: 'not-eligible',
      eligibility,
      findings: [],
      missingData: [],
    };
  }
  return {
    eligible: true,
    eligibility,
    ...interpretAdultEcgMeasurements(input),
  };
}
