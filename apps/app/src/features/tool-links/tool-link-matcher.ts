export interface ToolLinkDefinition<Kind extends string> {
  readonly id: string;
  readonly kind: Kind;
  readonly slug: string;
  readonly phrases: readonly string[];
}

export type ToolLinkSegment<Kind extends string> =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: Kind;
      readonly id: string;
      readonly slug: string;
      readonly value: string;
    };

export interface ToolLinkMatcher<Kind extends string> {
  readonly ambiguousPhrases: readonly string[];
  segment(text: string): readonly ToolLinkSegment<Kind>[];
}

interface IndexedPhrase<Kind extends string> {
  readonly definition: ToolLinkDefinition<Kind>;
  readonly normalized: string;
  readonly pattern: string;
}

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

/** The class the phrase expressions use for the characters of a word. */
const WORD_CHARACTER = /^[\p{L}\p{M}\p{N}_]$/u;
const FIRST_WORD = /^[^\p{L}\p{M}\p{N}_]*([\p{L}\p{M}\p{N}_]+)/u;

function foldWord(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е');
}

const nonLatinWordCache = new Map<number, boolean>();

/** Whether a code point belongs to a word: ASCII and Cyrillic by range, anything else by property. */
function isWordCodePoint(code: number): boolean {
  if (code < 0x80) {
    return (
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x5f
    );
  }
  if ((code >= 0x410 && code <= 0x44f) || code === 0x401 || code === 0x451) return true;
  let known = nonLatinWordCache.get(code);
  if (known === undefined) {
    known = WORD_CHARACTER.test(String.fromCodePoint(code));
    nonLatinWordCache.set(code, known);
  }
  return known;
}

/** A lower-cased code unit with ё read as е: what a word is hashed by (see `scanWords`). */
function foldedCode(code: number): number {
  if (code < 0x80) return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
  if (code >= 0x410 && code <= 0x42f) return code + 0x20;
  if (code === 0x401 || code === 0x451) return 0x435;
  const lower = String.fromCodePoint(code).toLowerCase();
  return lower.length === 1 ? lower.charCodeAt(0) : code;
}

function hashFoldedWord(word: string): number {
  let hash = 0;
  for (let index = 0; index < word.length; ) {
    const code = word.codePointAt(index) ?? 0;
    hash = (Math.imul(hash, 31) + foldedCode(code > 0xffff ? 0xfffd : code)) | 0;
    index += code > 0xffff ? 2 : 1;
  }
  return hash;
}

