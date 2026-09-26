import type { EcgLeadName } from './ecg-model-contract';

/**
 * Declarative ST/T ischaemia criteria for the ECG editor. The evaluator and the UI read only this
 * data; neither branches on criterion ids. Thresholds are in mV at the standard 10 mm/mV (1 mm =
 * 0.1 mV) and apply to adults only.
 *
 * Source: Thygesen K, Alpert JS, Jaffe AS, et al. Fourth Universal Definition of Myocardial
 * Infarction (2018). Eur Heart J 2019;40:237–269 (also Circulation 2018;138:e618–e651), table of
 * ECG manifestations of acute myocardial ischaemia in the absence of LVH and bundle branch block.
 * The same ST-elevation cut-points are used by Byrne RA, et al. 2023 ESC Guidelines for the
 * management of acute coronary syndromes. Eur Heart J 2023;44:3720–3826.
 */

export type EcgSex = 'male' | 'female';
export type EcgAdultAgeBand = 'under-40' | '40-plus';

export interface EcgContiguousGroup {
  readonly id: string;
  readonly label: string;
  readonly leads: readonly EcgLeadName[];
  /** 'any-pair': any two leads of the group; 'neighbours': only adjacent leads in listed order. */
  readonly adjacency: 'any-pair' | 'neighbours';
}

export interface EcgElevationCutPoint {
  readonly sex: EcgSex;
  readonly ageBand?: EcgAdultAgeBand;
  readonly thresholdMv: number;
  readonly label: string;
}

export interface EcgStCriteria {
  readonly sources: readonly { readonly label: string; readonly citation: string }[];
  readonly measurement: {
    readonly heading: string;
    readonly point: string;
    readonly reference: string;
    readonly rationale: string;
  };
  readonly contiguousGroups: readonly EcgContiguousGroup[];
  readonly elevation: {
    readonly defaultThresholdMv: number;
    readonly specialLeads: readonly EcgLeadName[];
    readonly specialCutPoints: readonly EcgElevationCutPoint[];
  };
  readonly depressionThresholdMv: number;
  readonly tInversion: { readonly thresholdMv: number; readonly minimumRToS: number };
  readonly reciprocal: readonly { readonly elevated: string; readonly depressed: string }[];
  readonly wideQrsMs: number;
  readonly texts: {
    readonly elevation: string;
    readonly elevationLowestCutPoint: string;
    readonly depression: string;
    readonly reciprocal: string;
    readonly tInversion: string;
    readonly wideQrs: string;
    readonly missing: string;
    readonly scope: string;
  };
}

export const ECG_ST_CRITERIA: EcgStCriteria = {
  sources: [
    {
      label: 'Fourth Universal Definition of MI (2018)',
      citation: 'Thygesen K, et al. Eur Heart J 2019;40:237–269',
    },
    {
      label: 'ESC ACS Guidelines (2023)',
      citation: 'Byrne RA, et al. Eur Heart J 2023;44:3720–3826',
    },
  ],
  measurement: {
    heading: 'ST в точке J (конец QRS) от изолинии PR/TP, мм',
    point: 'точка J (конец QRS)',
    reference: 'изолиния PR/TP того же отведения',
    rationale:
      'Пороги подъёма ST в Fourth UDMI 2018 и ESC 2023 заданы в точке J, поэтому ST измеряется в точке J, а не в J+60/J+80 мс.',
  },
  contiguousGroups: [
    { id: 'inferior', label: 'нижние', leads: ['II', 'III', 'aVF'], adjacency: 'any-pair' },
    { id: 'lateral', label: 'боковые', leads: ['I', 'aVL'], adjacency: 'any-pair' },
    {
      id: 'precordial',
      label: 'грудные',
      leads: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'],
      adjacency: 'neighbours',
    },
  ],
  elevation: {
    defaultThresholdMv: 0.1,
    specialLeads: ['V2', 'V3'],
    specialCutPoints: [
      { sex: 'male', ageBand: '40-plus', thresholdMv: 0.2, label: 'мужчины от 40 лет' },
      { sex: 'male', ageBand: 'under-40', thresholdMv: 0.25, label: 'мужчины моложе 40 лет' },
      { sex: 'female', thresholdMv: 0.15, label: 'женщины любого возраста' },
    ],
  },
  depressionThresholdMv: -0.05,
  tInversion: { thresholdMv: -0.1, minimumRToS: 1 },
  reciprocal: [
    { elevated: 'inferior', depressed: 'lateral' },
    { elevated: 'lateral', depressed: 'inferior' },
    { elevated: 'precordial', depressed: 'inferior' },
  ],
  wideQrsMs: 120,
  texts: {
    elevation:
      'Подъём ST в точке J в смежных отведениях {leads} достигает порогов Fourth UDMI 2018 / ESC 2023 — признак для срочной проверки врачом с учётом клиники и предыдущей ЭКГ.',
    elevationLowestCutPoint:
      'Для V2–V3 взят самый низкий порог (1,5 мм), потому что пол или возраст не указаны.',
    depression:
      'Депрессия ST ≥0,5 мм в точке J в смежных отведениях {leads} — признак для проверки. Оцените по снимку, горизонтальная или косонисходящая она: это условие критерия.',
    reciprocal:
      'Реципрокная депрессия ST в {depressed} при подъёме ST в {elevated} — отдельный признак для проверки.',
    tInversion:
      'Инверсия T глубже 1 мм в смежных отведениях {leads} с R/S > 1 — признак для проверки.',
    wideQrs:
      'Критерии ST не применяются автоматически: QRS {qrs} мс (≥120 мс). При блокаде ножки, стимуляции желудочков или WPW нужны отдельные критерии.',
    missing: 'ST не измерен в отведениях: {leads}. Нужны изолиния и точка J (конец QRS).',
    scope:
      'Критерии относятся к новым изменениям у взрослых при отсутствии гипертрофии ЛЖ и блокады ножек пучка Гиса; отсутствие находок не исключает ишемию.',
  },
};
