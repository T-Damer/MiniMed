import type { SearchResultGroup } from '@localmed/contracts';
import type { SearchDocumentDescriptor } from '@localmed/storage';

import { documentIcdCodes, isRecommendationDocument } from './icd-bridge';

const SYMPTOM_ENTITY_TYPES = new Set(['symptom', 'syndrome']);

/**
 * A document that is about a symptom or a syndrome, read from its declared data: the entity type of
 * a reference record, or МКБ-10 codes that all sit in chapter R («Симптомы, признаки и отклонения
 * от нормы»).
 */
export function isSymptomLevelDocument(document: SearchDocumentDescriptor): boolean {
  if (SYMPTOM_ENTITY_TYPES.has(String(document.metadata['entityType']))) return true;
  const codes = documentIcdCodes(document);
  return codes.length > 0 && codes.every((code) => code.startsWith('R'));
}

/**
 * A list of complaints («болит живот рвота») asks for the symptom or syndrome, not for the diseases
 * whose texts mention the words: among the groups that are not clinical recommendations,
 * symptom-level documents go first, each side keeping its order. A recommendation keeps its slot —
 * the guideline for the complaint is an answer of its own («понос или рвота у ребенка»).
 */
export function prioritizeSymptomLevelGroups(
  groups: readonly SearchResultGroup[],
  documents: ReadonlyMap<string, SearchDocumentDescriptor>,
): readonly SearchResultGroup[] {
  const slots: number[] = [];
  const symptomLevel: SearchResultGroup[] = [];
  const others: SearchResultGroup[] = [];
  groups.forEach((group, index) => {
    const document = documents.get(group.documentId);
    if (document && isRecommendationDocument(document)) return;
    slots.push(index);
    (document && isSymptomLevelDocument(document) ? symptomLevel : others).push(group);
  });
  if (symptomLevel.length === 0 || others.length === 0) return groups;
  const reordered = [...symptomLevel, ...others];
  const result = [...groups];
  slots.forEach((slot, position) => {
    const group = reordered[position];
    if (group) result[slot] = group;
  });
  return result;
}
