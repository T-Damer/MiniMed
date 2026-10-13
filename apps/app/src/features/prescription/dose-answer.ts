/**
 * The answer to a dose question outside any screen (RX1): the query's drug is found with the app's
 * own medication search, its instruction is read from the core, and the item of the prescription
 * tool is analysed for the patient the query describes. The search card runs the same analysis with
 * signals; the benchmark runs this function on the real corpus, so the numbers it checks are the
 * numbers the card shows.
 */
import type { MedicalCore, PrescriptionPatient } from '@localmed/contracts';

import { type DoseCandidate, findDoseCandidates } from './dose-candidates';
import { resolveInstruction } from './dose-document';
import type { DoseIndex } from './dose-index';
import type { DoseQuery } from './dose-query';
import { NO_CARD_FACTS, type PrescriptionFacts, patientFactsOf } from './prescription-facts';
import {
  analyzeItem,
  applyQueryChoices,
  documentIdsToRead,
  type InstructionState,
  type ItemAnalysis,
  newItem,
  type PrescriptionItem,
} from './prescription-model';

export interface DoseAnswer {
  readonly candidate: DoseCandidate;
  readonly item: PrescriptionItem;
  readonly facts: PrescriptionFacts;
  readonly analysis: ItemAnalysis;
}

/** The patient a query describes, as the tool's draft holds it. */
export function patientOfQuery(query: DoseQuery): PrescriptionPatient {
  return {
    ageDays: query.ageDays,
    group: query.group,
    weightKg: query.weightKg,
    heightCm: null,
    pregnant: query.pregnant,
    lactating: query.lactating,
  };
}

/** The item a query starts: the drug, the form and strength it names, the course it asks for. */
export function itemOfQuery(
  index: DoseIndex,
  candidate: Pick<DoseCandidate, 'slug' | 'label'>,
  query: DoseQuery,
): PrescriptionItem {
  const item = {
    ...newItem(`query-${candidate.slug}`, candidate.slug, candidate.label),
    ...(query.days === null ? {} : { days: query.days }),
  };
  return applyQueryChoices(item, index, {
    formWord: query.form ?? undefined,
    strengthMg: query.strengthMg ?? undefined,
  });
}

export async function answerDoseQuery(
  core: MedicalCore,
  index: DoseIndex,
  query: DoseQuery,
): Promise<DoseAnswer | null> {
  const [candidate] = await findDoseCandidates(core, index, query.name, { limit: 1, strict: true });
  if (!candidate) return null;
  const item = itemOfQuery(index, candidate, query);
  const facts = patientFactsOf(patientOfQuery(query), NO_CARD_FACTS);
  const states = new Map<string, InstructionState>();
  for (const documentId of documentIdsToRead(item, index)) {
    const read = await core.getDocument(documentId);
    states.set(
      documentId,
      read.ok ? resolveInstruction(read.value, index.asset.documents[documentId]) : 'missing',
    );
  }
  const analysis = analyzeItem(item, {
    index,
    patient: facts,
    instructionOf: (id) => states.get(id),
  });
  return { candidate, item, facts, analysis };
}
