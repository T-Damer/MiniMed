/**
 * Schema-first drug pinned facts: pharmacokinetics (t½, Tmax, CYP), receptor affinity profile,
 * and clinical effect intensities (sedation, activation, antidepressant/anxiolytic, EPS, metabolic).
 * UI renders these structures generically without branching on drug IDs (AGENTS.md «Schema first»).
 */

import type { AppGlyphName } from '@/components/AppGlyph';

export type ReceptorAffinityTier = 'very-high' | 'high' | 'moderate' | 'low';

export type ReceptorFamily =
  | 'dopamine'
  | 'serotonin'
  | 'histamine'
  | 'adrenergic'
  | 'cholinergic'
  | 'transport'
  | 'gaba'
  | 'other';

export interface DrugReceptorBinding {
  /** Standard IUPHAR symbol, e.g. «D2L», «5-HT2A», «H1», «M1», «α1». */
  readonly receptor: string;
  /** Pharmacological action at this target. */
  readonly action: string;
  /** Color-coded affinity tier (mapped via semantic theme tokens). */
  readonly affinity: ReceptorAffinityTier;
  /** Approximate published Ki (nM) from IUPHAR/PDSP when applicable. */
  readonly kiNm?: string;
  /** Primary CNS pathway or anatomical region involved. */
  readonly pathway: string;
  /** Concise clinical effect or adverse-effect link. */
  readonly clinicalEffect: string;
}

export type ClinicalEffectKind =
  | 'sedation'
  | 'activation'
  | 'antidepressant'
  | 'anxiolytic'
  | 'eps'
  | 'weight'
  | 'prolactin'
  | 'anticholinergic'
  | 'orthostasis'
  | 'qtc';

/** 0 = minimal/absent, 1 = mild (+), 2 = moderate (++), 3 = marked (+++). */
export type ClinicalEffectLevel = 0 | 1 | 2 | 3;

export type ClinicalEffectPolarity = 'therapeutic' | 'adverse' | 'neutral';

export interface DrugClinicalEffectMetric {
  readonly kind: ClinicalEffectKind;
  readonly level: ClinicalEffectLevel;
  readonly note: string;
}

export type BbbPenetrationLevel = 'high' | 'moderate' | 'low' | 'minimal';

export interface DrugBbbPenetration {
  /** Qualitative blood–brain barrier penetration tier. */
  readonly level: BbbPenetrationLevel;
  /** Concise clinical explanation of how the drug crosses the BBB (diffusion, transporters, P-gp). */
  readonly summary: string;
  /** True when P-glycoprotein (P-gp / ABCB1) efflux notably limits brain accumulation. */
  readonly pGpSubstrate?: boolean;
}

export const BBB_LEVEL_LABELS: Readonly<Record<BbbPenetrationLevel, string>> = {
  high: 'Высокое',
  moderate: 'Умеренное',
  low: 'Низкое (P-gp)',
  minimal: 'Минимальное',
};

export const BBB_SHORT_LABELS: Readonly<Record<BbbPenetrationLevel, string>> = {
  high: 'Высокий',
  moderate: 'Умеренный',
  low: 'Низкий',
  minimal: 'Миним.',
};

export interface DrugPharmacokineticsFact {
  readonly halfLife: string;
  readonly bbb?: DrugBbbPenetration;
  readonly tmax?: string;
  readonly metabolism?: string;
  readonly steadyState?: string;
  readonly activeMetabolites?: string;
  readonly typicalDose?: string;
}

export interface DrugFactSourceRef {
  readonly title: string;
  readonly publisher: string;
  readonly year: number;
}

export type RegimenPatientGroup = 'adult' | 'child' | 'elderly' | 'acute' | 'all';

export interface DrugRegimenStep {
  /** Short stage label, e.g. «Старт», «Титрация», «Поддержка», «Отмена». */
  readonly stage: string;
  /** Numeric dose text, e.g. «2,5–5 мг вечером» or «25 мг в/м 1–2 р/сут». */
  readonly dose: string;
  /** Optional timing or stage duration badge, e.g. «3–4 дня», «за 20–30 мин до сна». */
  readonly duration?: string;
  /** Concise 1-line clinical detail. */
  readonly note?: string;
}

