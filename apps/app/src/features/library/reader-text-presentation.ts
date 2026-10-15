import { CLEANED_SECTION_TITLES } from '@/features/library/document-display';
import { documentTextSearchText } from '@/features/library/document-text-search';
import {
  isUnstatedValue,
  normalizePresentation,
  normalizeStrength,
  presentRegistryLine,
  sentenceCaseUpper,
} from '@/features/search/registry-values';
import {
  dropRegistryIdentifiers,
  presentSourceChunkText,
} from '@/features/search/search-result-presentation';

/**
 * Reader words for catalogue text. The registry (ЕСКЛП) and the card builders write their lines as
 * «key: value» dumps with internal codes; a doctor reads «Таблетки, 500 мг · АО АВВА РУС». Only the
 * display changes: the stored text, its checksum and its anchors stay as they were.
 */

/** A registry code that stands for one dosage form: «21.20.10.191-000003-1-00167-0000000000000». */
const SMNN_CODE_PATTERN = /\d{2}\.\d{2}\.\d{2}\.\d{3}-\d{6}-\d-\d{5}-\d{13}/u;

export { normalizePresentation, normalizeStrength, presentRegistryLine, sentenceCaseUpper };

/** Section headings of a drug card made of a registry code: «Таблетки, 500 мг». */
export function presentReaderSectionTitle(title: string): string {
  const match = new RegExp(`^${SMNN_CODE_PATTERN.source}\\s*[—–-]\\s*(.+)$`, 'u').exec(
    title.trim(),
  );
  if (!match) return title;
  const parts = (match[1] ?? '').split(/\s+[—–]\s+/u).map((part) => part.trim());
  const [form = '', ...strengths] = parts;
  return [
    sentenceCaseUpper(form),
    ...strengths.filter((part) => !isUnstatedValue(part)).map(normalizeStrength),
  ]
    .filter((part) => part !== '')
    .join(', ');
}

/** The raw link a card builder appends to its source line: the reader keeps the source's name. */
const SOURCE_LINK_LINES: readonly (readonly [RegExp, string])[] = [
  [/^(Источник: [^—\n]+?)\s+[—-]\s+https?:\/\/\S+\s*$/gmu, '$1'],
  [/^Официальная страница записи: https?:\/\/\S+\s*$\n?/gmu, ''],
];

/**
 * A chunk's text as the reader shows it. Technical cards lose their catalogue labels, identifiers
 * and empty fields; registry dumps become one readable line each. Returns the text unchanged when
 * nothing applies, so the caller can keep exact highlight offsets in that case.
 */
export function presentReaderChunkText(
  text: string,
  sectionTitle: string,
  sourceType: string,
): string {
  let result = text;
  if (CLEANED_SECTION_TITLES.has(sectionTitle.trim())) {
    result = presentSourceChunkText(result, [sectionTitle.trim()]);
  }
  if (
    sourceType === 'official_registry_summary' ||
    sourceType === 'core_catalog_pointer' ||
    /ТН:|КЛП:|СМНН:/u.test(result)
  ) {
    result = result
      .split('\n')
      .map((line) => presentRegistryLine(line, presentReaderSectionTitle(sectionTitle)) ?? line)
      .join('\n');
  }
  for (const [pattern, replacement] of SOURCE_LINK_LINES) {
    result = result.replace(pattern, replacement);
  }
  return dropRegistryIdentifiers(result);
}

/**
 * The text in-document find searches for one plain-text chunk: exactly what the reader shows
 * (reader words, parsed blocks), never the stored text with its hidden labels and identifiers.
 */
export function readerChunkFindText(
  text: string,
  sectionTitle: string,
  sourceType: string,
  sourceSpans?: unknown,
): string {
  return documentTextSearchText(
    presentReaderChunkText(text, sectionTitle, sourceType),
    sourceSpans,
  );
}
