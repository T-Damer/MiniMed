import type { DefinitionReferenceSense } from '@localmed/contracts';
import { type DoctorProfile, EMPTY_DOCTOR_PROFILE, profileInterest } from './doctor-profile';

/**
 * Orders the senses of one headword so that the likeliest one comes first. Only facts measured
 * by the edition build and the doctor's own profile are used — never the wording of a definition:
 *
 * - usage: how many recommendations use the sense (relative to the most used sense), trusted more
 *   the more evidence the best sense has;
 * - documents: how many independent documents give the sense;
 * - authority: КР «Термины и определения» above other official works above reference sites above
 *   general dictionaries;
 * - the doctor's profile: a push towards the fields the doctor reads.
 *
 * «Депрессия» is a fracture pattern in one traumatology recommendation and a mood disorder in
 * dozens: usage outweighs the glossary's authority, and a traumatologist's profile can still
 * bring the fracture sense up.
 */
export const SENSE_WEIGHTS = {
  usage: 0.5,
  documents: 0.15,
  authority: 0.25,
  profile: 0.35,
} as const;

/** The most-used sense must be used in at least this many recommendations to count fully. */
export const USAGE_FULL_CONFIDENCE = 8;
/** Authority tiers of the build (`definition_senses.authority`). */
export const MAX_AUTHORITY = 3;
/** Documents beyond this add nothing. */
const DOCUMENTS_CAP = 6;
const UNKNOWN_AUTHORITY = 1;

export interface SenseCandidate<T> {
  readonly item: T;
  readonly sense: DefinitionReferenceSense | undefined;
  /** Position in the core's own order: the final tie-break. */
  readonly order: number;
}

export interface RankedSense<T> extends SenseCandidate<T> {
  readonly score: number;
}

function documentsScore(documents: number | undefined): number {
  const count = Math.max(1, documents ?? 1);
  return Math.min(1, Math.log2(1 + count) / Math.log2(1 + DOCUMENTS_CAP));
}

export function senseScore(
  sense: DefinitionReferenceSense | undefined,
  maxUsage: number,
  profile: DoctorProfile = EMPTY_DOCTOR_PROFILE,
): number {
  const confidence = Math.min(1, maxUsage / USAGE_FULL_CONFIDENCE);
  const relativeUsage = maxUsage > 0 ? (sense?.usage ?? 0) / maxUsage : 0;
  const authority = (sense?.authority ?? UNKNOWN_AUTHORITY) / MAX_AUTHORITY;
  return (
    SENSE_WEIGHTS.usage * relativeUsage * confidence +
    SENSE_WEIGHTS.documents * documentsScore(sense?.documents) +
    SENSE_WEIGHTS.authority * authority +
    SENSE_WEIGHTS.profile * profileInterest(profile, sense?.field)
  );
}

/** Whether any candidate carries build signals; without them the core's order stands. */
export function hasSenseSignals<T>(candidates: readonly SenseCandidate<T>[]): boolean {
  return candidates.some((candidate) => candidate.sense !== undefined);
}

export function rankSenses<T>(
  candidates: readonly SenseCandidate<T>[],
  profile: DoctorProfile = EMPTY_DOCTOR_PROFILE,
): RankedSense<T>[] {
  if (!hasSenseSignals(candidates)) {
    return candidates.map((candidate) => ({ ...candidate, score: 0 }));
  }
  const maxUsage = Math.max(0, ...candidates.map((candidate) => candidate.sense?.usage ?? 0));
  return candidates
    .map((candidate) => ({ ...candidate, score: senseScore(candidate.sense, maxUsage, profile) }))
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        (right.sense?.authority ?? 0) - (left.sense?.authority ?? 0) ||
        (right.sense?.documents ?? 0) - (left.sense?.documents ?? 0) ||
        left.order - right.order,
    );
}

export interface SenseChip<T> {
  readonly label: string;
  readonly entry: RankedSense<T>;
}

/**
 * The other meanings as a short row of labelled chips: one chip per meaning that is not on screen
 * (the best-ranked wording of it), labelled by its medical field, or by `fallbackLabel` when the
 * source states none. Wordings of the meaning on screen are left out, so «психиатрия» is not
 * offered next to a psychiatric definition, and two chips never share a label.
 */
export function senseChips<T>(
  ranked: readonly RankedSense<T>[],
  isShown: (entry: RankedSense<T>) => boolean,
  fallbackLabel: (entry: RankedSense<T>) => string,
  limit = 5,
): SenseChip<T>[] {
  const labelOf = (entry: RankedSense<T>): string =>
    entry.sense?.fieldLabel ?? fallbackLabel(entry);
  const shown = ranked.find(isShown);
  const shownMeaning = shown?.sense?.meaning;
  const shownLabel = shown ? labelOf(shown) : undefined;
  const chips = new Map<string, SenseChip<T>>();
  const meanings = new Set<number>();
  for (const entry of ranked) {
    if (isShown(entry)) continue;
    const meaning = entry.sense?.meaning;
    if (meaning !== undefined && (meaning === shownMeaning || meanings.has(meaning))) continue;
    const label = labelOf(entry);
    if (label === shownLabel || chips.has(label)) continue;
    if (meaning !== undefined) meanings.add(meaning);
    chips.set(label, { label, entry });
    if (chips.size >= limit) break;
  }
  return [...chips.values()];
}