export interface DrugRegimenBranch {
  readonly id: string;
  /** Clinical scenario / indication title. */
  readonly scenario: string;
  readonly group: RegimenPatientGroup;
  /** Patient badge, e.g. «Взрослые (18+)», «Дети с 7 лет», «Пожилые (60+)». */
  readonly patientBadge: string;
  /** Administration route badge, e.g. «Внутрь», «В/м». */
  readonly route: string;
  /** Ordered block-schema steps connected left-to-right / top-to-bottom. */
  readonly steps: readonly DrugRegimenStep[];
  /** Maximum daily dose badge, when specified in source. */
  readonly maxDaily?: string;
  /** Total course length badge, when specified in source. */
  readonly courseLength?: string;
  /** Provenance label, e.g. «Инструкция ГРЛС» or «КР Минздрава / ГРЛС». */
  readonly sourceLabel: string;
}

export const REGIMEN_PATIENT_GROUP_LABELS: Readonly<Record<RegimenPatientGroup, string>> = {
  all: 'Все',
  adult: 'Взрослые',
  child: 'Дети',
  elderly: 'Пожилые',
  acute: 'Острые / в/м',
};

export interface DrugPharmacologyProfile {
  /** Normalized Russian/Latin INN keys matching this profile. */
  readonly inns: readonly string[];
  /** Common Russian/international trade names that also map to this profile. */
  readonly aliases?: readonly string[];
  readonly classLabel: string;
  readonly pk: DrugPharmacokineticsFact;
  readonly receptors: readonly DrugReceptorBinding[];
  /** Schema-declared clinical effect intensities rendered in the second icon row & Effects tab. */
  readonly effects: readonly DrugClinicalEffectMetric[];
  /** Optional block-schema usage protocols per patient group / route (GRLS & КР). */
  readonly regimenSchemas?: readonly DrugRegimenBranch[];
  readonly sources: readonly DrugFactSourceRef[];
}

export const AFFINITY_TIER_LABELS: Readonly<Record<ReceptorAffinityTier, string>> = {
  'very-high': 'Очень высокое',
  high: 'Высокое',
  moderate: 'Умеренное',
  low: 'Слабое',
};

export interface ClinicalEffectMeta {
  readonly label: string;
  readonly shortLabel: string;
  readonly glyph: AppGlyphName;
  readonly polarity: ClinicalEffectPolarity;
}

export const CLINICAL_EFFECT_META: Readonly<Record<ClinicalEffectKind, ClinicalEffectMeta>> = {
  sedation: {
    label: 'Седация / сонливость',
    shortLabel: 'Седация',
    glyph: 'moon',
    polarity: 'neutral',
  },
  activation: {
    label: 'Активация / стимуляция',
    shortLabel: 'Актив.',
    glyph: 'lightning',
    polarity: 'neutral',
  },
  antidepressant: {
    label: 'Антидепрессивный эффект',
    shortLabel: 'Антидепр.',
    glyph: 'smiley',
    polarity: 'therapeutic',
  },
  anxiolytic: {
    label: 'Анксиолитический эффект',
    shortLabel: 'Тревога ↓',
    glyph: 'leaf',
    polarity: 'therapeutic',
  },
  eps: {
    label: 'Экстрапирамидные симптомы (ЭПС)',
    shortLabel: 'ЭПС',
    glyph: 'sneaker-move',
    polarity: 'adverse',
  },
  weight: {
    label: 'Прибавка массы тела / метаболизм',
    shortLabel: 'Масса',
    glyph: 'scales',
    polarity: 'adverse',
  },
  prolactin: {
    label: 'Гиперпролактинемия',
    shortLabel: 'Пролакт.',
    glyph: 'drop',
    polarity: 'adverse',
  },
  anticholinergic: {
    label: 'Антихолинергическая нагрузка',
    shortLabel: 'М-холин.',
    glyph: 'drop-half',
    polarity: 'adverse',
  },
  orthostasis: {
    label: 'Ортостатическая гипотензия',
    shortLabel: 'Ортостаз',
    glyph: 'arrows-down-up',
    polarity: 'adverse',
  },
  qtc: {
    label: 'Удлинение интервала QTc',
    shortLabel: 'QTc',
    glyph: 'heartbeat',
    polarity: 'adverse',
  },
};

export const CLINICAL_EFFECT_LEVEL_TEXT: Readonly<Record<ClinicalEffectLevel, string>> = {
  0: '—',
  1: '+',
  2: '++',
  3: '+++',
};

export const CLINICAL_EFFECT_LEVEL_DESCRIPTION: Readonly<Record<ClinicalEffectLevel, string>> = {
  0: 'Минимально / отсутствует',
  1: 'Слабый',
  2: 'Умеренный',
  3: 'Выраженный',
};

