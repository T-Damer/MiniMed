import type {
  InteractionAssertion,
  InteractionPairResult,
  MedicationConcept,
  MedicationInteractionCheckResult,
  MedicationInteractionKnowledgeBase,
} from '@/features/interactions/interaction-types';

const MAX_MEDICATIONS = 20;

const CONCLUSION_PRIORITY: Readonly<Record<InteractionPairResult['conclusion'], number>> = {
  contraindicated: 100,
  avoid: 90,
  'management-required': 80,
  monitor: 70,
  'separate-administration': 60,
  'potential-mechanistic-interaction': 50,
  'conflicting-evidence': 45,
  'documented-minor': 30,
  'documented-no-significant-interaction': 10,
  unknown: 0,
};

export function normalizeMedicationName(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[()[\]{}]/gu, ' ')
    .replace(/[.,:!?"'«»]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function aliasIndex(
  knowledge: MedicationInteractionKnowledgeBase,
): ReadonlyMap<string, MedicationConcept> {
  const index = new Map<string, MedicationConcept>();
  for (const medication of knowledge.medications) {
    for (const name of [medication.preferredName, ...medication.aliases]) {
      const normalized = normalizeMedicationName(name);
      if (normalized) index.set(normalized, medication);
    }
  }
  return index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function candidateOffset(value: string, candidate: string): number {
  const exactPattern = new RegExp(`(?:^|\\s)${escapeRegExp(candidate)}(?=\\s|$)`, 'u');
  const exact = exactPattern.exec(value);
  if (exact?.index !== undefined) return exact.index;
  if (!/^[а-я]+$/u.test(candidate)) return -1;
  const inflectedPattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(candidate)}[а-я]{1,5}(?=\\s|$)`,
    'u',
  );
  return inflectedPattern.exec(value)?.index ?? -1;
}

export function resolveMedication(
  input: string,
  knowledge: MedicationInteractionKnowledgeBase,
): MedicationConcept | undefined {
  const normalized = normalizeMedicationName(input);
  if (!normalized) return undefined;
  const exact = aliasIndex(knowledge).get(normalized);
  if (exact) return exact;
  if (normalized.includes(' ')) return undefined;

  return knowledge.medications.find((medication) =>
    [medication.preferredName, ...medication.aliases]
      .map((name) => normalizeMedicationName(name))
      .some((candidate) => candidateOffset(normalized, candidate) === 0),
  );
}

export function extractMedicationNames(
  value: string,
  knowledge: MedicationInteractionKnowledgeBase,
): readonly string[] {
  const directParts = value
    .split(/[,;\n+]|\s+и\s+/giu)
    .map((part) => part.trim())
    .filter(Boolean);
  const directlyResolved = directParts.filter((part) => resolveMedication(part, knowledge));
  if (directlyResolved.length >= 2) return directlyResolved;

  const normalizedValue = normalizeMedicationName(value);
  const matches: Array<{ readonly input: string; readonly offset: number }> = [];
  const seen = new Set<string>();
  for (const medication of knowledge.medications) {
    const candidates = [medication.preferredName, ...medication.aliases]
      .map((name) => normalizeMedicationName(name))
      .filter((name) => name.length >= 4)
      .toSorted((left, right) => right.length - left.length);
    const match = candidates
      .map((candidate) => ({ candidate, offset: candidateOffset(normalizedValue, candidate) }))
      .filter((item) => item.offset >= 0)
      .toSorted((left, right) => left.offset - right.offset)[0];
    if (!match || seen.has(medication.id)) continue;
    seen.add(medication.id);
    matches.push({ input: medication.preferredName, offset: match.offset });
  }
  return matches.toSorted((left, right) => left.offset - right.offset).map((item) => item.input);
}

function targetMatches(assertion: InteractionAssertion, medication: MedicationConcept): boolean {
  if (assertion.interactant.kind === 'medication') {
    return assertion.interactant.id === medication.id;
  }
  return medication.classes.includes(assertion.interactant.id);
}

function assertionMatchesPair(
  assertion: InteractionAssertion,
  left: MedicationConcept,
  right: MedicationConcept,
): boolean {
  return (
    (assertion.subjectMedicationId === left.id && targetMatches(assertion, right)) ||
    (assertion.subjectMedicationId === right.id && targetMatches(assertion, left))
  );
}

function resultFromAssertion(
  left: MedicationConcept,
  right: MedicationConcept,
  assertion: InteractionAssertion,
  knowledge: MedicationInteractionKnowledgeBase,
): InteractionPairResult {
  const evidenceIds = new Set(assertion.evidenceIds);
  return {
    left,
    right,
    conclusion: assertion.conclusion,
    severity: assertion.severity,
    certainty: assertion.certainty,
    interactionType: assertion.interactionType,
    mechanism: assertion.mechanism,
    effect: assertion.effect,
    recommendation: assertion.recommendation,
    assertionId: assertion.id,
    evidence: knowledge.evidence.filter((item) => evidenceIds.has(item.id)),
  };
}

function unknownResult(
  left: MedicationConcept,
  right: MedicationConcept,
): InteractionPairResult {
  return {
    left,
    right,
    conclusion: 'unknown',
    severity: 'unknown',
    recommendation:
      'В подключённой проверенной базе нет утверждения для этой пары. Это не подтверждает отсутствие взаимодействия.',
    evidence: [],
  };
}

export function checkMedicationInteractions(
  inputs: readonly string[],
  knowledge: MedicationInteractionKnowledgeBase,
): MedicationInteractionCheckResult {
  const resolved: MedicationInteractionCheckResult['resolved'][number][] = [];
  const unresolved: MedicationInteractionCheckResult['unresolved'][number][] = [];
  const duplicateInputs: string[] = [];
  const seenConceptIds = new Set<string>();
  const boundedInputs = inputs.map((input) => input.trim()).filter(Boolean).slice(0, MAX_MEDICATIONS);

  for (const input of boundedInputs) {
    const concept = resolveMedication(input, knowledge);
    if (!concept) {
      unresolved.push({ input });
      continue;
    }
    if (seenConceptIds.has(concept.id)) {
      duplicateInputs.push(input);
      continue;
    }
    seenConceptIds.add(concept.id);
    resolved.push({ input, concept });
  }

  const pairs: InteractionPairResult[] = [];
  for (let leftIndex = 0; leftIndex < resolved.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < resolved.length; rightIndex += 1) {
      const left = resolved[leftIndex]?.concept;
      const right = resolved[rightIndex]?.concept;
      if (!left || !right) continue;
      const assertions = knowledge.assertions
        .filter((assertion) => assertionMatchesPair(assertion, left, right))
        .toSorted(
          (first, second) =>
            CONCLUSION_PRIORITY[second.conclusion] - CONCLUSION_PRIORITY[first.conclusion],
        );
      const assertion = assertions[0];
      pairs.push(
        assertion
          ? resultFromAssertion(left, right, assertion, knowledge)
          : unknownResult(left, right),
      );
    }
  }

  return {
    resolved,
    unresolved,
    duplicateInputs,
    pairs,
    truncated: inputs.filter((input) => input.trim()).length > MAX_MEDICATIONS,
  };
}
