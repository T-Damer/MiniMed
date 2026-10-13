/**
 * Folding for text matching: the same words compare equal whatever the typography around them.
 *
 * Case, `ё`/`е`, soft hyphens and zero-width characters, ligatures and full-width forms (NFKC),
 * quotes («»„“”"), dashes (- – — −), non-breaking spaces and every other punctuation mark are
 * erased, runs of them becoming a single space. Letters, digits and the comparison signs that
 * change a clinical statement (`< > = ≥ ≤ ± +`) are kept. Every folded character remembers the
 * span of the original it came from, so a match found in the folded text maps back to the page.
 */

export interface FoldedText {
  readonly text: string;
  /** Folded index → start offset of the original character. */
  readonly starts: Int32Array;
  /** Folded index → end offset (exclusive) of the original character. */
  readonly ends: Int32Array;
}

const KEPT_SYMBOLS = new Set(['<', '>', '=', '≥', '≤', '≠', '±', '+', '×']);
const INVISIBLE = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x061c, 0x180e]);
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const COMBINING_MARK = /\p{M}/u;

/** Folds `source`; see the module comment for the rules. */
export function foldText(source: string): FoldedText {
  const capacity = source.length * 2 + 1;
  const out: string[] = [];
  const starts = new Int32Array(capacity);
  const ends = new Int32Array(capacity);
  let length = 0;
  let separatorStart = -1;
  let separatorEnd = -1;

  const push = (character: string, start: number, end: number): void => {
    if (separatorStart >= 0 && length > 0) {
      out.push(' ');
      starts[length] = separatorStart;
      ends[length] = separatorEnd;
      length += 1;
    }
    separatorStart = -1;
    for (let index = 0; index < character.length; index += 1) {
      out.push(character.charAt(index));
      starts[length] = start;
      ends[length] = end;
      length += 1;
    }
  };

  const separate = (start: number, end: number): void => {
    if (separatorStart < 0) separatorStart = start;
    separatorEnd = end;
  };

  let offset = 0;
  while (offset < source.length) {
    const code = source.charCodeAt(offset);
    // Fast paths: basic Cyrillic and ASCII letters and digits, plain whitespace.
    if (code >= 0x430 && code <= 0x44f) {
      push(String.fromCharCode(code), offset, offset + 1);
      offset += 1;
      continue;
    }
    if (code >= 0x410 && code <= 0x42f) {
      push(String.fromCharCode(code + 0x20), offset, offset + 1);
      offset += 1;
      continue;
    }
    if (code === 0x451 || code === 0x401) {
      push('е', offset, offset + 1);
      offset += 1;
      continue;
    }
    if ((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) {
      push(String.fromCharCode(code), offset, offset + 1);
      offset += 1;
      continue;
    }
    if (code >= 0x41 && code <= 0x5a) {
      push(String.fromCharCode(code + 0x20), offset, offset + 1);
      offset += 1;
      continue;
    }
    if (code === 0x20 || code === 0x0a || code === 0x09 || code === 0x0d) {
      separate(offset, offset + 1);
      offset += 1;
      continue;
    }
    const point = source.codePointAt(offset) ?? code;
    const end = offset + (point > 0xffff ? 2 : 1);
    if (INVISIBLE.has(point)) {
      offset = end;
      continue;
    }
    const raw = String.fromCodePoint(point);
    if (COMBINING_MARK.test(raw)) {
      // A stray accent or breve belongs to the letter before it: it neither adds nor splits.
      offset = end;
      continue;
    }
    let wrote = false;
    for (const character of raw.normalize('NFKC').toLowerCase()) {
      if (character === 'ё') {
        push('е', offset, end);
        wrote = true;
      } else if (WORD_CHARACTER.test(character) || KEPT_SYMBOLS.has(character)) {
        push(character, offset, end);
        wrote = true;
      }
    }
    // Spaces, punctuation and other symbols all separate words.
    if (!wrote) separate(offset, end);
    offset = end;
  }

  return { text: out.join(''), starts: starts.slice(0, length), ends: ends.slice(0, length) };
}

/** Folded form of `value` without the offset maps. */
export function foldedString(value: string): string {
  return foldText(value).text;
}

/** Original `[start, end)` covered by the folded range `[from, to)`. */
export function originalRange(
  folded: FoldedText,
  from: number,
  to: number,
): { readonly start: number; readonly end: number } {
  const lastIndex = Math.max(0, folded.text.length - 1);
  const first = Math.min(Math.max(0, from), lastIndex);
  const last = Math.min(Math.max(first, to - 1), lastIndex);
  return { start: folded.starts[first] ?? 0, end: folded.ends[last] ?? 0 };
}
