import type {
  EcgDiagnosticEstimate,
  EcgNumericFeatureId,
} from '@/features/calculators/ecg-numeric-diagnostic';
import type { EcgMorphologyObservations } from '@/features/calculators/ecg-photo-interpreter';

export const ECG_NUMERIC_RULE_REFERENCE_IDS = {
  axis: 'aha-accf-hrs-2009-part-iii',
  conduction: 'acc-aha-hrs-2018-bradycardia',
  hypertrophy: 'aha-accf-hrs-2009-part-v',
} as const;

export interface EcgNumericRuleInput {
  readonly ageYears: number;
  readonly avlRPeakTimeMs?: number;
  readonly measurementsConfirmed: boolean;
  readonly morphology?: EcgMorphologyObservations;
  readonly qrsAxisDegrees?: number;
  readonly values: Partial<Record<EcgNumericFeatureId, number>>;
}

export interface EcgNumericRuleFinding {
  readonly evidence: readonly string[];
  readonly id:
    | 'qrs-axis-normal'
    | 'qrs-axis-left'
    | 'qrs-axis-right'
    | 'qrs-axis-extreme'
    | 'lafb-compatible-pattern'
    | 'sokolow-lyon-matched'
    | 'sokolow-lyon-not-matched';
  readonly label: string;
  readonly sourceId: (typeof ECG_NUMERIC_RULE_REFERENCE_IDS)[keyof typeof ECG_NUMERIC_RULE_REFERENCE_IDS];
  readonly status: 'normal' | 'finding';
  readonly text: string;
}

export interface EcgEstimateRuleCrossCheck {
  readonly id:
    | 'norm-with-measured-findings'
    | 'cd-wide-qrs-supported'
    | 'cd-wide-qrs-not-supported'
    | 'hyp-sokolow-supported'
    | 'hyp-sokolow-not-supported';
  readonly status: 'supports' | 'limits';
  readonly text: string;
}

export interface EcgEstimateRuleCrossCheckInput {
  readonly estimates: readonly Pick<EcgDiagnosticEstimate, 'id' | 'status'>[];
  readonly hasDeterministicFinding: boolean;
  readonly qrsWide: boolean;
  readonly sokolowLyon: 'matched' | 'not-matched';
}

