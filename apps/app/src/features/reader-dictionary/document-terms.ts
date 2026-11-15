import type { MedicalSection } from '@localmed/contracts';

import { titleNamesWords } from '@/features/reader-dictionary/selection-term';

/**
 * The terms a document defines for itself: the lines of its «Список сокращений» and «Термины и
 * определения» sections. A reader who forgot what «ОФС» means in this recommendation wants this
 * recommendation's answer first; across the corpus the same abbreviation has several expansions
 * (owner 2026-11-15, search review). The text is the source's own line, never rewritten.
 */
export interface DocumentTerm {
  readonly kind: 'abbreviation' | 'term';
  readonly term: string;
  /** The source's own wording after the dash. */
  readonly meaning: string;
  readonly sectionTitle: string;
  readonly anchor: string;
}

const ABBREVIATION_SECTION = /^(?:список|перечень)\s+(?:условных\s+)?сокращений/iu;
const TERM_SECTION = /^термины\s+и\s+определения/iu;
/** «АГ – артериальная гипертензия»: a short left side, a spaced dash, the meaning. */
const ENTRY = /^(.{1,80}?)\s+[–—-]\s+(.+)$/u;

function sectionKind(title: string): DocumentTerm['kind'] | undefined {
  const cleaned = title.trim().replace(/^\d+(?:\.\d+)*\.?\s*/u, '');
  if (ABBREVIATION_SECTION.test(cleaned)) return 'abbreviation';
  if (TERM_SECTION.test(cleaned)) return 'term';
  return undefined;
}

/** Every «left – meaning» line of the document's own abbreviation and term sections. */
export function parseDocumentTerms(sections: readonly MedicalSection[]): readonly DocumentTerm[] {
  const terms: DocumentTerm[] = [];
  for (const section of sections) {
    const kind = sectionKind(section.title);
    if (!kind) continue;
    for (const chunk of section.chunks) {
      for (const line of chunk.originalText.split(/\n+/u)) {
        const match = ENTRY.exec(line.trim().replace(/^[-•*]\s+/u, ''));
        const term = match?.[1]?.trim();
        const meaning = match?.[2]?.trim();
        if (!term || !meaning) continue;
        // An abbreviation is one short token (or «BAPS / BAUS»); a sentence with a dash is not one.
        if (kind === 'abbreviation' && term.split(/\s+/u).length > 4) continue;
        terms.push({
          kind,
          term,
          meaning,
          sectionTitle: section.title.trim(),
          anchor: chunk.anchor,
        });
      }
    }
  }
  return terms;
}

function plain(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The document's own entry for a selection. An abbreviation matches letter for letter (case
 * ignored: «офс» finds «ОФС»), also as one side of «BAPS / BAUS»; a term matches by its words in
 * any form («синдрома тестикулярной регрессии» finds «Синдром тестикулярной регрессии»).
 */
export function findDocumentTerm(
  terms: readonly DocumentTerm[],
  selection: string,
): DocumentTerm | undefined {
  const wanted = plain(selection);
  if (!wanted) return undefined;
  const wordCount = wanted.split(' ').length;
  for (const entry of terms) {
    if (entry.kind !== 'abbreviation') continue;
    const names = entry.term.split(/\s*[/,]\s*/u).map(plain);
    if (plain(entry.term) === wanted || names.includes(wanted)) return entry;
  }
  for (const entry of terms) {
    if (entry.kind !== 'term') continue;
    const name = plain(entry.term);
    if (name === wanted) return entry;
    if (name.split(' ').length === wordCount && titleNamesWords(entry.term, selection)) {
      return entry;
    }
  }
  return undefined;
}
