/**
 * A typed ATC (АТХ) code or code prefix as a drug query (ATC5), and the one rule that matches it
 * against the codes of a drug directory. Shared by the main search (`@localmed/core`) and the
 * drug pickers of the app, so a code is read the same way everywhere.
 *
 * A query is an ATC code only when the whole query, spaces ignored, has the code shape: an
 * anatomical letter, two digits and then as much of «letter, letter, digit, digit» as was typed
 * («J05», «J05A», «J05AX», «J05AX1», «J05AX13»). A letter with one digit («С3», «B1») and a lone
 * letter are words, and so is anything longer or with other characters. Whether a code exists is
 * not decided here: the caller looks it up and shows nothing when no drug carries it («В12»).
 *
 * Typed on the wrong script the code is still read: Cyrillic letters that look like Latin ones
 * (А В С Е Н К М О Р Т Х У), and the keys of the Russian layout («о05» is «j05» typed with the
 * Russian layout on). The text is read as it looks, then as keys, then character by character, so a
 * mixed «о05АХ13» is `J05AX13`; a text with two readings gives both (`parseAtcQueries`) and the
 * caller keeps the first that names a drug.
 */
import { latinKeyOfRussianLetter } from './name-variants';

/** Level 2 («J05») to 5 («J05AX13», and «J05AX1» typed up to the last digit). */
export type AtcQueryLevel = 2 | 3 | 4 | 5;

/** How the characters were read: as typed, as look-alike Cyrillic letters, as Russian-layout keys. */
export type AtcQueryReading = 'plain' | 'lookalike' | 'layout';

export interface AtcQuery {
  /** Latin upper-case code or prefix, 3 to 7 characters. */
  readonly code: string;
  readonly level: AtcQueryLevel;
  readonly reading: AtcQueryReading;
}

/** First letters of ATC codes (the 14 anatomical groups). */
const ANATOMICAL_LETTERS = 'ABCDGHJLMNPRSV';
const MAX_TYPED_LENGTH = 24;
/** Spaces and the invisible characters a pasted code carries (soft hyphen, zero-width space, word joiner, BOM). */
const IGNORED = /(?:\s|­|​|⁠|﻿)+/gu;

/** Cyrillic capital letters that look like a Latin one. */
const LOOKALIKES: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Т: 'T',
  Х: 'X',
  У: 'Y',
};

/** What a position of the code takes: the first letter, a digit, or any letter. */
type Slot = 'anatomical' | 'digit' | 'letter';
const SLOTS: readonly Slot[] = [
  'anatomical',
  'digit',
  'digit',
  'letter',
  'letter',
  'digit',
  'digit',
];
const LEVEL_BY_LENGTH: Readonly<Record<number, AtcQueryLevel>> = { 3: 2, 4: 3, 5: 4, 6: 5, 7: 5 };

interface Reading {
  readonly latin: string;
  readonly reading: AtcQueryReading;
}

function slotAccepts(slot: Slot, latin: string): boolean {
  if (slot === 'digit') return /^\d$/u.test(latin);
  if (slot === 'anatomical') return ANATOMICAL_LETTERS.includes(latin);
  return /^[A-Z]$/u.test(latin);
}

/** Which readings of a Cyrillic character are allowed: its look, its key, or both (a mixed code). */
type Allowed = 'lookalike' | 'layout' | 'both';

/** The Latin readings of one typed character, the likeliest first. */
function readings(character: string, allowed: Allowed): readonly Reading[] {
  if (/^[0-9A-Za-z]$/u.test(character)) {
    return [{ latin: character.toUpperCase(), reading: 'plain' }];
  }
  const found: Reading[] = [];
  const lookalike = LOOKALIKES[character.toLocaleUpperCase('ru-RU')];
  if (lookalike && allowed !== 'layout') found.push({ latin: lookalike, reading: 'lookalike' });
  const key = latinKeyOfRussianLetter(character);
  if (key && allowed !== 'lookalike') found.push({ latin: key.toUpperCase(), reading: 'layout' });
  return found;
}

