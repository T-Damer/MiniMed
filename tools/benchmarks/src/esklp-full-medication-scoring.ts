import type { SearchResultGroup } from '@localmed/contracts';

export const ESKLP_SOURCE_NATIVE_ENTITY_IDS = [
  'esklp.mnn.парацетамол',
  'esklp.mnn.ибупрофен',
  'esklp.mnn.ибупрофен-кодеин',
  'esklp.mnn.ибупрофен-парацетамол',
  'esklp.mnn.будесонид',
  'esklp.mnn.будесонид-формотерол',
  'esklp.mnn.формотерол',
  'esklp.mnn.сальбутамол',
  'esklp.mnn.эритромицин',
  'esklp.mnn.цефтриаксон',
  'esklp.mnn.цефепим',
] as const;

const SOURCE_NATIVE_ENTITY_ID_SET = new Set<string>(ESKLP_SOURCE_NATIVE_ENTITY_IDS);

export interface EsklpMedicationEvidenceRequirement {
  readonly entityId: string;
  readonly allOf: readonly string[];
  readonly anyOf?: readonly string[];
}

export interface EsklpMedicationQuery {
  readonly id: string;
  readonly query: string;
  readonly requiredEntityIds: readonly string[];
  readonly identityTop1EntityId?: string;
  readonly evidence?: readonly EsklpMedicationEvidenceRequirement[];
}

export interface EsklpMedicationFixture {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly description: string;
  readonly trustedDoseData: false;
  readonly queries: readonly EsklpMedicationQuery[];
}

export interface EsklpEvidenceEvaluation {
  readonly entityId: string;
  readonly passed: boolean;
}

export interface EsklpMedicationEvaluation {
  readonly queryId: string;
  readonly query: string;
  readonly requiredEntityIds: readonly string[];
  readonly foundEntityIds: readonly string[];
  readonly entityRecallAt5: number;
  readonly hitAt5: boolean;
  readonly firstRequiredRank: number | null;
  readonly reciprocalRankAt5: number;
  readonly identityTop1EntityId: string | null;
  readonly exactSupportedIdentityTop1: boolean | null;
  readonly evidenceChecks: readonly EsklpEvidenceEvaluation[];
  readonly evidenceHit: boolean | null;
  readonly elapsedMs: number;
  readonly topDocumentIds: readonly string[];
}

export interface EsklpMedicationAggregate {
  readonly queryCount: number;
  readonly entityRecallAt5: number;
  readonly hitAt5: number;
  readonly mrrAt5: number;
  readonly exactSupportedIdentityTop1: number | null;
  readonly evidenceHit: number | null;
  readonly identityTop1FixtureCount: number;
  readonly evidenceQueryCount: number;
}

export type EsklpMedicationIdentityResolver = (documentId: string) => string;

export const ESKLP_GATE_MINIMUMS = {
  entityRecallAt5: 0.9,
  hitAt5: 0.9,
  mrrAt5: 0.65,
  exactSupportedIdentityTop1: 0.98,
  evidenceHit: 1,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new Error(`${path} must be a non-empty string array.`);
  }
  return value;
}

function requireSourceEntityId(value: unknown, path: string): string {
  const entityId = requireNonEmptyString(value, path);
  if (!SOURCE_NATIVE_ENTITY_ID_SET.has(entityId)) {
    throw new Error(`${path} is not an audited source-native ESKLP entity ID.`);
  }
  return entityId;
}

function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${path} must not contain duplicate values.`);
  }
}

function parseEvidence(
  value: unknown,
  path: string,
): readonly EsklpMedicationEvidenceRequirement[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  const evidence = value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) throw new Error(`${itemPath} must be an object.`);
    const entityId = requireSourceEntityId(getField(item, 'entityId'), `${itemPath}.entityId`);
    const allOf = requireStringArray(getField(item, 'allOf'), `${itemPath}.allOf`);
    const anyOf =
      getField(item, 'anyOf') === undefined
        ? undefined
        : requireStringArray(getField(item, 'anyOf'), `${itemPath}.anyOf`);
    return anyOf === undefined ? { entityId, allOf } : { entityId, allOf, anyOf };
  });
  assertUnique(
    evidence.map((item) => item.entityId),
    `${path}.entityId`,
  );
  return evidence;
}

function parseQuery(value: unknown, index: number): EsklpMedicationQuery {
  const path = `queries[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const id = requireNonEmptyString(getField(value, 'id'), `${path}.id`);
  const query = requireNonEmptyString(getField(value, 'query'), `${path}.query`);
  const rawRequiredEntityIds = requireStringArray(
    getField(value, 'requiredEntityIds'),
    `${path}.requiredEntityIds`,
  );
  const requiredEntityIds = rawRequiredEntityIds.map((entityId, entityIndex) =>
    requireSourceEntityId(entityId, `${path}.requiredEntityIds[${entityIndex}]`),
  );
  assertUnique(requiredEntityIds, `${path}.requiredEntityIds`);

  let identityTop1EntityId: string | undefined;
  if (getField(value, 'identityTop1EntityId') !== undefined) {
    identityTop1EntityId = requireSourceEntityId(
      getField(value, 'identityTop1EntityId'),
      `${path}.identityTop1EntityId`,
    );
    if (!requiredEntityIds.includes(identityTop1EntityId)) {
      throw new Error(`${path}.identityTop1EntityId must be required by the same query.`);
    }
  }

  const evidence =
    getField(value, 'evidence') === undefined
      ? undefined
      : parseEvidence(getField(value, 'evidence'), `${path}.evidence`);
  for (const [evidenceIndex, item] of (evidence ?? []).entries()) {
    if (!requiredEntityIds.includes(item.entityId)) {
      throw new Error(
        `${path}.evidence[${evidenceIndex}].entityId must be required by the same query.`,
      );
    }
  }

  return evidence === undefined
    ? { id, query, requiredEntityIds, ...(identityTop1EntityId ? { identityTop1EntityId } : {}) }
    : {
        id,
        query,
        requiredEntityIds,
        ...(identityTop1EntityId ? { identityTop1EntityId } : {}),
        evidence,
      };
}