function rounded(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function requireAdultAge(ageYears: number): void {
  if (!Number.isFinite(ageYears) || ageYears < 18 || ageYears > 120) {
    throw new Error('Числовые критерии ЭКГ доступны только для взрослых 18–120 лет.');
  }
}

function axisFinding(axis: number): EcgNumericRuleFinding {
  if (!Number.isFinite(axis) || axis < -180 || axis > 180) {
    throw new Error('Ось QRS должна быть в диапазоне от −180° до +180°.');
  }
  const normalizedAxis = axis === 180 ? -180 : axis;
  const evidence = [`Ось QRS ${rounded(axis)}°`];
  if (normalizedAxis < -90) {
    return {
      id: 'qrs-axis-extreme',
      label: 'Крайнее отклонение оси QRS',
      status: 'finding',
      text: 'Ось QRS левее −90°; причина по одному значению не определяется.',
      evidence,
      sourceId: ECG_NUMERIC_RULE_REFERENCE_IDS.axis,
    };
  }
  if (normalizedAxis < -30) {
    return {
      id: 'qrs-axis-left',
      label: 'Отклонение оси QRS влево',
      status: 'finding',
      text: 'Ось QRS находится левее взрослого референсного диапазона.',
      evidence,
      sourceId: ECG_NUMERIC_RULE_REFERENCE_IDS.axis,
    };
  }
  if (normalizedAxis > 90) {
    return {
      id: 'qrs-axis-right',
      label: 'Отклонение оси QRS вправо',
      status: 'finding',
      text: 'Ось QRS находится правее взрослого референсного диапазона.',
      evidence,
      sourceId: ECG_NUMERIC_RULE_REFERENCE_IDS.axis,
    };
  }
  return {
    id: 'qrs-axis-normal',
    label: 'Ось QRS в референсном диапазоне',
    status: 'normal',
    text: 'Ось QRS находится в диапазоне −30…+90° для взрослых.',
    evidence,
    sourceId: ECG_NUMERIC_RULE_REFERENCE_IDS.axis,
  };
}

function sokolowLyonFinding(
  values: EcgNumericRuleInput['values'],
): EcgNumericRuleFinding | undefined {
  const sV1 = values.S_Amp_V1;
  const rV5 = values.R_Amp_V5;
  const rV6 = values.R_Amp_V6;
  if (![sV1, rV5, rV6].every((value) => value !== undefined && Number.isFinite(value))) {
    return undefined;
  }

  const maxR = Math.max(0, rV5 as number, rV6 as number);
  const voltage = Math.abs(sV1 as number) + maxR;
  const evidence = [
    `|S V1| ${rounded(Math.abs(sV1 as number))} мВ`,
    `max(R V5, R V6) ${rounded(maxR)} мВ`,
    `сумма ${rounded(voltage)} мВ`,
  ];
  if (voltage > 3.5) {
    return {
      id: 'sokolow-lyon-matched',
      label: 'Вольтажный критерий Sokolow–Lyon совпал',
      status: 'finding',
      text: 'Сумма превышает 3,5 мВ и совместима с вольтажным паттерном гипертрофии левого желудочка; требуется проверка по полной ЭКГ и клиническим данным.',
      evidence,
      sourceId: ECG_NUMERIC_RULE_REFERENCE_IDS.hypertrophy,
    };
  }
  return {
    id: 'sokolow-lyon-not-matched',
    label: 'Вольтажный критерий Sokolow–Lyon не совпал',
    status: 'normal',
    text: 'Сумма не превышает 3,5 мВ; это не исключает гипертрофию левого желудочка.',
    evidence,
    sourceId: ECG_NUMERIC_RULE_REFERENCE_IDS.hypertrophy,
  };
}

function lafbFinding(input: EcgNumericRuleInput): EcgNumericRuleFinding | undefined {
  const qrsMs = input.values.QRS_Dur_Global;
  const axis = input.qrsAxisDegrees;
  const rPeakMs = input.avlRPeakTimeMs;
  const morphology = input.morphology;
  if (
    qrsMs === undefined ||
    !Number.isFinite(qrsMs) ||
    qrsMs >= 120 ||
    axis === undefined ||
    !Number.isFinite(axis) ||
    axis < -90 ||
    axis > -45 ||
    rPeakMs === undefined ||
    !Number.isFinite(rPeakMs) ||
    rPeakMs < 45 ||
    morphology?.avlQrPattern !== 'present' ||
    morphology.inferiorRsPattern !== 'present' ||
    morphology.dominantQrsSupraventricular !== 'present' ||
    morphology.pacedQrs !== 'absent' ||
    morphology.deltaWave !== 'absent'
  ) {
    return undefined;
  }

  return {
    id: 'lafb-compatible-pattern',
    label: 'Паттерн, совместимый с БПВЛНПГ',
    status: 'finding',
    text: 'Подтверждённые измерения и морфология совместимы с блокадой передней ветви левой ножки пучка Гиса. Это не самостоятельный диагноз; отсутствие паттерна не исключает БПВЛНПГ.',
    evidence: [
      `QRS ${rounded(qrsMs)} мс (<120 мс)`,
      `ось QRS ${rounded(axis)}° (−90…−45°)`,
      'qR в aVL',
      `время до пика R в aVL ${rounded(rPeakMs)} мс (≥45 мс)`,
      'rS во II, III и aVF',
      'наджелудочковое происхождение QRS; нет стимуляции и дельта-волны',
    ],
    sourceId: ECG_NUMERIC_RULE_REFERENCE_IDS.conduction,
  };
}

export function interpretEcgNumericRules(
  input: EcgNumericRuleInput,
): readonly EcgNumericRuleFinding[] {
  if (!input.measurementsConfirmed) return [];
  requireAdultAge(input.ageYears);
  const findings: EcgNumericRuleFinding[] = [];
  if (input.qrsAxisDegrees !== undefined) findings.push(axisFinding(input.qrsAxisDegrees));
  const lafb = lafbFinding(input);
  if (lafb) findings.push(lafb);
  const voltageFinding = sokolowLyonFinding(input.values);
  if (voltageFinding) findings.push(voltageFinding);
  return findings;
}

export function crossCheckEcgEstimatesWithRules(
  input: EcgEstimateRuleCrossCheckInput,
): readonly EcgEstimateRuleCrossCheck[] {
  const positive = new Set(
    input.estimates
      .filter((estimate) => estimate.status === 'positive')
      .map((estimate) => estimate.id),
  );
  const checks: EcgEstimateRuleCrossCheck[] = [];

  if (positive.has('NORM') && input.hasDeterministicFinding) {
    checks.push({
      id: 'norm-with-measured-findings',
      status: 'limits',
      text: 'Гипотеза NORM не отменяет найденные измеримые отклонения: буквальные критерии нужно оценить отдельно.',
    });
  }
  if (positive.has('CD')) {
    checks.push(
      input.qrsWide
        ? {
            id: 'cd-wide-qrs-supported',
            status: 'supports',
            text: 'Широкий QRS независимо поддерживает один измеримый признак группы CD; конкретный тип нарушения проводимости требует морфологии.',
          }
        : {
            id: 'cd-wide-qrs-not-supported',
            status: 'limits',
            text: 'CD выше порога, но QRS <120 мс. Класс CD шире широкого QRS; текущие правила не подтверждают конкретный тип нарушения проводимости.',
          },
    );
  }
  if (positive.has('HYP')) {
    checks.push(
      input.sokolowLyon === 'matched'
        ? {
            id: 'hyp-sokolow-supported',
            status: 'supports',
            text: 'Критерий Sokolow–Lyon независимо поддерживает вольтажный паттерн ГЛЖ, но не устанавливает гипертрофию сам по себе.',
          }
        : {
            id: 'hyp-sokolow-not-supported',
            status: 'limits',
            text: 'Критерий Sokolow–Lyon не совпал. Это не исключает другие паттерны гипертрофии, но правило не подтверждает гипотезу HYP.',
          },
    );
  }

  return checks;
}
