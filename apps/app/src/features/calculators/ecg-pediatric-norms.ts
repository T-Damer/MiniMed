import type { EcgKnownPatientAge } from './ecg-patient-age';

/**
 * Declarative paediatric reference limits. Values are copied from Rijnbeek PR, Witsenburg M,
 * Schrama E, Hess J, Kors JA. New normal limits for the paediatric electrocardiogram. Eur Heart J
 * 2001;22:702–711 (doi:10.1053/euhj.2000.2399), Tables 3.2, 3.5 and 3.6 as printed in the author's
 * thesis (Erasmus University Rotterdam, 2007, chapter 3): 1 912 healthy Dutch children aged 11 days
 * to 16 years, 1200 Hz, MEANS measurements, separate limits for boys and girls. Limits are the 2nd
 * and 98th percentiles; amplitude tables give only the 98th. See docs/research/ecg-pediatric.md.
 */

export const ECG_PEDIATRIC_NORM_SOURCE =
  'Rijnbeek PR et al. New normal limits for the paediatric electrocardiogram. Eur Heart J 2001;22:702–711';

export const ECG_PEDIATRIC_NORM_GROUPS = [
  { id: 'd11-30', label: '11–30 дней' },
  { id: 'm1-3', label: '1–3 месяца' },
  { id: 'm3-6', label: '3–6 месяцев' },
  { id: 'm6-12', label: '6–12 месяцев' },
  { id: 'y1-3', label: '1–3 года' },
  { id: 'y3-5', label: '3–5 лет' },
  { id: 'y5-8', label: '5–8 лет' },
  { id: 'y8-12', label: '8–12 лет' },
  { id: 'y12-16', label: '12–16 лет' },
] as const;

export type EcgPediatricNormGroup = (typeof ECG_PEDIATRIC_NORM_GROUPS)[number]['id'];

/** Ages outside the Rijnbeek cohort: no reference is invented for them. */
export const ECG_PEDIATRIC_UNCOVERED = [
  {
    id: 'd0-10',
    label: '0–10 дней',
    text: 'Младше 11 дней детские нормы не применяются: в выборке Rijnbeek нет детей первых 10 дней жизни, а ЭКГ в это время меняется быстрее всего. Показаны только измерения.',
  },
  {
    id: 'y16-17',
    label: '16–17 лет',
    text: 'Для 16–17 лет проверенных норм нет (таблицы Rijnbeek заканчиваются на 16 годах): оцените по взрослым с осторожностью. Взрослые пороги автоматически не применяются.',
  },
] as const;

export type EcgPediatricUncoveredGroup = (typeof ECG_PEDIATRIC_UNCOVERED)[number]['id'];

type Limits = readonly [lower: number | null, upper: number];
type ByGroup = readonly [Limits, Limits, Limits, Limits, Limits, Limits, Limits, Limits, Limits];

export interface EcgPediatricNormParameter {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly table: string;
  /** 'magnitude' compares |value|, as the S-wave tables report depth without sign. */
  readonly compare: 'signed' | 'magnitude';
  readonly boys: ByGroup;
  readonly girls: ByGroup;
}