/** `\s` of a regular expression, by code unit. */
function isSpaceCode(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/**
 * Where a normalized phrase (lower case, ё as е, single spaces) ends in `text` when it starts at
 * `start`, or −1: letters match whatever their case or ё/е, a space matches any run of white space,
 * and the phrase must end at a word boundary.
 */
function phraseEndAt(text: string, start: number, phrase: string): number {
  const length = text.length;
  let at = start;
  for (let index = 0; index < phrase.length; index += 1) {
    const expected = phrase.charCodeAt(index);
    if (expected === 0x20) {
      if (at >= length || !isSpaceCode(text.charCodeAt(at))) return -1;
      while (at < length && isSpaceCode(text.charCodeAt(at))) at += 1;
    } else {
      if (at >= length || foldedCode(text.charCodeAt(at)) !== foldedCode(expected)) return -1;
      at += 1;
    }
  }
  if (at < length && isWordCodePoint(text.codePointAt(at) ?? 0)) return -1;
  return at;
}

/**
 * Calls `onWord(start, end, hash)` for every maximal run of word characters, left to right, without
 * building a string per word: the hash is of the lower-cased letters (ё as е), so a caller looks a
 * word up by hash first and only builds the string for the rare hit.
 */
function scanWords(text: string, onWord: (start: number, end: number, hash: number) => void): void {
  const length = text.length;
  let index = 0;
  while (index < length) {
    const first = text.codePointAt(index) ?? 0;
    if (!isWordCodePoint(first)) {
      index += first > 0xffff ? 2 : 1;
      continue;
    }
    const start = index;
    let hash = 0;
    while (index < length) {
      const code = text.codePointAt(index) ?? 0;
      if (!isWordCodePoint(code)) break;
      hash = (Math.imul(hash, 31) + foldedCode(code > 0xffff ? 0xfffd : code)) | 0;
      index += code > 0xffff ? 2 : 1;
    }
    onWord(start, index, hash);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function phrasePattern(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => escapeRegExp(part).replace(/[её]/giu, '[её]'))
    .join('\\s+');
}

/** A bare capital abbreviation («SDS», «ИМТ», «СКФ»): one token of capitals and digits. */
function isAbbreviation(value: string): boolean {
  return /^[\p{Lu}\p{N}-]{2,8}$/u.test(value) && /\p{Lu}/u.test(value);
}

/** The text before the match ends with a number («+1 SDS», «−2 SDS», «5 ЕД»). */
const NUMBER_BEFORE = /(?:^|[^\p{L}\p{N}])[+\-−–]?\d+(?:[.,]\d+)?\s*$/u;

/**
 * An abbreviation right after a number is a unit or a measure there («+1 SDS» is a standard
 * deviation score), not the name of a tool that happens to use the same letters (the Zung scale
 * abbreviates to SDS too), so it is left as plain text.
 */
function isUnitUse(text: string, start: number, linkedText: string): boolean {
  return (
    isAbbreviation(linkedText) && NUMBER_BEFORE.test(text.slice(Math.max(0, start - 12), start))
  );
}

function targetKey(definition: ToolLinkDefinition<string>): string {
  return `${definition.kind}\u0000${definition.id}\u0000${definition.slug}`;
}

export function createToolLinkMatcher<Kind extends string>(
  definitions: readonly ToolLinkDefinition<Kind>[],
): ToolLinkMatcher<Kind> {
  const candidates = new Map<string, Map<string, ToolLinkDefinition<Kind>>>();

  for (const definition of definitions) {
    for (const phrase of definition.phrases) {
      const normalized = normalizePhrase(phrase);
      if (normalized.length < 3) continue;
      const targets = candidates.get(normalized) ?? new Map();
      targets.set(targetKey(definition), definition);
      candidates.set(normalized, targets);
    }
  }

  const ambiguousPhrases: string[] = [];
  const phrases: IndexedPhrase<Kind>[] = [];
  for (const [normalized, targets] of candidates) {
    if (targets.size !== 1) {
      ambiguousPhrases.push(normalized);
      continue;
    }
    const definition = targets.values().next().value;
    if (!definition) continue;
    phrases.push({
      definition,
      normalized,
      pattern: phrasePattern(normalized),
    });
  }

  // One collator: `localeCompare(…, 'ru-RU')` looks the locale up on every comparison of ~2 000 phrases.
  const collator = new Intl.Collator('ru-RU');
  phrases.sort(
    (left, right) =>
      right.normalized.length - left.normalized.length ||
      collator.compare(left.normalized, right.normalized),
  );
  ambiguousPhrases.sort((left, right) => collator.compare(left, right));

  const phraseByNormalized = new Map(phrases.map((phrase) => [phrase.normalized, phrase] as const));
  // Every phrase starts with a whole word of the text. Phrases are grouped by that word, so a block
  // is scanned word by word and only the few phrases that begin with a word it holds are tried,
  // instead of one alternation of hundreds of phrases at every position of every paragraph.
  const WORD_END = '(?=$|[^\\p{L}\\p{M}\\p{N}_])';
  const groupPhrases = new Map<string, IndexedPhrase<Kind>[]>();
  let scanEveryText = false;
  for (const phrase of phrases) {
    const word = FIRST_WORD.exec(phrase.normalized)?.[1];
    if (!word) {
      scanEveryText = true;
      break;
    }
    const key = foldWord(word);
    const group = groupPhrases.get(key) ?? [];
    group.push(phrase);
    groupPhrases.set(key, group);
  }
  // First words by hash: a text word is looked up without building its string.
  const wordsByHash = new Map<number, string[]>();
  if (!scanEveryText) {
    for (const word of groupPhrases.keys()) {
      const hash = hashFoldedWord(word);
      wordsByHash.set(hash, [...(wordsByHash.get(hash) ?? []), word]);
    }
  }
  // A phrase that opens with punctuation has no word to look it up by: such a catalogue keeps the
  // single expression over the whole text.
  const expression =
    scanEveryText && phrases.length
      ? new RegExp(
          `(^|[^\\p{L}\\p{M}\\p{N}_])(${phrases.map((phrase) => phrase.pattern).join('|')})${WORD_END}`,
          'giu',
        )
      : null;

  /** The phrase matches of a text, left to right and without overlaps: `[start, linkedText, phrase]`. */
  const matchesIn = (text: string): readonly (readonly [number, string, IndexedPhrase<Kind>])[] => {
    const found: (readonly [number, string, IndexedPhrase<Kind>])[] = [];
    let reached = 0;
    if (expression) {
      expression.lastIndex = 0;
      for (let match = expression.exec(text); match; match = expression.exec(text)) {
        const linkedText = match[2];
        if (!linkedText) continue;
        const phrase = phraseByNormalized.get(normalizePhrase(linkedText));
        if (!phrase) continue;
        const start = match.index + (match[1] ?? '').length;
        if (start < reached) continue;
        if (isUnitUse(text, start, linkedText)) continue;
        found.push([start, linkedText, phrase]);
        reached = start + linkedText.length;
      }
      return found;
    }
    scanWords(text, (start, end, hash) => {
      if (start < reached) return;
      const candidates = wordsByHash.get(hash);
      if (!candidates) return;
      const folded = foldWord(text.slice(start, end));
      if (!candidates.includes(folded)) return;
      // Longest phrase first, as the single expression ordered its alternatives.
      for (const phrase of groupPhrases.get(folded) ?? []) {
        const phraseEnd = phraseEndAt(text, start, phrase.normalized);
        if (phraseEnd < 0) continue;
        // A rejected match still consumes its words, as the single expression did.
        reached = phraseEnd;
        if (!isUnitUse(text, start, text.slice(start, phraseEnd))) {
          found.push([start, text.slice(start, phraseEnd), phrase]);
        }
        return;
      }
    });
    return found;
  };

  return {
    ambiguousPhrases,
    segment(text: string): readonly ToolLinkSegment<Kind>[] {
      if (!text || phrases.length === 0) return [{ kind: 'text', value: text }];
      const segments: ToolLinkSegment<Kind>[] = [];
      let cursor = 0;

      for (const [start, linkedText, phrase] of matchesIn(text)) {
        const end = start + linkedText.length;
        if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) });
        segments.push({
          kind: phrase.definition.kind,
          id: phrase.definition.id,
          slug: phrase.definition.slug,
          value: text.slice(start, end),
        });
        cursor = end;
      }

      if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
      return segments.length > 0 ? segments : [{ kind: 'text', value: text }];
    },
  };
}
