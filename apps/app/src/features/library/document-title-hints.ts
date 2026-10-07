import type { MedicalDocumentSummary } from '@localmed/contracts';

import { displayDocumentTitle } from '@/features/library/document-display';

/** What the reader shows for a document whose name is not known yet. */
export const OPENING_DOCUMENT_TITLE = 'Открываем документ';

type TitleSource = Pick<
  MedicalDocumentSummary,
  'id' | 'title' | 'shortTitle' | 'sourceType' | 'metadata'
>;

/** The newest catalog lists the app has read; indexed on the first lookup, not when received. */
const MAX_REMEMBERED_LISTS = 3;
const MAX_EXPLICIT_TITLES = 200;
let rememberedLists: Array<readonly TitleSource[]> = [];
const listIndexes = new WeakMap<readonly TitleSource[], Map<string, TitleSource>>();
const explicitTitles = new Map<string, string>();

/**
 * Remembers the document list the core has just returned, so a document opened later is named
 * before its own text has loaded. Only the reference is kept; nothing is copied or indexed here.
 */
export function rememberDocumentSummaries(summaries: readonly TitleSource[]): void {
  if (summaries.length === 0 || rememberedLists[0] === summaries) return;
  rememberedLists = [summaries, ...rememberedLists.filter((list) => list !== summaries)].slice(
    0,
    MAX_REMEMBERED_LISTS,
  );
}

/** A title the opener already knows (a link's label, a card's heading). */
export function rememberDocumentTitle(documentId: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed || trimmed === OPENING_DOCUMENT_TITLE) return;
  explicitTitles.delete(documentId);
  explicitTitles.set(documentId, trimmed);
  if (explicitTitles.size > MAX_EXPLICIT_TITLES) {
    const oldest = explicitTitles.keys().next();
    if (!oldest.done) explicitTitles.delete(oldest.value);
  }
}

function indexOf(list: readonly TitleSource[]): Map<string, TitleSource> {
  let index = listIndexes.get(list);
  if (!index) {
    index = new Map(list.map((summary) => [summary.id, summary]));
    listIndexes.set(list, index);
  }
  return index;
}

/** The name a reader shows for the document, if the app has met it before it was asked to open. */
export function knownDocumentTitle(documentId: string): string | undefined {
  const explicit = explicitTitles.get(documentId);
  if (explicit) return explicit;
  for (const list of rememberedLists) {
    const summary = indexOf(list).get(documentId);
    if (summary) {
      const title = displayDocumentTitle(summary).trim();
      if (title) return title;
    }
  }
  return undefined;
}

/** True for the placeholder names a trail starts with before the real title is known. */
export function isPlaceholderDocumentTitle(title: string): boolean {
  return title === OPENING_DOCUMENT_TITLE || title === 'Документ' || title === 'Личный документ';
}

export function resetDocumentTitleHintsForTests(): void {
  rememberedLists = [];
  explicitTitles.clear();
}