export const ECG_PEDIATRIC_NORMS: readonly EcgPediatricNormParameter[] = [
  {
    id: 'heartRate',
    label: 'ЧСС',
    unit: '/мин',
    table: '3.2',
    compare: 'signed',
    boys: [
      [129, 192],
      [126, 187],
      [112, 165],
      [106, 194],
      [97, 155],
      [73, 123],
      [62, 113],
      [55, 101],
      [48, 99],
    ],
    girls: [
      [136, 216],
      [126, 200],
      [122, 191],
      [106, 187],
      [95, 178],
      [78, 124],
      [68, 115],
      [58, 110],
      [54, 107],
    ],
  },
  {
    id: 'prMs',
    label: 'PR',
    unit: 'мс',
    table: '3.2',
    compare: 'signed',
    boys: [
      [77, 120],
      [85, 120],
      [87, 134],
      [82, 141],
      [86, 151],
      [98, 152],
      [99, 160],
      [105, 174],
      [107, 178],
    ],
    girls: [
      [91, 121],
      [78, 133],
      [84, 127],
      [88, 133],
      [78, 147],
      [99, 153],
      [92, 156],
      [103, 163],
      [106, 176],
    ],
  },
  {
    id: 'qrsMs',
    label: 'QRS',
    unit: 'мс',
    table: '3.2',
    compare: 'signed',
    boys: [
      [50, 85],
      [52, 77],
      [54, 85],
      [52, 86],
      [54, 88],
      [58, 92],
      [63, 98],
      [67, 103],
      [78, 111],
    ],
    girls: [
      [54, 79],
      [48, 77],
      [50, 78],
      [52, 80],
      [54, 85],
      [58, 88],
      [59, 95],
      [66, 99],
      [72, 106],
    ],
  },
  {
    id: 'qtcBazettMs',
    label: 'QTc Bazett',
    unit: 'мс',
    table: '3.2',
    compare: 'signed',
    boys: [
      [378, 448],
      [396, 458],
      [391, 453],
      [379, 449],
      [383, 455],
      [377, 448],
      [371, 443],
      [373, 440],
      [362, 449],
    ],
    girls: [
      [379, 462],
      [381, 454],
      [386, 448],
      [381, 446],
      [381, 447],
      [388, 442],
      [375, 449],
      [365, 447],
      [370, 457],
    ],
  },
  {
    id: 'qrsAxisDeg',
    label: 'Ось QRS',
    unit: '°',
    table: '3.2',
    compare: 'signed',
    boys: [
      [75, 140],
      [37, 138],
      [-6, 107],
      [14, 122],
      [-4, 118],
      [7, 112],
      [-10, 112],
      [-21, 114],
      [-9, 112],
    ],
    girls: [
      [63, 155],
      [39, 121],
      [17, 108],
      [1, 102],
      [2, 121],
      [3, 106],
      [27, 117],
      [5, 117],
      [5, 101],
    ],
  },
  {
    id: 'rV1Mv',
    label: 'R в V1',
    unit: 'мВ',
    table: '3.5',
    compare: 'signed',
    boys: [
      [null, 2.05],
      [null, 2.07],
      [null, 2.2],
      [null, 2.14],
      [null, 2.11],
      [null, 1.78],
      [null, 1.48],
      [null, 1.14],
      [null, 1.18],
    ],
    girls: [
      [null, 2.22],
      [null, 1.99],
      [null, 2.04],
      [null, 1.92],
      [null, 1.91],
      [null, 1.38],
      [null, 1.24],
      [null, 1.14],
      [null, 1.1],
    ],
  },
  {
    id: 'sV1Mv',
    label: 'S в V1',
    unit: 'мВ',
    table: '3.6',
    compare: 'magnitude',
    boys: [
      [null, 1.41],
      [null, 1.57],
      [null, 2.02],
      [null, 1.88],
      [null, 2.27],
      [null, 2.11],
      [null, 2.29],
      [null, 2.46],
      [null, 2.44],
    ],
    girls: [
      [null, 1.48],
      [null, 1.59],
      [null, 1.64],
      [null, 1.86],
      [null, 2.13],
      [null, 2.11],
      [null, 2.49],
      [null, 2.58],
      [null, 2.05],
    ],
  },
  {
    id: 'rV6Mv',
    label: 'R в V6',
    unit: 'мВ',
    table: '3.5',
    compare: 'signed',
    boys: [
      [null, 1.78],
      [null, 2.23],
      [null, 2.73],
      [null, 2.79],
      [null, 2.96],
      [null, 3.14],
      [null, 2.98],
      [null, 3.24],
      [null, 3.05],
    ],
    girls: [
      [null, 1.64],
      [null, 2.67],
      [null, 2.8],
      [null, 2.74],
      [null, 2.67],
      [null, 2.91],
      [null, 3.25],
      [null, 3.04],
      [null, 2.52],
    ],
  },
  {
    id: 'sV6Mv',
    label: 'S в V6',
    unit: 'мВ',
    table: '3.6',
    compare: 'magnitude',
    boys: [
      [null, 0.77],
      [null, 1.12],
      [null, 1.25],
      [null, 1.21],
      [null, 0.91],
      [null, 0.86],
      [null, 0.89],
      [null, 0.79],
      [null, 0.85],
    ],
    girls: [
      [null, 1.07],
      [null, 0.77],
      [null, 0.97],
      [null, 0.7],
      [null, 0.88],
      [null, 0.61],
      [null, 0.77],
      [null, 0.75],
      [null, 0.67],
    ],
  },
];

export type EcgPediatricNormId = (typeof ECG_PEDIATRIC_NORMS)[number]['id'];

export interface EcgPediatricFlag {
  readonly id: string;
  readonly label: string;
  readonly status: 'below' | 'above' | 'within';
  readonly text: string;
}