export function receptorFamilyOf(receptor: string): ReceptorFamily {
  const upper = receptor.toUpperCase();
  if (/^D[1-5]/u.test(upper)) return 'dopamine';
  if (/^5-?HT/u.test(upper)) return 'serotonin';
  if (/^H[1-4]/u.test(upper)) return 'histamine';
  if (/^[ΑAΑα][12]/iu.test(receptor) || upper.includes('АДРЕНО')) return 'adrenergic';
  if (/^M[1-5]/u.test(upper)) return 'cholinergic';
  if (upper.includes('SERT') || upper.includes('NET') || upper.includes('DAT')) return 'transport';
  if (upper.includes('GABA') || upper.includes('ГАМК')) return 'gaba';
  return 'other';
}

/** Extracts a representative numeric Ki (nM) from a string like «~0.2–0.5 нМ» or «>1000 нМ». */
export function parseNumericKi(kiNm: string | undefined): number | null {
  if (!kiNm) return null;
  const match = kiNm.match(/(\d+(?:[.,]\d+)?)/u);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Logarithmic radial petal scale (0.62..1.0) matching the reference receptor flower visualization:
 * sub-nanomolar Ki reaches 1.0; weaker affinities pull closer to the center disc.
 */
export function receptorPetalScale(binding: DrugReceptorBinding): number {
  const ki = parseNumericKi(binding.kiNm);
  if (ki !== null) {
    const ratio = Math.max(0, Math.min(1, Math.log10(100 / ki) / Math.log10(2000)));
    return 0.65 + 0.35 * ratio;
  }
  switch (binding.affinity) {
    case 'very-high':
      return 0.96;
    case 'high':
      return 0.86;
    case 'moderate':
      return 0.76;
    case 'low':
      return 0.66;
  }
}

export function normalizeInnLookupKey(inn: string): string {
  return inn
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[®™©]/gu, '')
    .replace(/\s*\([^)]*\)\s*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Returns the declared block-schema branches for a profile, falling back to a compact 1-branch
 * typical-dose card when detailed branches have not been authored yet.
 */
export function effectiveRegimenBranches(
  profile: DrugPharmacologyProfile,
): readonly DrugRegimenBranch[] {
  if (profile.regimenSchemas && profile.regimenSchemas.length > 0) {
    return profile.regimenSchemas;
  }
  return [
    {
      id: 'default-range',
      scenario: 'Ориентировочный диапазон доз',
      group: 'adult',
      patientBadge: 'Взрослые',
      route: 'По инструкции',
      steps: [
        {
          stage: 'Диапазон',
          dose: profile.pk.typicalDose ?? 'Индивидуальный подбор',
          ...(profile.pk.steadyState ? { duration: `Равновесие: ${profile.pk.steadyState}` } : {}),
          note: 'Сверяйте стартовую дозу и титрацию с разделом «Способ применения и дозы».',
        },
      ],
      sourceLabel: 'Справочный профиль',
    },
  ];
}

export interface SedationActivationSummary {
  readonly sedation: ClinicalEffectLevel;
  readonly activation: ClinicalEffectLevel;
  /** Signed balance from -3 (strongly sedating) to +3 (strongly activating). */
  readonly net: number;
  readonly label: string;
}

export function sedationActivationBalance(
  effects: readonly DrugClinicalEffectMetric[],
): SedationActivationSummary {
  const sedation = effects.find((item) => item.kind === 'sedation')?.level ?? 0;
  const activation = effects.find((item) => item.kind === 'activation')?.level ?? 0;
  const net = activation - sedation;
  let label = 'Сбалансированный профиль';
  if (sedation >= 2 && activation === 0) label = 'Выраженно седативный профиль';
  else if (sedation >= 1 && activation === 0) label = 'Умеренно седативный профиль';
  else if (activation >= 2 && sedation === 0) label = 'Активирующий профиль';
  else if (activation >= 1 && sedation === 0) label = 'Мягко активирующий профиль';
  else if (sedation > 0 && activation > 0) label = 'Дозозависимый (седация / активация)';
  return { sedation, activation, net, label };
}

export function splitEffectsByCategory(effects: readonly DrugClinicalEffectMetric[]): {
  readonly therapeutic: readonly DrugClinicalEffectMetric[];
  readonly adverse: readonly DrugClinicalEffectMetric[];
} {
  const therapeutic: DrugClinicalEffectMetric[] = [];
  const adverse: DrugClinicalEffectMetric[] = [];
  for (const metric of effects) {
    const polarity = CLINICAL_EFFECT_META[metric.kind].polarity;
    if (polarity === 'adverse') adverse.push(metric);
    else therapeutic.push(metric);
  }
  adverse.sort((left, right) => right.level - left.level);
  return { therapeutic, adverse };
}
