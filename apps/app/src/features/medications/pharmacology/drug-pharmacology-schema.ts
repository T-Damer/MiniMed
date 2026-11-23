/**
 * Schema-first drug pinned facts: pharmacokinetics (t½, Tmax, CYP) and receptor affinity profile.
 * UI renders these structures generically without branching on drug IDs (AGENTS.md «Schema first»).
 */

export type ReceptorAffinityTier = 'very-high' | 'high' | 'moderate' | 'low';

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

export interface DrugPharmacokineticsFact {
  readonly halfLife: string;
  readonly tmax?: string;
  readonly metabolism?: string;
  readonly steadyState?: string;
  readonly activeMetabolites?: string;
}

export interface DrugFactSourceRef {
  readonly title: string;
  readonly publisher: string;
  readonly year: number;
}

export interface DrugPharmacologyProfile {
  /** Normalized Russian INN keys matching this profile. */
  readonly inns: readonly string[];
  readonly classLabel: string;
  readonly pk: DrugPharmacokineticsFact;
  readonly receptors: readonly DrugReceptorBinding[];
  readonly sources: readonly DrugFactSourceRef[];
}

export const AFFINITY_TIER_LABELS: Readonly<Record<ReceptorAffinityTier, string>> = {
  'very-high': 'Очень высокое',
  high: 'Высокое',
  moderate: 'Умеренное',
  low: 'Слабое',
};

export function normalizeInnLookupKey(inn: string): string {
  return inn
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[®™©]/gu, '')
    .replace(/\s*\([^)]*\)\s*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