export type EcgPediatricEvaluation =
  | {
      readonly covered: true;
      readonly group: string;
      readonly flags: readonly EcgPediatricFlag[];
      readonly missing: readonly string[];
      readonly note: string;
      readonly source: string;
    }
  | { readonly covered: false; readonly text: string; readonly source: string };

/** Maps an exact calendar age onto a Rijnbeek group or the reason no reference applies. */
export function ecgPediatricNormGroup(
  age: EcgKnownPatientAge,
): EcgPediatricNormGroup | EcgPediatricUncoveredGroup | undefined {
  if (age.route !== 'pediatric') return undefined;
  if (age.ageDays < 11) return 'd0-10';
  const byAgeGroup: Partial<Record<EcgKnownPatientAge['group'], EcgPediatricNormGroup | 'y16-17'>> =
    {
      '7–30d': 'd11-30',
      '1–3mo': 'm1-3',
      '3–6mo': 'm3-6',
      '6–12mo': 'm6-12',
      '1–3y': 'y1-3',
      '3–5y': 'y3-5',
      '5–8y': 'y5-8',
      '8–12y': 'y8-12',
      '12–16y': 'y12-16',
      '16–17y': 'y16-17',
    };
  return byAgeGroup[age.group];
}

const format = (value: number, unit: string): string =>
  `${unit === 'мВ' ? value.toFixed(2).replace('.', ',') : Math.round(value)} ${unit}`;

/**
 * Compares confirmed measurements with the declared limits for the age group and sex. Flags are
 * reference prompts, never diagnoses; missing values are listed, not assumed normal.
 */
export function evaluateEcgPediatricNorms(input: {
  readonly group: EcgPediatricNormGroup | EcgPediatricUncoveredGroup;
  readonly sex?: 'male' | 'female';
  readonly values: Partial<Record<EcgPediatricNormId, number>>;
}): EcgPediatricEvaluation {
  const uncovered = ECG_PEDIATRIC_UNCOVERED.find((item) => item.id === input.group);
  if (uncovered)
    return {
      covered: false,
      text: uncovered.text,
      source: ECG_PEDIATRIC_NORM_SOURCE,
    };
  const index = ECG_PEDIATRIC_NORM_GROUPS.findIndex((group) => group.id === input.group);
  const groupLabel = ECG_PEDIATRIC_NORM_GROUPS[index]?.label ?? '';
  const flags: EcgPediatricFlag[] = [];
  const missing: string[] = [];
  for (const parameter of ECG_PEDIATRIC_NORMS) {
    const raw = input.values[parameter.id as EcgPediatricNormId];
    if (raw === undefined || !Number.isFinite(raw)) {
      missing.push(parameter.label);
      continue;
    }
    const value = parameter.compare === 'magnitude' ? Math.abs(raw) : raw;
    const boys = parameter.boys[index];
    const girls = parameter.girls[index];
    if (!boys || !girls) continue;
    // Unknown sex: the union of both ranges, so only values outside both sexes are flagged.
    const [lower, upper] =
      input.sex === 'male'
        ? boys
        : input.sex === 'female'
          ? girls
          : ([
              boys[0] === null || girls[0] === null ? null : Math.min(boys[0], girls[0]),
              Math.max(boys[1], girls[1]),
            ] as const);
    const status = lower !== null && value < lower ? 'below' : value > upper ? 'above' : 'within';
    const range =
      lower === null
        ? `98-й перцентиль ${format(upper, parameter.unit)}`
        : `2–98-й перцентили ${format(lower, parameter.unit)}–${format(upper, parameter.unit)}`;
    flags.push({
      id: parameter.id,
      label: parameter.label,
      status,
      text:
        status === 'within'
          ? `${parameter.label} ${format(value, parameter.unit)} — в пределах (${range}).`
          : `${parameter.label} ${format(value, parameter.unit)} — ${status === 'above' ? 'выше' : 'ниже'} ${status === 'above' ? '98-го' : '2-го'} перцентиля для возраста ${groupLabel} (${range}) — повод для проверки.`,
    });
  }
  return {
    covered: true,
    group: groupLabel,
    flags,
    missing,
    note: `Сравнение с нормами Rijnbeek 2001 для ${groupLabel}${
      input.sex === undefined
        ? ', пол не указан — использован объединённый диапазон мальчиков и девочек'
        : ''
    }. Флаги — повод для проверки, а не диагноз; отсутствие флагов не исключает патологию.`,
    source: ECG_PEDIATRIC_NORM_SOURCE,
  };
}
