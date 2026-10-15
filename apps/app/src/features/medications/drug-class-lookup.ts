/**
 * The drug class a search query names as a whole («макролиды», «статинами», «ингибиторы АПФ»):
 * SRCH1, owner decision 2026-10-14. The words are the one class vocabulary of the app
 * (`drug-interactions/class-phrases.ts`: the НСИ «АТХ» group names and the declared aliases, narrowed
 * by the owner's ATC decisions), read in every inflection through the same word stems; the core only
 * asks (`createMedicalCore({ drugCodes })` → `classOf`).
 *
 * SRCH2: the class may also stand inside a longer query («макролиды детям», «статины при
 * беременности», «ингибиторы АПФ кашель»); see {@link classInQuery} for what counts.
 */
import type { DrugClassMatch } from '@localmed/core';

import {
  CLASS_ALIASES,
  CLASS_QUERY_ALIASES,
  type ClassPhrase,
  deriveClassPhrases,
} from '@/features/drug-interactions/class-phrases';
import { nameStems, tokenizeForMatching } from '@/features/drug-interactions/mention-matcher';
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

function matchOf(
  vocabulary: ClassVocabulary,
  found: readonly ClassPhrase[],
  fallbackLabel: string,
  rest?: readonly string[],
): DrugClassMatch {
  const codes = [...new Set(found.flatMap((phrase) => phrase.codes))];
  const first = found[0];
  const label = capitalized(first?.label ?? vocabulary.names[codes[0] ?? ''] ?? fallbackLabel);
  return {
    label,
    groups: codes.map((code) => ({ code, name: vocabulary.names[code] ?? null })),
    ...(rest && rest.length > 0 ? { rest } : {}),
  };
}

/** The plural endings of a noun or an adjective in any case: «макролиды», «статинов», «слабительные». */
const PLURAL_WORD = /(?:ы|и|ов|ев|ей|ам|ям|ами|ями|ах|ях|ые|ие|ых|их|ыми|ими)$/u;
/** An abbreviation typed in capitals («НПВС», «ИПП», «ГКС», the «АПФ» of «ингибиторы АПФ»). */
const CAPITAL_ABBREVIATION = /^\p{Lu}{3,}$/u;
/** The longest run of query words that is a class name. */
const MAX_PHRASE_WORDS = 5;
/**
 * A class word with more other words than this is a sentence («нужны ли антибактериальные препараты
 * при ротавирусном гастроэнтерите»), not a class lookup with a qualifier.
 */
const MAX_REST_WORDS = 3;

/**
 * SRCH2: a class name inside a longer query («макролиды детям»). The first class named counts, and at
 * its word the longest run, so «ингибиторы протонной помпы» is not «ингибиторы» and
 * «блокаторы кальциевых каналов при ХСН» keeps its three words. A run counts only if it reads as
 * the class and not as one drug of it or as an ordinary word: a plural word (or a capital
 * abbreviation) must be in it — «инсулин при беременности» and «витамин D» are drugs, «инсулины»
 * and «витамины» are classes. The words around it are returned in `rest`; the core drops the class
 * if they name a drug. Fillers («препараты», «группа») are not words of the query.
 */
export function classInQuery(vocabulary: ClassVocabulary, query: string): DrugClassMatch | null {
  const tokens = tokenizeForMatching(query).filter((token) => !FILLER_STEMS.has(token.stem));
  if (tokens.length < 2) return null;
  for (let start = 0; start < tokens.length; start += 1) {
    const longest = Math.min(MAX_PHRASE_WORDS, tokens.length - start, tokens.length - 1);
    for (let length = longest; length >= 1; length -= 1) {
      const run = tokens.slice(start, start + length);
      const found = vocabulary.byStems.get(run.map((token) => token.stem).join(' '));
      if (!found || found.length === 0) continue;
      const typed = (token: (typeof run)[number]) => query.slice(token.start, token.end);
      const readsAsClass = run.some(
        (token) => PLURAL_WORD.test(token.surface) || CAPITAL_ABBREVIATION.test(typed(token)),
      );
      if (!readsAsClass) continue;
      const rest = [...tokens.slice(0, start), ...tokens.slice(start + length)].map(
        (token) => token.surface,
      );
      if (rest.length > MAX_REST_WORDS) continue;
      return matchOf(vocabulary, found, query.trim(), rest);
    }
  }
  return null;
}

/**
 * The class a query names, or null: the whole query («макролиды»), otherwise a class word inside it
 * (SRCH2, {@link classInQuery}). A phrase several branches claim keeps every branch.
 */
export function classOfQuery(vocabulary: ClassVocabulary, query: string): DrugClassMatch | null {
  if (query.length > MAX_QUERY_LENGTH) return null;
  const stems = nameStems(query).filter((stem) => !FILLER_STEMS.has(stem));
  if (stems.length === 0) return null;
  const found = vocabulary.byStems.get(stems.join(' '));
  if (found && found.length > 0) return matchOf(vocabulary, found, query.trim());
  return classInQuery(vocabulary, query);
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
