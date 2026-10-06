/**
 * The same extraction as the build, run on ONE installed instruction document (SAFE1): what the
 * drug screen shows for the instruction in front of the doctor, whether or not the search index
 * keeps that registration (the index keeps one instruction per dosage form). No offsets are stored
 * anywhere; the sentences are found in the text that is open.
 */
import type { MedicalDocument } from '@localmed/contracts';

import {
  INSTRUCTION_KINDS,
  SECTION_ID_PREFIX,
} from '@/features/drug-interactions/interaction-index';
import { extractSafety } from './safety-extract';
import {
  createSafetyIndex,
  SAFETY_INDEX_SCHEMA_VERSION,
  type SafetyIndex,
  type SafetyIndexAsset,
} from './safety-index';
import { sectionOfMetadata, textOf } from './safety-metadata';
import type { SafetyCandidate } from './safety-view';

export const DOCUMENT_CARD_SLUG = 'document';

export interface DocumentSafety {
  readonly index: SafetyIndex;
  readonly candidate: SafetyCandidate;
}

/** The safety index of one document, or null when it is not an instruction with text to read. */
export function safetyOfDocument(document: MedicalDocument): DocumentSafety | null {
  if (document.sourceType !== 'official_drug_instruction') return null;
  if (document.sections.some((section) => !section.id.startsWith(SECTION_ID_PREFIX))) return null;
  const extracted = extractSafety(
    document.sections.map((section) => ({
      id: section.id,
      type: section.sectionType,
      title: section.title,
      chunks: section.chunks
        .toSorted((left, right) => left.orderIndex - right.orderIndex)
        .map((chunk) => chunk.originalText),
    })),
  );
  const kind = INSTRUCTION_KINDS.indexOf(
    (textOf(document.metadata['documentKind']) ?? 'unknown') as (typeof INSTRUCTION_KINDS)[number],
  );
  const asset: SafetyIndexAsset = {
    schemaVersion: SAFETY_INDEX_SCHEMA_VERSION,
    basis: { modules: [] },
    modules: ['installed'],
    cards: [DOCUMENT_CARD_SLUG],
    documents: {
      [document.id]: {
        c: [0],
        m: 0,
        t: textOf(document.metadata['tradeName']),
        k: kind < 0 ? INSTRUCTION_KINDS.indexOf('unknown') : kind,
        s: sectionOfMetadata(document.metadata),
        f: textOf(document.metadata['dosageForm']),
        p: extracted.hasPregnancySection ? 1 : 0,
        a: extracted.ag.length > 0 ? 1 : 0,
        n: 1,
        sec: extracted.sections.map((entry) => [
          entry.id.slice(SECTION_ID_PREFIX.length),
          entry.checksum.slice(0, 4),
        ]),
        pl: extracted.pl,
        ag: extracted.ag,
      },
    },
  };
  return {
    index: createSafetyIndex(asset),
    candidate: {
      slug: DOCUMENT_CARD_SLUG,
      card: 0,
      label: document.title,
      ownDocumentId: document.id,
    },
  };
}
