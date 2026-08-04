import type {
  InteractionAssertion,
  InteractionEvidence,
  InteractionPairResult,
  InteractionParticipant,
  MedicationConcept,
  MedicationInteractionCheckResult,
  MedicationInteractionKnowledgeBase,
} from '@/features/interactions/interaction-types';

const MAX_MEDICATIONS = 20;
const REVIEW_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const validatedKnowledge = new WeakSet<object>();
const aliasIndexes = new WeakMap<object, ReadonlyMap<string, MedicationConcept>>();

export function normalizeMedicationName(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[()[\]{}]/gu, ' ')
    .replace(/[.,:!?"'«»]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function requireText(value: string, path: string): void {
  if (!value.trim()) throw new Error(`Medication interaction catalog: ${path} must not be empty.`);
}

function isValidReviewDate(value: string): boolean {
  if (!REVIEW_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function addUniqueId(ids: Set<string>, id: string, path: string): void {
  requireText(id, path);
  if (ids.has(id)) throw new Error(`Medication interaction catalog: duplicate ${path} “${id}”.`);
  ids.add(id);
}

export function validateMedicationInteractionKnowledge(
  knowledge: MedicationInteractionKnowledgeBase,
): void {
  if (knowledge.schemaVersion !== 1) {
    throw new Error('Medication interaction catalog: unsupported schema version.');
  }

  const classIds = new Set<string>();
  for (const medicationClass of knowledge.classes) {
    addUniqueId(classIds, medicationClass.id, 'class ID');
    requireText(medicationClass.title, `class ${medicationClass.id} title`);
  }

  const medicationIds = new Set<string>();
  const aliasOwners = new Map<string, string>();
  for (const medication of knowledge.medications) {
    addUniqueId(medicationIds, medication.id, 'medication ID');
    requireText(medication.preferredName, `medication ${medication.id} preferredName`);
    for (const classId of medication.classes) {
      if (!classIds.has(classId)) {
        throw new Error(
          `Medication interaction catalog: medication ${medication.id} references unknown class ${classId}.`,
        );
      }
    }
    for (const name of [medication.preferredName, ...medication.aliases]) {
      const normalized = normalizeMedicationName(name);
      requireText(normalized, `medication ${medication.id} alias`);
      const owner = aliasOwners.get(normalized);
      if (owner && owner !== medication.id) {
        throw new Error(
          `Medication interaction catalog: alias “${normalized}” belongs to both ${owner} and ${medication.id}.`,
        );
      }
      aliasOwners.set(normalized, medication.id);
    }
  }

  const evidenceIds = new Set<string>();
  for (const evidence of knowledge.evidence) {
    addUniqueId(evidenceIds, evidence.id, 'evidence ID');
    requireText(evidence.sourceTitle, `evidence ${evidence.id} sourceTitle`);
    requireText(evidence.issuer, `evidence ${evidence.id} issuer`);
    requireText(evidence.jurisdiction, `evidence ${evidence.id} jurisdiction`);
    requireText(evidence.sourceVersion, `evidence ${evidence.id} sourceVersion`);
    requireText(evidence.quote, `evidence ${evidence.id} quote`);
    if (!isValidReviewDate(evidence.reviewedAt)) {
      throw new Error(
        `Medication interaction catalog: evidence ${evidence.id} has invalid reviewedAt.`,
      );
    }
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(evidence.sourceUrl);
    } catch {
      throw new Error(
        `Medication interaction catalog: evidence ${evidence.id} has an invalid source URL.`,
      );
    }
    if (sourceUrl.protocol !== 'https:') {
      throw new Error(
        `Medication interaction catalog: evidence ${evidence.id} must use an HTTPS source URL.`,
      );
    }
  }

  const assertionIds = new Set<string>();
  const assertionTargets = new Set<string>();
  for (const assertion of knowledge.assertions) {
    addUniqueId(assertionIds, assertion.id, 'assertion ID');
    if (!medicationIds.has(assertion.subjectMedicationId)) {
      throw new Error(
        `Medication interaction catalog: assertion ${assertion.id} references unknown subject medication.`,
      );
    }
    const targetIds = assertion.interactant.kind === 'medication' ? medicationIds : classIds;
    if (!targetIds.has(assertion.interactant.id)) {
      throw new Error(
        `Medication interaction catalog: assertion ${assertion.id} references an unknown target.`,
      );
    }
    if (
      assertion.interactant.kind === 'medication' &&
      assertion.interactant.id === assertion.subjectMedicationId
    ) {
      throw new Error(
        `Medication interaction catalog: assertion ${assertion.id} cannot target the same medication.`,
      );
    }
    const targetKey = `${assertion.subjectMedicationId}|${assertion.interactant.kind}|${assertion.interactant.id}`;
    if (assertionTargets.has(targetKey)) {
      throw new Error(
        `Medication interaction catalog: duplicate reviewed assertion target ${targetKey}.`,
      );
    }
    assertionTargets.add(targetKey);
    if (assertion.reviewStatus !== 'reviewed' || !isValidReviewDate(assertion.reviewedAt)) {
      throw new Error(
        `Medication interaction catalog: assertion ${assertion.id} is not validly reviewed.`,
      );
    }
    requireText(assertion.mechanism, `assertion ${assertion.id} mechanism`);
    requireText(assertion.effect, `assertion ${assertion.id} effect`);
    requireText(assertion.recommendation, `assertion ${assertion.id} recommendation`);
    if (assertion.evidenceIds.length === 0) {
      throw new Error(`Medication interaction catalog: assertion ${assertion.id} has no evidence.`);
    }
    for (const evidenceId of assertion.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(
          `Medication interaction catalog: assertion ${assertion.id} references unknown evidence ${evidenceId}.`,
        );
      }
    }
  }
}

function ensureValidated(knowledge: MedicationInteractionKnowledgeBase): void {
  if (validatedKnowledge.has(knowledge)) return;
  validateMedicationInteractionKnowledge(knowledge);
  validatedKnowledge.add(knowledge);
}

function aliasIndex(
  knowledge: MedicationInteractionKnowledgeBase,
): ReadonlyMap<string, MedicationConcept> {
  const cached = aliasIndexes.get(knowledge);
  if (cached) return cached;
  const index = new Map<string, MedicationConcept>();
  for (const medication of knowledge.medications) {
    for (const name of [medication.preferredName, ...medication.aliases]) {
      index.set(normalizeMedicationName(name), medication);
    }
  }
  aliasIndexes.set(knowledge, index);
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
  ensureValidated(knowledge);
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
  ensureValidated(knowledge);
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

function evidenceForAssertions(
  assertions: readonly InteractionAssertion[],
  knowledge: MedicationInteractionKnowledgeBase,
): readonly InteractionEvidence[] {
  const evidenceById = new Map(knowledge.evidence.map((evidence) => [evidence.id, evidence]));
  const seen = new Set<string>();
  const evidence: InteractionEvidence[] = [];
  for (const assertion of assertions) {
    for (const evidenceId of assertion.evidenceIds) {
      const item = evidenceById.get(evidenceId);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      evidence.push(item);
    }
  }
  return evidence;
}

function resultFromAssertion(
  left: InteractionParticipant,
  right: InteractionParticipant,
  assertion: InteractionAssertion,
  knowledge: MedicationInteractionKnowledgeBase,
): InteractionPairResult {
  return {
    left,
    right,
    conclusion: assertion.conclusion,
    severity: assertion.severity,
    certainty: assertion.certainty,
    interactionType: assertion.interactionType,
    direction: assertion.direction,
    mechanism: assertion.mechanism,
    effect: assertion.effect,
    recommendation: assertion.recommendation,
    assertionId: assertion.id,
    evidence: evidenceForAssertions([assertion], knowledge),
  };
}

function conflictingResult(
  left: InteractionParticipant,
  right: InteractionParticipant,
  assertions: readonly InteractionAssertion[],
  knowledge: MedicationInteractionKnowledgeBase,
): InteractionPairResult {
  return {
    left,
    right,
    conclusion: 'conflicting-evidence',
    severity: 'unknown',
    recommendation:
      'Для этой пары найдены несколько пересекающихся проверенных утверждений. Требуется ручная сверка источников; автоматический вывод не применяется.',
    evidence: evidenceForAssertions(assertions, knowledge),
  };
}

function unknownResult(
  left: InteractionParticipant,
  right: InteractionParticipant,
): InteractionPairResult {
  const hasUnresolvedParticipant = !left.concept || !right.concept;
  return {
    left,
    right,
    conclusion: 'unknown',
    severity: 'unknown',
    recommendation: hasUnresolvedParticipant
      ? 'Один или оба препарата не распознаны в подключённой проверенной базе. Взаимодействие не оценено.'
      : 'В подключённой проверенной базе нет утверждения для этой пары. Это не подтверждает отсутствие взаимодействия.',
    evidence: [],
  };
}

function participant(input: string, concept?: MedicationConcept): InteractionParticipant {
  return concept ? { input, label: concept.preferredName, concept } : { input, label: input };
}

function resolvePair(
  left: InteractionParticipant,
  right: InteractionParticipant,
  knowledge: MedicationInteractionKnowledgeBase,
): InteractionPairResult {
  if (!left.concept || !right.concept) return unknownResult(left, right);
  const assertions = knowledge.assertions.filter((assertion) =>
    assertionMatchesPair(
      assertion,
      left.concept as MedicationConcept,
      right.concept as MedicationConcept,
    ),
  );
  if (assertions.length === 0) return unknownResult(left, right);

  const highestSpecificity = Math.max(
    ...assertions.map((assertion) => (assertion.interactant.kind === 'medication' ? 2 : 1)),
  );
  const mostSpecific = assertions.filter(
    (assertion) => (assertion.interactant.kind === 'medication' ? 2 : 1) === highestSpecificity,
  );
  if (mostSpecific.length !== 1) {
    return conflictingResult(left, right, mostSpecific, knowledge);
  }
  const assertion = mostSpecific[0];
  return assertion
    ? resultFromAssertion(left, right, assertion, knowledge)
    : unknownResult(left, right);
}

export function checkMedicationInteractions(
  inputs: readonly string[],
  knowledge: MedicationInteractionKnowledgeBase,
): MedicationInteractionCheckResult {
  ensureValidated(knowledge);
  const resolved: MedicationInteractionCheckResult['resolved'][number][] = [];
  const unresolved: MedicationInteractionCheckResult['unresolved'][number][] = [];
  const participants: InteractionParticipant[] = [];
  const duplicateInputs: string[] = [];
  const seenKeys = new Set<string>();
  const nonEmptyInputs = inputs.map((input) => input.trim()).filter(Boolean);
  let truncated = false;

  for (const input of nonEmptyInputs) {
    const concept = resolveMedication(input, knowledge);
    const normalized = normalizeMedicationName(input);
    const key = concept ? `medication:${concept.id}` : `unresolved:${normalized}`;
    if (seenKeys.has(key)) {
      duplicateInputs.push(input);
      continue;
    }
    if (participants.length >= MAX_MEDICATIONS) {
      truncated = true;
      continue;
    }
    seenKeys.add(key);
    participants.push(participant(input, concept));
    if (concept) resolved.push({ input, concept });
    else unresolved.push({ input });
  }

  const pairs: InteractionPairResult[] = [];
  for (let leftIndex = 0; leftIndex < participants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < participants.length; rightIndex += 1) {
      const left = participants[leftIndex];
      const right = participants[rightIndex];
      if (!left || !right) continue;
      pairs.push(resolvePair(left, right, knowledge));
    }
  }

  return {
    participants,
    resolved,
    unresolved,
    duplicateInputs,
    pairs,
    truncated,
  };
}