function readCode(
  characters: readonly string[],
  allowed: Allowed,
): { readonly code: string; readonly reading: AtcQueryReading } | null {
  const chosen: Reading[] = [];
  const read = (position: number): boolean => {
    const character = characters[position];
    if (character === undefined) return true;
    const slot = SLOTS[position];
    if (slot === undefined) return false;
    for (const candidate of readings(character, allowed)) {
      if (!slotAccepts(slot, candidate.latin)) continue;
      chosen[position] = candidate;
      if (read(position + 1)) return true;
    }
    return false;
  };
  if (!read(0)) return null;
  const reading: AtcQueryReading = chosen.some((entry) => entry.reading === 'layout')
    ? 'layout'
    : chosen.some((entry) => entry.reading === 'lookalike')
      ? 'lookalike'
      : 'plain';
  return { code: chosen.map((entry) => entry.latin).join(''), reading };
}

/**
 * Every way the typed text reads as an ATC code or prefix, the likeliest first: as typed (Latin
 * letters, Cyrillic look-alikes), as the keys of the Russian layout, then character by character
 * (look or key). One text can mean two codes («ае01» is `AE01` by look and `FT01` by key); the caller
 * keeps the first reading that names a drug. Empty for a word, a single letter, a letter with one
 * digit, anything longer than a code.
 */
export function parseAtcQueries(raw: string): readonly AtcQuery[] {
  if (raw.length === 0 || raw.length > MAX_TYPED_LENGTH) return [];
  const characters = [...raw.normalize('NFKC').replace(IGNORED, '')];
  const level = LEVEL_BY_LENGTH[characters.length];
  if (level === undefined) return [];
  const queries: AtcQuery[] = [];
  for (const allowed of ['lookalike', 'layout', 'both'] as const) {
    const read = readCode(characters, allowed);
    if (read && !queries.some((query) => query.code === read.code)) {
      queries.push({ code: read.code, level, reading: read.reading });
    }
  }
  return queries;
}

/** The likeliest reading of `parseAtcQueries`, or null when the text is not a code. */
export function parseAtcQuery(raw: string): AtcQuery | null {
  return parseAtcQueries(raw)[0] ?? null;
}

/** True when the code (Latin upper case) is the typed code or begins with it. */
export function atcCodeMatches(query: Pick<AtcQuery, 'code'>, code: string): boolean {
  return code.startsWith(query.code);
}

/** A code several sources agree on beside the registry's group stub it stands for (ATC3). */
export interface AtcAgreedCode {
  readonly code: string;
  readonly registry: string;
}

/** One drug (a substance card) of a directory: every code it is found under. */
export interface AtcDirectoryEntry {
  readonly id: string;
  /** Display name, used to order equal matches. */
  readonly name: string;
  /** Normalised codes: the completed ones, the registry's and the agreed ones. */
  readonly codes: readonly string[];
  readonly agreed?: readonly AtcAgreedCode[];
}

export interface AtcEntryMatch<T extends AtcDirectoryEntry = AtcDirectoryEntry> {
  readonly entry: T;
  /** The code to show: the agreed one when the match is on a pair, otherwise the matched code. */
  readonly code: string;
  /** The registry's stub beside an agreed `code`; null for any other code. */
  readonly registryCode: string | null;
  /** The entry carries exactly the typed code (a group stub for a group query), not a longer one. */
  readonly exact: boolean;
}

/** How an entry matches a typed code, or null when none of its codes begins with it. */
export function matchAtcEntry<T extends AtcDirectoryEntry>(
  query: Pick<AtcQuery, 'code'>,
  entry: T,
): AtcEntryMatch<T> | null {
  const matched = entry.codes.filter((code) => atcCodeMatches(query, code));
  if (matched.length === 0) return null;
  const exact = matched.includes(query.code);
  const pair = entry.agreed?.find(
    (agreed) => matched.includes(agreed.code) || matched.includes(agreed.registry),
  );
  if (pair) return { entry, code: pair.code, registryCode: pair.registry, exact };
  const best = exact ? query.code : matched.toSorted()[0];
  return best === undefined ? null : { entry, code: best, registryCode: null, exact };
}

/**
 * The entries a typed code finds: the exact level first (a drug that carries the very code, a group
 * stub for a group query), then by name; at most `limit` of them.
 */
export function findAtcEntries<T extends AtcDirectoryEntry>(
  query: Pick<AtcQuery, 'code'>,
  entries: readonly T[],
  limit = Number.POSITIVE_INFINITY,
): readonly AtcEntryMatch<T>[] {
  const matches: AtcEntryMatch<T>[] = [];
  for (const entry of entries) {
    const match = matchAtcEntry(query, entry);
    if (match) matches.push(match);
  }
  return matches
    .toSorted(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        left.entry.name.localeCompare(right.entry.name, 'ru') ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .slice(0, limit);
}
