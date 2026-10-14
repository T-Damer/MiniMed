/**
 * Finds the МНН cards a typed drug name stands for (INT1), with the ordinary drug search. The
 * search is the app's own medication search (`ScopedMedicalCore`, scope «Препараты»); this module
 * only maps the groups it returns to cards of the interaction index.
 */
import type { MedicalCore, SearchAtcMatch, SearchResultGroup } from '@localmed/contracts';
import { parseAtcQuery } from '@localmed/search-lexical';
import { cardSlugOfDocumentId } from '@/features/drug-picker/card-id';
import { drugDirectoryGroups, withDirectoryGroups } from '@/features/drug-picker/drug-search';
import { atcMatchOf, singleByCode } from '@/features/medications/atc-groups';
import { displayDrugName } from '@/features/medications/drug-screen';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';
import type { InteractionIndex } from './interaction-index';

export { cardSlugOfDocumentId };

export interface DrugCandidate {
  readonly slug: string;
  /** Index into the asset's `cards`. */
  readonly card: number;
  readonly label: string;
  /** The ATC code the drug was found under, when it was searched by a code (ATC5). */
  readonly atc?: SearchAtcMatch;
}

/** The name of a card as the doctor reads it, from its id when no title is at hand. */
export function cardDisplayName(slug: string): string {
  return displayDrugName(slug.replace(/-+/gu, ' ').trim().toLocaleUpperCase('ru-RU'));
}

function labelOfTitle(title: string): string {
  return displayDrugName(title.split(':')[0] ?? title);
}

function cardOfGroup(
  index: InteractionIndex,
  group: Pick<SearchResultGroup, 'documentId' | 'title' | 'atcMatch'>,
): DrugCandidate | null {
  const direct = cardSlugOfDocumentId(group.documentId);
  if (direct !== null) {
    const card = index.cardBySlug.get(direct);
    return card === undefined
      ? null
      : { slug: direct, card, label: labelOfTitle(group.title), ...atcMatchOf(group) };
  }
  // An indexed instruction: its first card (a trade-name hit finds its substance).
  const document = index.asset.documents[group.documentId];
  const first = document?.c[0];
  const slug = first === undefined ? undefined : index.asset.cards[first]?.[0];
  return first === undefined || slug === undefined
    ? null
    : { slug, card: first, label: cardDisplayName(slug), ...atcMatchOf(group) };
}

/** Candidates for a name, best first. */
export async function findDrugCandidates(
  core: MedicalCore,
  index: InteractionIndex,
  query: string,
  limit = 8,
): Promise<readonly DrugCandidate[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const [result, directory] = await Promise.all([
    new ScopedMedicalCore(core, 'medications').search({
      query: text,
      mode: 'lexical',
      analysisMode: 'lookup',
      filters: {},
      limit: 24,
      includeSuggestions: false,
    }),
    drugDirectoryGroups(text),
  ]);
  const seen = new Set<string>();
  const candidates: DrugCandidate[] = [];
  // The search's groups, then the cards the shared name rule adds (any component, any word).
  for (const group of withDirectoryGroups(result.ok ? result.value.groups : [], directory)) {
    const candidate = cardOfGroup(index, group);
    if (!candidate || seen.has(candidate.slug)) continue;
    seen.add(candidate.slug);
    candidates.push(candidate);
    if (candidates.length >= limit) break;
  }
  return candidates;
}

/**
 * The card a typed name stands for. A name that finds nothing is tried word by word («варфарин
 * ибупрофен» typed without a separator), which then gives several cards.
 */
export async function resolveTypedName(
  core: MedicalCore,
  index: InteractionIndex,
  name: string,
): Promise<readonly DrugCandidate[]> {
  // An ATC code names its drug through the code search; a prefix only when it holds one drug.
  if (parseAtcQuery(name)) {
    const byCode = (await findDrugCandidates(core, index, name, 24)).filter(
      (candidate) => candidate.atc !== undefined,
    );
    const only = singleByCode(name, byCode);
    return only ? [only] : [];
  }
  const direct = await findDrugCandidates(core, index, name, 1);
  if (direct.length > 0) return direct;
  const words = name.split(/\s+/u).filter((word) => word.length >= 3);
  if (words.length < 2) return [];
  const resolved: DrugCandidate[] = [];
  for (const word of words) {
    const [candidate] = await findDrugCandidates(core, index, word, 1);
    if (candidate && !resolved.some((entry) => entry.slug === candidate.slug))
      resolved.push(candidate);
  }
  return resolved;
}
