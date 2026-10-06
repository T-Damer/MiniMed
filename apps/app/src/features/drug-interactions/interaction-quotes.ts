/**
 * Reads the sentences the index points at from an installed instruction (INT1). The index holds
 * offsets only; the text is the instruction's own, quoted without change, and every quote carries
 * the anchor of the chunk it starts in so the reader can open at that place. A section whose text
 * is not the text the index was built from (another edition) is reported, never guessed at.
 */
import type { MedicalDocument, MedicalSection } from '@localmed/contracts';
import {
  SPAN_FLAG_CAUTION,
  SPAN_FLAG_CONTRAINDICATIONS,
  SPAN_FLAG_INTERACTIONS,
  SPAN_FLAG_LEAFLET_BODY,
  SPAN_FLAG_SPECIAL,
} from './interaction-extract';
import { type IndexedSentence, SECTION_CHECKSUM_LENGTH } from './interaction-index';
import {
  canonicalSectionText,
  chunkIndexAt,
  sectionChecksum,
  spanDisplayText,
} from './interaction-text';
import type { TextSegment } from './mention-highlight';

export interface Quote {
  readonly key: string;
  readonly text: string;
  readonly segments: readonly TextSegment[];
  /** Anchor of the chunk the sentence starts in, for the reader. */
  readonly anchor: string | null;
  readonly flags: number;
  readonly sectionTitle: string;
}

export interface ResolvedSentences {
  readonly quotes: readonly Quote[];
  /** Sentences whose section is not the text the index was built from. */
  readonly changed: number;
}

/** «Взаимодействие», «Особые указания»: where in the instruction a quoted sentence stands. */
export function sentenceSectionLabel(flags: number): string {
  if (flags & SPAN_FLAG_INTERACTIONS) return 'Взаимодействие с другими лекарственными средствами';
  if (flags & SPAN_FLAG_CONTRAINDICATIONS) return 'Противопоказания';
  if (flags & SPAN_FLAG_SPECIAL) return 'Особые указания';
  if (flags & SPAN_FLAG_CAUTION) return 'С осторожностью';
  if (flags & SPAN_FLAG_LEAFLET_BODY) return 'Листок-вкладыш: общие разделы';
  return 'Инструкция';
}

/** Interaction section first, then warnings, then the leaflet's general text. */
export function sentenceSectionRank(flags: number): number {
  if (flags & SPAN_FLAG_INTERACTIONS) return 0;
  if (flags & SPAN_FLAG_CONTRAINDICATIONS) return 1;
  if (flags & SPAN_FLAG_SPECIAL) return 2;
  if (flags & SPAN_FLAG_CAUTION) return 3;
  return 4;
}

function sectionChunks(section: MedicalSection): readonly MedicalSection['chunks'][number][] {
  return section.chunks.toSorted((left, right) => left.orderIndex - right.orderIndex);
}

export function resolveQuotes(
  document: MedicalDocument,
  sentences: readonly IndexedSentence[],
  highlight: (text: string) => readonly TextSegment[],
): ResolvedSentences {
  const sections = new Map(document.sections.map((section) => [section.id, section]));
  const canonical = new Map<
    string,
    {
      text: string;
      chunkStarts: readonly number[];
      chunks: readonly { anchor: string }[];
      valid: boolean;
    }
  >();
  const quotes: Quote[] = [];
  let changed = 0;
  for (const sentence of sentences) {
    const [sectionId, checksum] = sentence.section;
    let entry = canonical.get(sectionId);
    if (!entry) {
      const section = sections.get(sectionId);
      if (!section) {
        canonical.set(sectionId, { text: '', chunkStarts: [], chunks: [], valid: false });
        entry = canonical.get(sectionId);
      } else {
        const chunks = sectionChunks(section);
        const built = canonicalSectionText(chunks.map((chunk) => chunk.originalText));
        entry = {
          text: built.text,
          chunkStarts: built.chunkStarts,
          chunks,
          valid: sectionChecksum(built.text).startsWith(checksum.slice(0, SECTION_CHECKSUM_LENGTH)),
        };
        canonical.set(sectionId, entry);
      }
    }
    if (!entry?.valid || sentence.end > entry.text.length) {
      changed += 1;
      continue;
    }
    const text = spanDisplayText(entry.text, sentence);
    const chunk = entry.chunks[chunkIndexAt(entry.chunkStarts, sentence.start)];
    quotes.push({
      key: `${sectionId}:${sentence.start}`,
      text,
      segments: highlight(text),
      anchor: chunk?.anchor ?? null,
      flags: sentence.flags,
      sectionTitle: sections.get(sectionId)?.title ?? '',
    });
  }
  // A stable sort: inside one rank the sentences stay in reading order.
  quotes.sort((left, right) => sentenceSectionRank(left.flags) - sentenceSectionRank(right.flags));
  return { quotes, changed };
}
