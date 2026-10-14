/**
 * The drug class a search query names as a whole («макролиды», «статинами», «ингибиторы АПФ»):
 * SRCH1, owner decision 2026-10-14. The words are the one class vocabulary of the app
 * (`drug-interactions/class-phrases.ts`: the НСИ «АТХ» group names and the declared aliases, narrowed
 * by the owner's ATC decisions), read in every inflection through the same word stems; the core only
 * asks (`createMedicalCore({ drugCodes })` → `classOf`).
 */
import type { DrugClassMatch } from '@localmed/core';

import {
  CLASS_ALIASES,
  CLASS_QUERY_ALIASES,
  type ClassPhrase,
  deriveClassPhrases,
} from '@/features/drug-interactions/class-phrases';
import { nameStems } from '@/features/drug-interactions/mention-matcher';
import { loadAtcNames } from '@/features/medications/atc-names';

/** Words around a class name that are not part of it: «группа статинов», «лекарства от класса …». */
const FILLER_STEMS = new Set(['препарат', 'средств', 'лекарств', 'групп', 'класс']);
const MAX_QUERY_LENGTH = 80;
/** The longest class name: «нестероидные противовоспалительные и противоревматические препараты». */
const MAX_CLASS_WORDS = 6;

export interface ClassVocabulary {
  readonly byStems: ReadonlyMap<string, readonly ClassPhrase[]>;
  readonly names: Readonly<Record<string, string>>;
}

/** The vocabulary of the search: the shared class words plus the names a doctor types for them. */
export function createClassVocabulary(names: Readonly<Record<string, string>>): ClassVocabulary {
  const { phrases } = deriveClassPhrases(names, [...CLASS_ALIASES, ...CLASS_QUERY_ALIASES]);
  const byStems = new Map<string, ClassPhrase[]>();
  for (const phrase of phrases) {
    const key = phrase.stems.join(' ');
    byStems.set(key, [...(byStems.get(key) ?? []), phrase]);
  }
  return { byStems, names };
}

function capitalized(text: string): string {
  // «НПВП», «иАПФ» keep their letters; a plain word gets its capital.
  return /\p{Lu}/u.test(text.slice(1))
    ? text
    : text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1);
}

/** The class a whole query names, or null. A phrase several branches claim keeps every branch. */
export function classOfQuery(vocabulary: ClassVocabulary, query: string): DrugClassMatch | null {
  if (query.length > MAX_QUERY_LENGTH) return null;
  const stems = nameStems(query).filter((stem) => !FILLER_STEMS.has(stem));
  if (stems.length === 0) return null;
  const found = vocabulary.byStems.get(stems.join(' '));
  if (!found || found.length === 0) return null;
  const codes = [...new Set(found.flatMap((phrase) => phrase.codes))];
  const first = found[0];
  const label = capitalized(first?.label ?? vocabulary.names[codes[0] ?? ''] ?? query.trim());
  return {
    label,
    groups: codes.map((code) => ({ code, name: vocabulary.names[code] ?? null })),
  };
}

let vocabulary: Promise<ClassVocabulary> | undefined;

/** The vocabulary of the shipped dictionary; the dictionary is its own chunk, fetched on the first class-shaped query. */
export function loadClassVocabulary(): Promise<ClassVocabulary> {
  vocabulary ??= loadAtcNames()
    .then((catalog) => createClassVocabulary(catalog.names))
    .catch((error: unknown) => {
      vocabulary = undefined;
      throw error;
    });
  return vocabulary;
}

/** What `createMedicalCore({ drugCodes })` asks: the class a query names. */
export async function classOfSearchQuery(query: string): Promise<DrugClassMatch | null> {
  // No class word has a digit or more than a few words: such a query never loads the dictionary.
  if (/\p{N}/u.test(query) || nameStems(query).length > MAX_CLASS_WORDS) return null;
  return classOfQuery(await loadClassVocabulary(), query);
}