export function validateEsklpMedicationFixture(value: unknown): EsklpMedicationFixture {
  if (!isRecord(value)) throw new Error('ESKLP medication fixture must be an object.');
  if (getField(value, 'schemaVersion') !== 1) {
    throw new Error('Unsupported ESKLP medication fixture schema.');
  }
  const id = requireNonEmptyString(getField(value, 'id'), 'id');
  const description = requireNonEmptyString(getField(value, 'description'), 'description');
  if (getField(value, 'trustedDoseData') !== false) {
    throw new Error('ESKLP medication fixture must declare trustedDoseData=false.');
  }
  const queriesValue = getField(value, 'queries');
  if (!Array.isArray(queriesValue) || queriesValue.length < 14) {
    throw new Error('ESKLP medication fixture must contain at least 14 queries.');
  }
  const queries = queriesValue.map(parseQuery);
  assertUnique(
    queries.map((query) => query.id),
    'queries.id',
  );
  assertUnique(
    queries.map((query) => query.query),
    'queries.query',
  );
  return { schemaVersion: 1, id, description, trustedDoseData: false, queries };
}

function normalizeEvidenceText(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function containsExactPhrase(normalizedHaystack: string, phrase: string): boolean {
  const normalizedPhrase = normalizeEvidenceText(phrase);
  return normalizedPhrase.length > 0 && ` ${normalizedHaystack} `.includes(` ${normalizedPhrase} `);
}

function resultEvidenceTexts(group: SearchResultGroup): readonly string[] {
  return group.results
    .flatMap((result) => [result.title, ...result.sectionPath, result.snippet])
    .map(normalizeEvidenceText);
}

function evidencePasses(
  group: SearchResultGroup | undefined,
  requirement: EsklpMedicationEvidenceRequirement,
): boolean {
  if (!group) return false;
  const evidenceTexts = resultEvidenceTexts(group);
  const hasPhrase = (phrase: string) =>
    evidenceTexts.some((evidenceText) => containsExactPhrase(evidenceText, phrase));
  return (
    requirement.allOf.every(hasPhrase) &&
    (requirement.anyOf === undefined || requirement.anyOf.some(hasPhrase))
  );
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

export function evaluateEsklpMedicationQuery(
  fixture: EsklpMedicationQuery,
  groups: readonly SearchResultGroup[],
  elapsedMs = 0,
  resolveIdentity: EsklpMedicationIdentityResolver = (documentId) => documentId,
): EsklpMedicationEvaluation {
  const requiredEntityIds = [...new Set(fixture.requiredEntityIds)];
  const top5 = groups.slice(0, 5);
  const topDocumentIds = top5.map((group) => group.documentId);
  const topEntityIds = topDocumentIds.map(resolveIdentity);
  const foundEntityIds = requiredEntityIds.filter((entityId) => topEntityIds.includes(entityId));
  const firstRequiredIndex = topEntityIds.findIndex((entityId) =>
    requiredEntityIds.includes(entityId),
  );
  const firstRequiredRank = firstRequiredIndex < 0 ? null : firstRequiredIndex + 1;
  const evidenceChecks = (fixture.evidence ?? []).map((requirement) => ({
    entityId: requirement.entityId,
    passed: evidencePasses(
      top5.find((group) => resolveIdentity(group.documentId) === requirement.entityId),
      requirement,
    ),
  }));
  const exactSupportedIdentityTop1 =
    fixture.identityTop1EntityId === undefined
      ? null
      : topEntityIds[0] === fixture.identityTop1EntityId;
  return {
    queryId: fixture.id,
    query: fixture.query,
    requiredEntityIds,
    foundEntityIds,
    entityRecallAt5: foundEntityIds.length / requiredEntityIds.length,
    hitAt5: foundEntityIds.length > 0,
    firstRequiredRank,
    reciprocalRankAt5: firstRequiredRank === null ? 0 : 1 / firstRequiredRank,
    identityTop1EntityId: fixture.identityTop1EntityId ?? null,
    exactSupportedIdentityTop1,
    evidenceChecks,
    evidenceHit: evidenceChecks.length === 0 ? null : evidenceChecks.every((check) => check.passed),
    elapsedMs,
    topDocumentIds,
  };
}

export function aggregateEsklpMedicationEvaluations(
  rows: readonly EsklpMedicationEvaluation[],
): EsklpMedicationAggregate {
  const identityRows = rows.filter((row) => row.exactSupportedIdentityTop1 !== null);
  const evidenceRows = rows.filter((row) => row.evidenceHit !== null);
  return {
    queryCount: rows.length,
    entityRecallAt5: mean(rows.map((row) => row.entityRecallAt5)),
    hitAt5: mean(rows.map((row) => Number(row.hitAt5))),
    mrrAt5: mean(rows.map((row) => row.reciprocalRankAt5)),
    exactSupportedIdentityTop1:
      identityRows.length === 0
        ? null
        : mean(identityRows.map((row) => Number(row.exactSupportedIdentityTop1))),
    evidenceHit:
      evidenceRows.length === 0 ? null : mean(evidenceRows.map((row) => Number(row.evidenceHit))),
    identityTop1FixtureCount: identityRows.length,
    evidenceQueryCount: evidenceRows.length,
  };
}
