/**
 * Finds the МНН cards a typed drug name stands for (INT1), with the ordinary drug search. The
 * search is the app's own medication search (`ScopedMedicalCore`, scope «Препараты»); this module
 * only maps the groups it returns to cards of the interaction index.
 */
import type { MedicalCore, SearchResultGroup } from '@localmed/contracts';

import { displayDrugName } from '@/features/medications/drug-screen';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';
import type { InteractionIndex } from './interaction-index';

export interface DrugCandidate {
  readonly slug: string;
  /** Index into the asset's `cards`. */
  readonly card: number;
  readonly label: string;
}

const CARD_PREFIX = 'esklp.mnn.';
const POINTER = /^core\.catalog\.pointer\.medication\.esklp\.mnn\.(.+)-[0-9a-f]{16}$/u;

/** `esklp.mnn.<slug>` or its core pointer → `<slug>`; null for any other document. */
export function cardSlugOfDocumentId(documentId: string): string | null {
  if (documentId.startsWith(CARD_PREFIX)) return documentId.slice(CARD_PREFIX.length);
  return POINTER.exec(documentId)?.[1] ?? null;
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
  group: Pick<SearchResultGroup, 'documentId' | 'title'>,
): DrugCandidate | null {
  const direct = cardSlugOfDocumentId(group.documentId);
  if (direct !== null) {
    const card = index.cardBySlug.get(direct);
    return card === undefined ? null : { slug: direct, card, label: labelOfTitle(group.title) };
  }
  // An indexed instruction: its first card (a trade-name hit finds its substance).
  const document = index.asset.documents[group.documentId];
  const first = document?.c[0];
  const slug = first === undefined ? undefined : index.asset.cards[first]?.[0];
  return first === undefined || slug === undefined
    ? null
    : { slug, card: first, label: cardDisplayName(slug) };
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
  const result = await new ScopedMedicalCore(core, 'medications').search({
    query: text,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 24,
    includeSuggestions: false,
  });
  if (!result.ok) return [];
  const seen = new Set<string>();
  const candidates: DrugCandidate[] = [];
  for (const group of result.value.groups) {
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
