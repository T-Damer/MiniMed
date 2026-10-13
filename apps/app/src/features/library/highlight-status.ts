import type { UserDocumentHighlight } from '@/state/user-library-highlights';

/**
 * The short note a highlight shows when it is not simply where the reader selected it, or
 * `undefined` for an ordinary one. Wording is for a doctor reading a newer edition.
 */
export function highlightStatusNote(
  highlight: Pick<UserDocumentHighlight, 'anchorStatus' | 'carriedFrom'>,
): string | undefined {
  const carried = highlight.carriedFrom !== undefined;
  switch (highlight.anchorStatus) {
    case 'missing':
      return 'Не найдено в новой редакции';
    case 'approximate':
      return carried
        ? 'Из прежней редакции · текст изменён, перенесено приблизительно'
        : 'Текст изменён · перенесено приблизительно';
    case 'moved':
      return carried ? 'Из прежней редакции · текст перенесён' : 'Текст перенесён на новое место';
    default:
      return carried ? 'Из прежней редакции' : undefined;
  }
}

/** Highlights that are painted on the page, as opposed to the ones only listed. */
export function isPaintedHighlight(
  highlight: Pick<UserDocumentHighlight, 'anchorStatus'>,
): boolean {
  return highlight.anchorStatus !== 'missing';
}

export interface HighlightStatusCounts {
  readonly total: number;
  readonly missing: number;
  readonly approximate: number;
}

export function highlightStatusCounts(
  highlights: readonly Pick<UserDocumentHighlight, 'anchorStatus' | 'cfiRange'>[],
): HighlightStatusCounts {
  return {
    total: highlights.length,
    missing: highlights.filter((item) => item.anchorStatus === 'missing').length,
    approximate: highlights.filter((item) => item.anchorStatus === 'approximate').length,
  };
}
