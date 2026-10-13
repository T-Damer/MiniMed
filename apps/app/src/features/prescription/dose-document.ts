/**
 * Reads the dose rules of one installed instruction and attaches the sentence each was read from
 * (RX1). The build-time index holds offsets and a checksum of every section; when the installed text
 * is the text the index was built from, its rules are used with their sentences cut out by those
 * offsets. When the checksum differs (another edition), or the index does not know the document, the
 * same parsers run on the installed text, so a rule always points at a sentence that is really there.
 */
import type {
  DoseRule,
  DoseRuleDocument,
  MedicalDocument,
  MedicalSection,
} from '@localmed/contracts';
import { SECTION_ID_PREFIX } from '@/features/drug-interactions/interaction-index';
import {
  canonicalSectionText,
  sectionChecksum,
} from '@/features/drug-interactions/interaction-text';
import {
  type InstructionSourceInfo,
  instructionSourceInfo,
} from '@/features/medications/instruction-source';
import { extractDoseRules } from './dose-parse';

export interface ResolvedRule {
  readonly rule: DoseRule;
  /** The sentence as printed (whitespace collapsed), never rewritten. */
  readonly quote: string;
  /** The heading or earlier sentence the population or condition was taken from. */
  readonly context: string | null;
  readonly sectionTitle: string;
  /** Anchor of the chunk the sentence starts in, to open the instruction there. */
  readonly anchor: string | null;
}

export interface DosageSectionRef {
  readonly id: string;
  readonly title: string;
  readonly anchor: string;
  /** The section as printed (paragraphs separated by a blank line), cut at `SECTION_TEXT_LIMIT`. */
  readonly text: string;
  readonly cut: boolean;
}

/** Characters of a dosage section shown when no rule could be read from it. */
export const SECTION_TEXT_LIMIT = 3500;

export interface ResolvedInstruction {
  readonly documentId: string;
  readonly tradeName: string | null;
  readonly dosageForm: string | null;
  readonly info: InstructionSourceInfo | null;
  readonly rules: readonly ResolvedRule[];
  /** The instruction says a tablet may be divided. */
  readonly divisible: boolean;
  /** `index`: the build-time rules were used; `text`: read from the installed text. */
  readonly origin: 'index' | 'text';
  /** The dosage sections of the instruction, to show or link when no rule fits. */
  readonly sections: readonly DosageSectionRef[];
}

const DOSE_TITLE =
  /способ|режим дозиров|дозиров|рекомендуем\p{L}* доз|прием препарата|приём препарата|применение препарата|как принимать/iu;

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function orderedChunks(section: MedicalSection): readonly string[] {
  return section.chunks.toSorted((a, b) => a.orderIndex - b.orderIndex).map((c) => c.originalText);
}

function isDoseSection(section: MedicalSection): boolean {
  if (section.sectionType === 'dosage') return true;
  return (
    (section.sectionType === 'other' || section.sectionType === 'treatment') &&
    DOSE_TITLE.test(section.title) &&
    section.title.length < 80
  );
}

export function dosageSectionsOf(document: MedicalDocument): readonly DosageSectionRef[] {
  return document.sections.filter(isDoseSection).map((section) => {
    const full = orderedChunks(section).join('\n\n');
    const cut = full.length > SECTION_TEXT_LIMIT;
    return {
      id: section.id,
      title: section.title,
      anchor: section.anchor,
      text: cut ? full.slice(0, SECTION_TEXT_LIMIT) : full,
      cut,
    };
  });
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** True when every section the index points at has the text the index was built from. */
function indexMatches(document: MedicalDocument, entry: DoseRuleDocument): boolean {
  const sections = new Map(document.sections.map((section) => [section.id, section]));
  return entry.sec.every(([id, checksum]) => {
    const section = sections.get(`${SECTION_ID_PREFIX}${id}`);
    if (!section) return false;
    return sectionChecksum(canonicalSectionText(orderedChunks(section)).text) === checksum;
  });
}

export function resolveInstruction(
  document: MedicalDocument,
  entry: DoseRuleDocument | undefined,
): ResolvedInstruction {
  const usable = entry !== undefined && indexMatches(document, entry);
  let sectionIds: readonly string[];
  let rules: readonly DoseRule[];
  let divisible: boolean;
  if (usable && entry) {
    sectionIds = entry.sec.map(([id]) => `${SECTION_ID_PREFIX}${id}`);
    rules = entry.rules;
    divisible = entry.v === 1;
  } else {
    const extracted = extractDoseRules(
      document.sections.map((section) => ({
        id: section.id,
        type: section.sectionType,
        title: section.title,
        chunks: orderedChunks(section),
      })),
      { subject: [textOf(document.metadata['inn']), textOf(document.metadata['tradeName'])] },
    );
    sectionIds = extracted.sections.map((section) => section.id);
    rules = extracted.rules;
    divisible = extracted.divisible;
  }
  const sections = new Map(document.sections.map((section) => [section.id, section]));
  const canonical = new Map<
    string,
    { text: string; starts: readonly number[]; chunks: MedicalSection['chunks'] }
  >();
  const canonicalOf = (id: string) => {
    let found = canonical.get(id);
    if (!found) {
      const section = sections.get(id);
      if (!section) return undefined;
      const ordered = section.chunks.toSorted((a, b) => a.orderIndex - b.orderIndex);
      const built = canonicalSectionText(ordered.map((chunk) => chunk.originalText));
      found = { text: built.text, starts: built.chunkStarts, chunks: ordered };
      canonical.set(id, found);
    }
    return found;
  };
  const resolved: ResolvedRule[] = [];
  for (const rule of rules) {
    const id = sectionIds[rule.s];
    const read = id === undefined ? undefined : canonicalOf(id);
    if (!read || rule.b > read.text.length) continue;
    let chunkAt = 0;
    for (let index = 0; index < read.starts.length; index += 1) {
      if ((read.starts[index] ?? 0) <= rule.a) chunkAt = index;
    }
    resolved.push({
      rule,
      quote: collapse(read.text.slice(rule.a, rule.b)),
      context: rule.h ? collapse(read.text.slice(rule.h[0], rule.h[1])) : null,
      sectionTitle: id === undefined ? '' : (sections.get(id)?.title ?? ''),
      anchor: read.chunks[chunkAt]?.anchor ?? null,
    });
  }
  return {
    documentId: document.id,
    tradeName: textOf(document.metadata['tradeName']),
    dosageForm: textOf(document.metadata['dosageForm']),
    info: instructionSourceInfo(document),
    rules: resolved,
    divisible,
    origin: usable ? 'index' : 'text',
    sections: dosageSectionsOf(document),
  };
}
