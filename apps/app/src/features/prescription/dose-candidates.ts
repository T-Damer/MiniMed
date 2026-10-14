/**
 * Finds the drug a typed name stands for (RX1), with the app's own medication search (scope
 * «Препараты», lookup mode, so the keyboard-layout, transliteration and spelling fallbacks apply).
 * The search is not changed: this module only maps the groups it returns to cards of the dose-rule
 * index. A group whose names do not carry the typed words is refused when `strict` is set, so a
 * question about a disease or a symptom finds no drug.
 */
import type { MedicalCore, SearchAtcMatch, SearchResultGroup } from '@localmed/contracts';
import { parseAtcQuery } from '@localmed/search-lexical';

import {
  cardDisplayName,
  cardSlugOfDocumentId,
} from '@/features/drug-interactions/drug-candidates';
import {
  checkedWithDirectory,
  drugDirectoryGroups,
  withDirectoryGroups,
} from '@/features/drug-picker/drug-search';
import { namesCoverTypedWords } from '@/features/medication-safety/safety-candidates';
import { atcMatchOf, singleByCode } from '@/features/medications/atc-groups';
import { drugLabelOfTitle } from '@/features/medications/drug-label';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';
import type { DoseIndex } from './dose-index';

export interface DoseCandidate {
  readonly slug: string;
  /** Index into the asset's `cards`. */
  readonly card: number;
  readonly label: string;
  /** The instruction of the very product the search found, when it is an indexed one. */
  readonly ownDocumentId: string | null;
  /** The ATC code the drug was found under, when it was searched by a code (ATC5). */
  readonly atc?: SearchAtcMatch;
}

const WORD = /[a-zа-яё]{2,}/gu;

function wordsOf(text: string): readonly string[] {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').match(WORD) ?? [];
}

function titleName(title: string): string {
  return drugLabelOfTitle(title);
}

function candidateOf(
  index: DoseIndex,
  group: Pick<SearchResultGroup, 'documentId' | 'title' | 'atcMatch'>,
): { candidate: DoseCandidate; names: readonly string[] } | null {
  const slug = cardSlugOfDocumentId(group.documentId);
  if (slug !== null) {
    const card = index.cardBySlug.get(slug);
    if (card === undefined) return null;
    return {
      candidate: {
        slug,
        card,
        label: titleName(group.title),
        ownDocumentId: null,
        ...atcMatchOf(group),
      },
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
      ...atcMatchOf(group),
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
  if (!result.ok) return [];
  const typed = wordsOf(text);
  const rewritten =
    result.value.queryRewrite !== undefined || result.value.queryCorrection !== undefined;
  const seen = new Set<string>();
  const found: DoseCandidate[] = [];
  const limit = options.limit ?? 8;
  // A typed ATC code (ATC5): the drugs the code search found; a strict question names one drug.
  const byCode = parseAtcQuery(text) !== null;
  if (byCode && options.strict) {
    const only = singleByCode(
      text,
      result.value.groups.flatMap((group) => {
        const item = group.atcMatch ? candidateOf(index, group) : null;
        return item ? [item.candidate] : [];
      }),
    );
    return only ? [only] : [];
  }
  // The search's groups, then the cards the shared name rule adds (SRCH1).
  const groups = options.strict
    ? checkedWithDirectory(result.value.groups, directory, CHECKED_GROUPS)
    : withDirectoryGroups(result.value.groups.slice(0, 24), directory);
  for (const group of groups) {
    const item = candidateOf(index, group);
    if (!item || seen.has(item.candidate.slug)) continue;
    if (options.strict && !rewritten && !namesCoverTypedWords(item.names, typed)) continue;
    seen.add(item.candidate.slug);
    found.push(item.candidate);
    if (found.length >= limit) break;
  }
  return found;
}
