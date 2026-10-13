import type { QueryWordCorrection } from '@localmed/contracts';

/**
 * How the search box shows a spelling correction (roadmap item 19): the typed text letter by
 * letter, a wrong letter struck out, the right one added next to it («Пом~~о~~**р**ач»). The
 * component only renders these pieces.
 */
export type CorrectionPieceKind = 'same' | 'removed' | 'added';

export interface CorrectionPiece {
  readonly text: string;
  readonly kind: CorrectionPieceKind;
}

const WORD = /[0-9A-Za-zА-Яа-яЁё]+/gu;

/** The core compares words lower-cased with «ё» read as «е». */
function fold(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е');
}

function isUpper(letter: string): boolean {
  return letter !== letter.toLowerCase() && letter === letter.toUpperCase();
}

/**
 * Letter edits from the typed word to the corrected one: a minimal alignment, a substitution shown
 * as the removed letter followed by the added one. Kept letters keep the typed case and «ё»; an
 * added letter takes the case of the letter it replaces, or upper case in an all-capital word.
 */
export function letterPieces(typed: string, corrected: string): readonly CorrectionPiece[] {
  const from = [...typed];
  const to = [...corrected];
  const folded = from.map(fold);
  const rows = from.length + 1;
  const columns = to.length + 1;
  const cost = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) (cost[row] as number[])[0] = row;
  for (let column = 0; column < columns; column += 1) (cost[0] as number[])[column] = column;
  for (let row = 1; row < rows; row += 1)
    for (let column = 1; column < columns; column += 1) {
      const same = folded[row - 1] === to[column - 1];
      (cost[row] as number[])[column] = Math.min(
        (cost[row - 1]?.[column - 1] ?? 0) + (same ? 0 : 1),
        (cost[row - 1]?.[column] ?? 0) + 1,
        (cost[row]?.[column - 1] ?? 0) + 1,
      );
    }
  const allCaps =
    from.length > 1 && from.every((letter) => !/\p{L}/u.test(letter) || isUpper(letter));
  const added = (letter: string, replaced: string | undefined) =>
    (replaced !== undefined ? isUpper(replaced) : allCaps) ? letter.toUpperCase() : letter;
  const pieces: CorrectionPiece[] = [];
  let row = from.length;
  let column = to.length;
  while (row > 0 || column > 0) {
    const here = cost[row]?.[column] ?? 0;
    const typedLetter = from[row - 1];
    const wanted = to[column - 1] ?? '';
    if (
      row > 0 &&
      column > 0 &&
      folded[row - 1] === wanted &&
      here === cost[row - 1]?.[column - 1]
    ) {
      pieces.push({ text: typedLetter ?? '', kind: 'same' });
      row -= 1;
      column -= 1;
    } else if (row > 0 && column > 0 && here === (cost[row - 1]?.[column - 1] ?? 0) + 1) {
      pieces.push({ text: added(wanted, typedLetter), kind: 'added' });
      pieces.push({ text: typedLetter ?? '', kind: 'removed' });
      row -= 1;
      column -= 1;
    } else if (row > 0 && here === (cost[row - 1]?.[column] ?? 0) + 1) {
      pieces.push({ text: typedLetter ?? '', kind: 'removed' });
      row -= 1;
    } else {
      pieces.push({ text: added(wanted, undefined), kind: 'added' });
      column -= 1;
    }
  }
  return merge(pieces.reverse());
}

function merge(pieces: readonly CorrectionPiece[]): readonly CorrectionPiece[] {
  const merged: CorrectionPiece[] = [];
  for (const piece of pieces) {
    if (piece.text === '') continue;
    const last = merged.at(-1);
    if (last?.kind === piece.kind)
      merged[merged.length - 1] = { ...last, text: last.text + piece.text };
    else merged.push(piece);
  }
  return merged;
}

/**
 * The typed `text` with each corrected word replaced by its letter edits, or null when a corrected
 * word is no longer in the text (the box was edited after the search).
 */
export function correctionPieces(
  text: string,
  corrections: readonly QueryWordCorrection[],
): readonly CorrectionPiece[] | null {
  const pending = [...corrections];
  const pieces: CorrectionPiece[] = [];
  let cursor = 0;
  for (const match of text.matchAll(WORD)) {
    const at = pending.findIndex((item) => item.original === fold(match[0]));
    if (at < 0) continue;
    const [correction] = pending.splice(at, 1);
    if (!correction) continue;
    pieces.push({ text: text.slice(cursor, match.index), kind: 'same' });
    pieces.push(...letterPieces(match[0], correction.corrected));
    cursor = match.index + match[0].length;
  }
  if (pending.length > 0 || pieces.length === 0) return null;
  pieces.push({ text: text.slice(cursor), kind: 'same' });
  return merge(pieces);
}

/** What the box holds once the correction is accepted: the kept and added letters. */
export function correctedText(pieces: readonly CorrectionPiece[]): string {
  return pieces
    .filter((piece) => piece.kind !== 'removed')
    .map((piece) => piece.text)
    .join('');
}
