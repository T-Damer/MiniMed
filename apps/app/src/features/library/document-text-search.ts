import { stripKnownHtmlMarkup } from '@/components/html-markup';
import {
  type DocumentTextBlock,
  parseDocumentText,
} from '@/features/library/document-medication-links';

/**
 * The text of a parsed block as the page shows it, or `null` when the block shows none (a
 * reference image displays only the picture, never its alt text). Find counts exactly this text and
 * `DocumentText` places highlights by the same offsets, so every counted match has a word on screen.
 */
export function documentTextBlockSearchText(block: DocumentTextBlock): string | null {
  if (block.kind === 'image') return null;
  return block.text.replaceAll('**', '');
}

/** The searchable text of a chunk: the visible text of its blocks, one per line. */
export function documentTextSearchText(text: string, sourceSpans?: unknown): string {
  return parseDocumentText(stripKnownHtmlMarkup(text), sourceSpans)
    .flatMap((block) => {
      const searchText = documentTextBlockSearchText(block);
      return searchText === null ? [] : [searchText];
    })
    .join('\n');
}
