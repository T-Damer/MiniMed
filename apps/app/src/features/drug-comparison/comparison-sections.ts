/**
 * Which sections of an official instruction «Сравнение препаратов» quotes, and how they are read
 * from the installed document (CMP1). The rows are declared here as data: a row names the section
 * TYPES (the typed sections of the instruction modules) it collects; the screen, the print and the
 * benchmark read this list and never branch on a drug or a row id.
 *
 * Every part of a row is one section of the document, quoted without change; its units are
 * sentences and list items (`comparison-units.ts`) with the anchor of the chunk they start in.
 */
import type { MedicalDocument, MedicalSection } from '@localmed/contracts';

import {
  canonicalSectionText,
  chunkIndexAt,
  spanDisplayText,
} from '@/features/drug-interactions/interaction-text';
import { titlePrefixLength } from '@/features/medication-safety/safety-extract';
import { MAX_UNITS_PER_COLUMN, type MatchUnit, unitTokens } from './comparison-match';
import { splitComparisonItems } from './comparison-units';

export interface SectionRowSpec {
  readonly id: string;
  readonly title: string;
  /** Section types of the instruction modules that belong to the row, in this order of reading. */
  readonly types: readonly string[];
}

/** The quoted rows, in the order the owner asked for them (2026-10-06). */
export const SECTION_ROWS: readonly SectionRowSpec[] = [
  { id: 'indications', title: 'Показания', types: ['indications'] },
  { id: 'contraindications', title: 'Противопоказания', types: ['contraindications'] },
  { id: 'dosage', title: 'Способ применения и дозы', types: ['dosage'] },
  { id: 'adverse', title: 'Побочное действие', types: ['adverse-effects'] },
  {
    id: 'special',
    title: 'Особые указания и «С осторожностью»',
    types: ['special-instructions', 'caution'],
  },
  { id: 'overdose', title: 'Передозировка', types: ['overdose'] },
];

/** Short quoted lines that are not compared sentence by sentence. */
export interface QuoteRowSpec {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  /** Only sections whose title matches (the «Фармакотерапевтическая группа» line). */
  readonly titlePattern?: RegExp;
}

export const QUOTE_ROWS: readonly QuoteRowSpec[] = [
  {
    id: 'group',
    title: 'Фармакотерапевтическая группа (из инструкции)',
    type: 'pharmacology',
    titlePattern: /фармако(?:терапевтическ|логическ)\p{L}*\s+групп/iu,
  },
  { id: 'dispensing', title: 'Условия отпуска (из инструкции)', type: 'dispensing' },
];

export interface SectionPart {
  readonly sectionId: string;
  readonly title: string;
  /** Anchor of the section's first chunk, for «Открыть в инструкции». */
  readonly anchor: string | null;
  readonly text: string;
}

export interface SectionUnit extends MatchUnit {
  readonly key: string;
  /** Anchor of the chunk the unit starts in. */
  readonly anchor: string | null;
  /** Index into the row's `parts`. */
  readonly part: number;
}

export interface ExtractedRow {
  readonly id: string;
  readonly parts: readonly SectionPart[];
  readonly units: readonly SectionUnit[];
  /** Units beyond `MAX_UNITS_PER_COLUMN` that were not compared. */
  readonly cut: number;
  /** Anchor to open the instruction at: the first part's. */
  readonly anchor: string | null;
}

function orderedChunks(section: MedicalSection): readonly MedicalSection['chunks'][number][] {
  return section.chunks
    .filter((chunk) => chunk.originalText.trim() !== '')
    .toSorted((left, right) => left.orderIndex - right.orderIndex);
}

function sectionsOfTypes(
  document: MedicalDocument,
  types: readonly string[],
): readonly MedicalSection[] {
  return document.sections
    .filter((section) => section.sectionType !== null && types.includes(section.sectionType))
    .toSorted((left, right) => left.orderIndex - right.orderIndex);
}

function textKey(text: string): string {
  return text.replace(/[\s\p{P}]+/gu, '').toLocaleLowerCase('ru-RU');
}

export function extractRow(document: MedicalDocument, spec: SectionRowSpec): ExtractedRow {
  const parts: SectionPart[] = [];
  const units: SectionUnit[] = [];
  const seen = new Set<string>();
  let cut = 0;
  for (const section of sectionsOfTypes(document, spec.types)) {
    const chunks = orderedChunks(section);
    if (chunks.length === 0) continue;
    const canonical = canonicalSectionText(chunks.map((chunk) => chunk.originalText));
    // The same text printed twice (a heading section that repeats its child) is quoted once.
    const key = textKey(canonical.text);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    const part = parts.length;
    parts.push({
      sectionId: section.id,
      title: section.title,
      anchor: chunks[0]?.anchor ?? null,
      text: canonical.text,
    });
    for (const span of splitComparisonItems(canonical.text, section.title)) {
      if (units.length >= MAX_UNITS_PER_COLUMN) {
        cut += 1;
        continue;
      }
      const text = spanDisplayText(canonical.text, span);
      units.push({
        key: `${section.id}:${span.start}`,
        text,
        tokens: unitTokens(text),
        anchor: chunks[chunkIndexAt(canonical.chunkStarts, span.start)]?.anchor ?? null,
        part,
      });
    }
  }
  return { id: spec.id, parts, units, cut, anchor: parts[0]?.anchor ?? null };
}

/** All quoted rows of an instruction, by row id. */
export function extractRows(document: MedicalDocument): ReadonlyMap<string, ExtractedRow> {
  return new Map(SECTION_ROWS.map((spec) => [spec.id, extractRow(document, spec)]));
}

export interface QuoteBlock {
  readonly id: string;
  /** The lines of the section as the instruction prints them, whitespace collapsed. */
  readonly text: string;
  readonly anchor: string | null;
  readonly sectionTitle: string;
}

/** A short section quoted whole (the pharmacotherapeutic group line, the dispensing condition). */
export function extractQuoteBlock(
  document: MedicalDocument,
  spec: QuoteRowSpec,
): QuoteBlock | null {
  for (const section of sectionsOfTypes(document, [spec.type])) {
    if (spec.titlePattern && !spec.titlePattern.test(section.title)) continue;
    const chunks = orderedChunks(section);
    if (chunks.length === 0) continue;
    const canonical = canonicalSectionText(chunks.map((chunk) => chunk.originalText));
    const skip = titlePrefixLength(canonical.text, section.title);
    const text = spanDisplayText(canonical.text, { start: skip, end: canonical.text.length });
    const withoutDashes = text.replace(/^[\s.:–—-]+/u, '');
    if (withoutDashes === '') continue;
    return {
      id: spec.id,
      text: withoutDashes,
      anchor: chunks[0]?.anchor ?? null,
      sectionTitle: section.title,
    };
  }
  return null;
}

/** The section types an instruction needs to count as a complete source for every quoted row. */
export function rowTypesPresent(document: MedicalDocument): ReadonlySet<string> {
  const present = new Set<string>();
  for (const section of document.sections) {
    if (section.sectionType !== null && orderedChunks(section).length > 0) {
      present.add(section.sectionType);
    }
  }
  return present;
}
