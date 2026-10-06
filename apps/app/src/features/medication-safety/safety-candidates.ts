/**
 * Finds the drug a typed name stands for (SAFE1), with the app's own medication search (scope
 * «Препараты», lookup mode, so the keyboard-layout and transliteration fallback of S3 applies). The
 * search is not changed: this module only maps the groups it returns to cards of the safety index
 * and refuses a group that does not carry the typed name, so a question about a disease or a symptom
 * («давление при беременности») finds no card.
 */
import type { MedicalCore, SearchResultGroup } from '@localmed/contracts';

import {
  cardDisplayName,
  cardSlugOfDocumentId,
} from '@/features/drug-interactions/drug-candidates';
import { displayDrugName } from '@/features/medications/drug-screen';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';
import type { SafetyIndex } from './safety-index';
import type { SafetyCandidate } from './safety-view';

const CHECKED_GROUPS = 6;
const MIN_COVERED_PREFIX = 5;
const WORD = /[a-zа-яё]{2,}/gu;

function wordsOf(text: string): readonly string[] {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').match(WORD) ?? [];
}

/** Every typed word begins a word of the names, or is the name with an inflection ending. */
export function namesCoverTypedWords(names: readonly string[], typed: readonly string[]): boolean {
  const nameWords = names.flatMap((name) => wordsOf(name));
  return (
    typed.length > 0 &&
    typed.every((word) =>
      nameWords.some(
        (name) =>
          name.startsWith(word) ||
          (name.length >= MIN_COVERED_PREFIX &&
            word.startsWith(name) &&
            word.length - name.length <= 3),
      ),
    )
  );
}

function titleName(title: string): string {
  return displayDrugName(title.split(':')[0] ?? title);
}

function candidateOfGroup(
  index: SafetyIndex,
  group: Pick<SearchResultGroup, 'documentId' | 'title'>,
): { candidate: SafetyCandidate; names: readonly string[] } | null {
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
  const cardSlug = first === undefined ? undefined : index.asset.cards[first];
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

/**
 * The drug for a typed name, or null. A group counts when the typed words begin words of its
 * names, or when the search itself rewrote the query to a name of the corpus (the layout and
 * transliteration fallback validates that on its own).
 */
export async function resolveSafetyCandidate(
  core: MedicalCore,
  index: SafetyIndex,
  name: string,
): Promise<SafetyCandidate | null> {
  const text = name.trim();
  if (text.length < 3) return null;
  const result = await new ScopedMedicalCore(core, 'medications').search({
    query: text,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 24,
    includeSuggestions: false,
  });
  if (!result.ok) return null;
  const typed = wordsOf(text);
  const rewritten = result.value.queryRewrite !== undefined;
  for (const group of result.value.groups.slice(0, CHECKED_GROUPS)) {
    const found = candidateOfGroup(index, group);
    if (!found) continue;
    if (rewritten || namesCoverTypedWords(found.names, typed)) return found.candidate;
  }
  return null;
}
