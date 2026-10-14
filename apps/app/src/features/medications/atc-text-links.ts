/**
 * ATC codes inside running text (ATC5): an instruction that says «Код АТХ: J05AX13» gets the code
 * as an inline link. Pure; the document text renders the `atc` segments (`DocumentText.tsx`).
 *
 * Which tokens are codes, in text (stricter than a typed query, which has the whole field to itself):
 * - a full substance code (`J05AX13`, seven characters: letter, digit, digit, letter, letter, digit,
 *   digit) is a code anywhere; no ICD-10 code has that shape;
 * - a shorter code (`J05`, `J05A`, `J05AX`, `J05AX1`) has the shape of an ICD-10 category (`J05` is
 *   «острый обструктивный ларингит»), so it counts only right after the words «АТХ» / «ATC» (with
 *   «код», a colon or a dash between) and in a list that continues such a code («АТХ: J05AX, J05AB»);
 * - a code with a dot or hyphen after it (`J05.1`, `J05-J06`) is an ICD-10 code or a range, never ATC;
 * - Cyrillic look-alike letters are read as Latin ones (registries write «С01ВА»); the Russian-layout
 *   reading of a query is not applied to text.
 */

import { parseAtcQueries } from '@localmed/search-lexical';
import type { DrugAtcCode } from '@/features/medications/drug-screen';

export type AtcTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'atc';
      /** The text as written, for display. */
      readonly value: string;
      /** The normalised Latin code. */
      readonly code: string;
    };

const LETTER = '[A-Za-zА-Яа-я]';
const TOKEN = new RegExp(
  `(?<![\\p{L}\\p{N}.\\-/])${LETTER}\\d{2}(?:${LETTER}{1,2}(?:\\d{1,2})?)?(?![\\p{L}\\p{N}]|[.\\-]\\d|-${LETTER})`,
  'gu',
);
/** «АТХ», «ATC» (Latin, Cyrillic or mixed look-alikes) and the words that follow them. */
const MARKER = /(?<![\p{L}\p{N}])(?:[АA][ТT][ХXC]|ATХ)(?![\p{L}\p{N}])/iu;
const LOOK_BACK = 120;
/** Between the marker and a code: «код», «коды», «code», punctuation, other codes of a list. */
const GAP =
  /^[\s:–—\-,;/()«»]*(?:(?:код[а-я]*|code[s]?)[\s:–—\-,;/()«»]*)?(?:[A-Za-zА-Яа-я]\d{2}[A-Za-zА-Яа-я0-9]*[\s,;/]*(?:и|или|and|or)?[\s,;/]*)*$/iu;

function readAsWritten(token: string): string | null {
  const read = parseAtcQueries(token).find((query) => query.reading !== 'layout');
  return read ? read.code : null;
}

function followsMarker(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - LOOK_BACK), index);
  let last: { end: number } | null = null;
  for (const match of before.matchAll(new RegExp(MARKER.source, 'giu'))) {
    last = { end: match.index + match[0].length };
  }
  return last !== null && GAP.test(before.slice(last.end));
}

/** The text split into plain parts and ATC codes; no code means one text part. */
export function segmentTextWithAtcCodes(text: string): readonly AtcTextSegment[] {
  if (text.length < 3) return [{ kind: 'text', value: text }];
  const segments: AtcTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const code = readAsWritten(token);
    if (!code) continue;
    if (code.length < 7 && !followsMarker(text, match.index)) continue;
    if (match.index > cursor)
      segments.push({ kind: 'text', value: text.slice(cursor, match.index) });
    segments.push({ kind: 'atc', value: token, code });
    cursor = match.index + token.length;
  }
  if (segments.length === 0) return [{ kind: 'text', value: text }];
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
  return segments;
}

/**
 * A code met in a text, shaped for the code sheet: no drug stands behind it, so there is no group
 * text, substance, edition or fill history. `written` is the text as the source wrote it.
 */
export function atcCodeFromText(code: string, written: string): DrugAtcCode {
  const level = code.length >= 6 ? 5 : code.length === 5 ? 4 : code.length === 4 ? 3 : 2;
  return {
    code,
    level,
    sourceCode: /[А-Яа-я]/u.test(written) ? written : null,
    groupText: null,
    substanceName: null,
    edition: null,
    fillSources: [],
    registryValue: null,
    alternatives: [],
    consensusSources: [],
  };
}
