/**
 * Finds the drug a typed name stands for (RX1), with the app's own medication search (scope
 * «Препараты», lookup mode, so the keyboard-layout, transliteration and spelling fallbacks apply).
 * The search is not changed: this module only maps the groups it returns to cards of the dose-rule
 * index. A group whose names do not carry the typed words is refused when `strict` is set, so a
 * question about a disease or a symptom finds no drug.
 */
import type { MedicalCore, SearchResultGroup } from '@localmed/contracts';

import {
  cardDisplayName,
  cardSlugOfDocumentId,
} from '@/features/drug-interactions/drug-candidates';
import { namesCoverTypedWords } from '@/features/medication-safety/safety-candidates';
import { displayDrugName } from '@/features/medications/drug-screen';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';
import type { DoseIndex } from './dose-index';

export interface DoseCandidate {
  readonly slug: string;
  /** Index into the asset's `cards`. */
  readonly card: number;
  readonly label: string;
  /** The instruction of the very product the search found, when it is an indexed one. */
  readonly ownDocumentId: string | null;
}

const WORD = /[a-zа-яё]{2,}/gu;

function wordsOf(text: string): readonly string[] {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').match(WORD) ?? [];
}

function titleName(title: string): string {
  return displayDrugName(title.split(':')[0] ?? title);
}

function candidateOf(
  index: DoseIndex,
  group: Pick<SearchResultGroup, 'documentId' | 'title'>,
): { candidate: DoseCandidate; names: readonly string[] } | null {
  const slug = cardSlugOfDocumentId(group.documentId);
  if (slug !== null) {
    const card = index.cardBySlug.get(slug);
    if (card === undefined) return null;
    return {
      candidate: { slug, card, label: titleName(group.title), ownDocumentId: null },
      names: [group.title, cardDisplayName(slug)],
    };
  }
  const document = index.asset.documents[group.documentId];
  const first = document?.c[0];
  const cardSlug = first === undefined ? undefined : index.asset.cards[first]?.s;
  if (!document || first === undefined || cardSlug === undefined) return null;
  return {
    candidate: {
      slug: cardSlug,
      card: first,
      label: cardDisplayName(cardSlug),
      ownDocumentId: group.documentId,
    },
    names: [group.title, document.t ?? '', cardDisplayName(cardSlug)],
  };
}

const CHECKED_GROUPS = 6;

/** Candidates for a name, best first. */
export async function findDoseCandidates(
  core: MedicalCore,
  index: DoseIndex,
  query: string,
  options: { readonly limit?: number; readonly strict?: boolean } = {},
): Promise<readonly DoseCandidate[]> {
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
  const typed = wordsOf(text);
  const rewritten =
    result.value.queryRewrite !== undefined || result.value.queryCorrection !== undefined;
  const seen = new Set<string>();
  const found: DoseCandidate[] = [];
  const limit = options.limit ?? 8;
  for (const group of result.value.groups.slice(0, options.strict ? CHECKED_GROUPS : 24)) {
    const item = candidateOf(index, group);
    if (!item || seen.has(item.candidate.slug)) continue;
    if (options.strict && !rewritten && !namesCoverTypedWords(item.names, typed)) continue;
    seen.add(item.candidate.slug);
    found.push(item.candidate);
    if (found.length >= limit) break;
  }
  return found;
}
